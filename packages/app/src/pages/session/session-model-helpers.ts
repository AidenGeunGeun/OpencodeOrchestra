import type { Message, UserMessage } from "@opencode-ai/sdk/v2"

type ModelKey = UserMessage["model"]

type SessionModelState = {
  model?: ModelKey
  variant?: string
  source?: "manual" | "submit"
}

type AgentDefaults = {
  model?: ModelKey
  variant?: string
}

type ResolveSessionModelSelectionInput = {
  session?: SessionModelState
  messages?: Message[]
  revertMessageID?: string
  agent?: AgentDefaults
  fallback?: ModelKey
  isModelValid?: (model: ModelKey) => boolean
}

function isUserMessage(message: Message): message is UserMessage {
  return message.role === "user"
}

function sameModel(left: ModelKey | undefined, right: ModelKey | undefined) {
  if (!left || !right) return left === right
  return left.providerID === right.providerID && left.modelID === right.modelID
}

function sameSelection(session: SessionModelState | undefined, message: UserMessage | undefined) {
  if (!session) return false
  if (!message) return false
  if (!sameModel(session.model, message.model)) return false
  return session.variant === message.variant
}

export function getLastUserMessage(messages: Message[] | undefined, revertMessageID?: string) {
  if (!messages) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || !isUserMessage(message)) continue
    if (revertMessageID && message.id >= revertMessageID) continue
    return message
  }
  return undefined
}

export function resolveSessionModelSelection(input: ResolveSessionModelSelectionInput) {
  const isModelValid = input.isModelValid ?? (() => true)
  const lastUserMessage = getLastUserMessage(input.messages, input.revertMessageID)
  const sessionModel = input.session?.model
  const hasPendingSessionOverride =
    !!input.session &&
    (input.messages === undefined || (input.session.source !== "submit" && !sameSelection(input.session, lastUserMessage)))
  if (hasPendingSessionOverride && sessionModel && isModelValid(sessionModel)) {
    return { model: sessionModel, variant: input.session?.variant }
  }

  if (lastUserMessage?.model && isModelValid(lastUserMessage.model)) {
    return { model: lastUserMessage.model, variant: lastUserMessage.variant }
  }

  const agentModel = input.agent?.model
  if (agentModel && isModelValid(agentModel)) {
    return { model: agentModel, variant: input.agent?.variant }
  }

  const fallbackModel = input.fallback
  if (fallbackModel && isModelValid(fallbackModel)) {
    return { model: fallbackModel, variant: undefined }
  }

  return { model: undefined, variant: undefined }
}
