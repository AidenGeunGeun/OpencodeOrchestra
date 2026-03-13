import { Show, createMemo } from "solid-js"

const formatCompact = (value: number) => {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`
  return value.toString()
}

export function ContextHealth(props: { current?: number; limit?: number; usage?: number | null; class?: string; ghost?: boolean }) {
  const usage = createMemo(() => {
    if (props.usage !== undefined && props.usage !== null) return props.usage
    if (!props.current || !props.limit) return undefined
    return Math.round((props.current / props.limit) * 100)
  })

  const tone = createMemo(() => {
    const value = usage() ?? 0
    if (value > 80) return "bg-text-diff-delete-base"
    if (value >= 50) return "bg-surface-warning-strong"
    return "bg-icon-success-base"
  })

  return (
    <Show when={props.current !== undefined && props.limit}>
      <div
        data-component="context-health"
        class={`inline-flex items-center gap-1 rounded-full text-11-regular ${
          props.ghost
            ? "opacity-70 text-text-dimmer"
            : "border border-border-base bg-background-base px-2 py-0.5 gap-1.5 text-text-weak"
        } ${props.class ?? ""}`}
      >
        <span class={`size-1.5 rounded-full ${tone()}`} />
        <span class="whitespace-nowrap">{formatCompact(props.current!)}</span>
        <span>/</span>
        <span class="whitespace-nowrap">{formatCompact(props.limit!)}</span>
      </div>
    </Show>
  )
}
