import { createMemo, Show } from "solid-js"
import type { JSX } from "solid-js"
import { createSortable } from "@thisbeyond/solid-dnd"
import { FileIcon } from "@opencodeorchestra/ui/file-icon"
import { IconButton } from "@opencodeorchestra/ui/icon-button"
import { Tooltip } from "@opencodeorchestra/ui/tooltip"
import { Tabs } from "@opencodeorchestra/ui/tabs"
import { getFilename } from "@opencodeorchestra/util/path"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"

export function FileVisual(props: { path: string; active?: boolean }): JSX.Element {
  return (
    <div class="flex items-center gap-x-1.5">
      <FileIcon
        node={{ path: props.path, type: "file" }}
        classList={{
          "grayscale-100 group-data-[selected]/tab:grayscale-0": !props.active,
          "grayscale-0": props.active,
        }}
      />
      <span class="text-14-medium">{getFilename(props.path)}</span>
    </div>
  )
}

export function SortableTab(props: { tab: string; onTabClose: (tab: string) => void }): JSX.Element {
  const file = useFile()
  const language = useLanguage()
  const sortable = createSortable(props.tab)
  const path = createMemo(() => file.pathFromTab(props.tab))
  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <Tabs.Trigger
          value={props.tab}
          closeButton={
            <Tooltip value={language.t("common.closeTab")} placement="bottom">
              <IconButton
                icon="close"
                variant="ghost"
                onClick={() => props.onTabClose(props.tab)}
                aria-label={language.t("common.closeTab")}
              />
            </Tooltip>
          }
          hideCloseButton
          onMiddleClick={() => props.onTabClose(props.tab)}
        >
          <Show when={path()}>{(p) => <FileVisual path={p()} />}</Show>
        </Tabs.Trigger>
      </div>
    </div>
  )
}
