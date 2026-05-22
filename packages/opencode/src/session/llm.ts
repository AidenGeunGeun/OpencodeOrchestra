import { Installation } from "@/installation"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  generateText,
  streamText,
  type ModelMessage,
  type StreamTextResult,
  type TextStreamPart,
  type Tool,
  type ToolSet,
  tool,
  jsonSchema,
} from "ai"
import { clone, mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"

export namespace LLM {
  const log = Log.create({ service: "llm" })

  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
  }

  export type StreamOutput = StreamTextResult<ToolSet, any>

  export const NON_STREAMING_OPTION = "experimentalNonStreamingToolCalls"

  export function shouldUseNonStreaming(options: Record<string, any>) {
    return options[NON_STREAMING_OPTION] === true
  }

  /**
   * Canonical session-history serializer for outbound LLM requests.
   */
  export async function toRequestMessages(
    messages: MessageV2.WithParts[],
    model: Provider.Model,
    options?: { stripMedia?: boolean },
  ) {
    const { MessageV2 } = await import("./message-v2")
    return MessageV2.toModelMessages(clone(messages), model, options)
  }

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    const system = []
    system.push(
      [
        // use agent prompt otherwise provider prompt
        // For Codex sessions, skip SystemPrompt.provider() since it's sent via options.instructions
        ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    const original = clone(system)
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    if (system.length === 0) {
      system.push(...original)
    }
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (provider.options?.[NON_STREAMING_OPTION] === true) {
      options[NON_STREAMING_OPTION] = true
    }
    if (isCodex) {
      options.instructions = SystemPrompt.instructions()
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent.name,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent.name,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const nonStreaming = shouldUseNonStreaming(params.options)
    delete params.options[NON_STREAMING_OPTION]

    const maxOutputTokens =
      isCodex || provider.id.includes("github-copilot") ? undefined : ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    const messages = ProviderTransform.message(
      [
        ...system.map(
          (x): ModelMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...input.messages,
      ],
      input.model,
      options,
    )

    const request = {
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error.message,
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode")
          ? {
              "x-opencode-project": Instance.project.id,
              "x-opencode-session": input.sessionID,
              "x-opencode-request": input.user.id,
              "x-opencode-client": Flag.OPENCODE_CLIENT,
            }
          : input.model.providerID !== "anthropic"
            ? {
                "User-Agent": `opencode/${Installation.VERSION}`,
              }
            : undefined),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages,
      model: language,
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
          sessionId: input.sessionID,
        },
      },
    } satisfies Parameters<typeof streamText>[0]

    if (nonStreaming) {
      l.info("non-streaming generation", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })
      return nonStreamingStreamText(request)
    }

    return streamText({
      ...request,
      onError(error) {
        l.error("stream error", {
          error,
        })
      },
    })
  }

  export async function nonStreamingStreamText(request: Parameters<typeof streamText>[0]): Promise<StreamOutput> {
    let result: Promise<Awaited<ReturnType<typeof generateText>>> | undefined
    const getResult = () => (result ??= generateText(request as Parameters<typeof generateText>[0]))
    const fullStream = nonStreamingFullStreamFromGenerate(getResult) as unknown as StreamOutput["fullStream"]
    return {
      get content() {
        return getResult().then((x) => x.content)
      },
      get text() {
        return getResult().then((x) => x.text)
      },
      get reasoning() {
        return getResult().then((x) => x.reasoning)
      },
      get reasoningText() {
        return getResult().then((x) => x.reasoningText)
      },
      get files() {
        return getResult().then((x) => x.files)
      },
      get sources() {
        return getResult().then((x) => x.sources)
      },
      get toolCalls() {
        return getResult().then((x) => x.toolCalls)
      },
      get staticToolCalls() {
        return getResult().then((x) => x.staticToolCalls)
      },
      get dynamicToolCalls() {
        return getResult().then((x) => x.dynamicToolCalls)
      },
      get toolResults() {
        return getResult().then((x) => x.toolResults)
      },
      get staticToolResults() {
        return getResult().then((x) => x.staticToolResults)
      },
      get dynamicToolResults() {
        return getResult().then((x) => x.dynamicToolResults)
      },
      get finishReason() {
        return getResult().then((x) => x.finishReason)
      },
      get rawFinishReason() {
        return getResult().then((x) => x.rawFinishReason)
      },
      get usage() {
        return getResult().then((x) => x.usage)
      },
      get totalUsage() {
        return getResult().then((x) => x.totalUsage)
      },
      get warnings() {
        return getResult().then((x) => x.warnings)
      },
      get steps() {
        return getResult().then((x) => x.steps)
      },
      get request() {
        return getResult().then((x) => x.request)
      },
      get response() {
        return getResult().then((x) => x.response)
      },
      get providerMetadata() {
        return getResult().then((x) => x.providerMetadata)
      },
      fullStream,
      textStream: (async function* () {
        const text = await getResult().then((x) => x.text)
        if (text) yield text
      })() as unknown as StreamOutput["textStream"],
      consumeStream: async () => {
        await getResult()
      },
    } as unknown as StreamOutput
  }

  async function* nonStreamingFullStreamFromGenerate(
    generate: () => Promise<Awaited<ReturnType<typeof generateText>>>,
  ): AsyncGenerator<TextStreamPart<ToolSet>> {
    yield { type: "start" }
    yield { type: "start-step", request: {} as any, warnings: [] }
    yield* nonStreamingResultEvents(await generate(), { firstStepStarted: true })
  }

  export async function* nonStreamingFullStreamFromPromise(
    result: Promise<Awaited<ReturnType<typeof generateText>>>,
  ): AsyncGenerator<TextStreamPart<ToolSet>> {
    yield* nonStreamingFullStreamFromGenerate(() => result)
  }

  export async function* nonStreamingFullStream(
    result: Awaited<ReturnType<typeof generateText>>,
  ): AsyncGenerator<TextStreamPart<ToolSet>> {
    yield { type: "start" }
    yield* nonStreamingResultEvents(result, { firstStepStarted: false })
  }

  async function* nonStreamingResultEvents(
    result: Awaited<ReturnType<typeof generateText>>,
    options: { firstStepStarted: boolean },
  ): AsyncGenerator<TextStreamPart<ToolSet>> {
    let emittedAnyStep = false
    for (const [stepIndex, step] of result.steps.entries()) {
      emittedAnyStep = true
      if (!(options.firstStepStarted && stepIndex === 0)) {
        yield {
          type: "start-step",
          request: step.request,
          warnings: step.warnings ?? [],
        }
      }

      yield* nonStreamingStepContentEvents(step.content, stepIndex)

      yield {
        type: "finish-step",
        response: step.response,
        usage: step.usage,
        finishReason: step.finishReason,
        rawFinishReason: step.rawFinishReason,
        providerMetadata: step.providerMetadata,
      }
    }
    // Fallback: when result.steps is empty (provider/SDK packaged the
    // completion without producing per-step entries — observed on
    // subagent generateText() calls when the model returned content
    // without multi-step tool execution), the original code would yield
    // no finish-step and the session processor would persist only the
    // outer start-step. That left subagent assistant messages as empty
    // shells in SQLite (no text, no tool, no usage). The fallback
    // synthesizes one step from the result-level content / usage /
    // finishReason so the processor sees a complete step-finish and
    // persists everything.
    if (!emittedAnyStep) {
      if (!options.firstStepStarted) {
        yield {
          type: "start-step",
          request: (result as any).request ?? ({} as any),
          warnings: result.warnings ?? [],
        }
      }
      yield* nonStreamingStepContentEvents(
        ((result as any).content ?? []) as ReadonlyArray<
          Awaited<ReturnType<typeof generateText>>["steps"][number]["content"][number]
        >,
        0,
      )
      yield {
        type: "finish-step",
        response: (result as any).response ?? ({} as any),
        usage: result.usage,
        finishReason: result.finishReason,
        rawFinishReason: result.rawFinishReason,
        providerMetadata: (result as any).providerMetadata,
      }
    }
    yield {
      type: "finish",
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
      totalUsage: result.totalUsage,
    }
  }

  async function* nonStreamingStepContentEvents(
    content: ReadonlyArray<
      Awaited<ReturnType<typeof generateText>>["steps"][number]["content"][number]
    >,
    stepIndex: number,
  ): AsyncGenerator<TextStreamPart<ToolSet>> {
    for (const [partIndex, part] of content.entries()) {
      const id = `${stepIndex}-${partIndex}`
      switch (part.type) {
        case "reasoning":
          yield { type: "reasoning-start", id, providerMetadata: part.providerMetadata }
          if (part.text) yield { type: "reasoning-delta", id, text: part.text, providerMetadata: part.providerMetadata }
          yield { type: "reasoning-end", id, providerMetadata: part.providerMetadata }
          break
        case "text":
          yield { type: "text-start", id, providerMetadata: part.providerMetadata }
          if (part.text) yield { type: "text-delta", id, text: part.text, providerMetadata: part.providerMetadata }
          yield { type: "text-end", id, providerMetadata: part.providerMetadata }
          break
        case "tool-call":
          yield {
            type: "tool-input-start",
            id: part.toolCallId,
            toolName: part.toolName,
            providerMetadata: part.providerMetadata,
            providerExecuted: part.providerExecuted,
            dynamic: part.dynamic,
          }
          yield { type: "tool-input-end", id: part.toolCallId, providerMetadata: part.providerMetadata }
          yield part
          break
        case "tool-result":
        case "tool-error":
        case "source":
        case "file":
        case "tool-approval-request":
          yield part
          break
      }
    }
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }
}
