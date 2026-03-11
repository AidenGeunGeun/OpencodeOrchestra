import { For, Show } from "solid-js"
import { ContextHealth } from "@opencode-ai/ui/context-health"
import { Icon } from "@opencode-ai/ui/icon"

type SessionBreadcrumbItem = {
  id: string
  title: string
  current?: number
  limit?: number
  usage?: number | null
}

export function SessionBreadcrumb(props: {
  items: SessionBreadcrumbItem[]
  onNavigate: (sessionID: string) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <nav aria-label="Session breadcrumb" class="flex min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar mb-1">
        <For each={props.items}>
          {(item, index) => (
            <>
              <Show when={index() > 0}>
                <span class="shrink-0 text-icon-weak opacity-40">
                  <Icon name="chevron-right" size="small" />
                </span>
              </Show>
              <button
                type="button"
                class="min-w-0 shrink rounded-sm px-1.5 py-0.5 text-11-regular text-text-dimmer transition-colors hover:text-text-weak"
                onClick={() => props.onNavigate(item.id)}
              >
                <span class="flex items-center gap-1.5">
                  <span class="block max-w-36 truncate">{item.title}</span>
                  <ContextHealth current={item.current} limit={item.limit} usage={item.usage} ghost />
                </span>
              </button>
            </>
          )}
        </For>
      </nav>
    </Show>
  )
}
