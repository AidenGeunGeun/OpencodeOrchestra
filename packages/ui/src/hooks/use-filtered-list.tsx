import fuzzysort from "fuzzysort"
import { entries, flatMap, groupBy, map, pipe } from "remeda"
import { createEffect, createMemo, createResource, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createList } from "solid-list"

export interface FilteredListProps<T> {
  items: T[] | ((filter: string) => T[] | Promise<T[]>)
  key: (item: T) => string
  filterKeys?: string[]
  current?: T
  groupBy?: (x: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: { category: string; items: T[] }, b: { category: string; items: T[] }) => number
  onSelect?: (value: T | undefined, index: number) => void
  noInitialSelection?: boolean
  // OCO: opt-in debounce window (ms) for callers whose `items` source is an
  // async fetch (e.g. an SDK file-search call). Without this opt-in the filter
  // applies on every keystroke. Sync sources (in-memory arrays + fuzzysort, or
  // memo-derived arrays) should leave this unset so the list stays live.
  debounceFilterMs?: number
}

export function useFilteredList<T>(props: FilteredListProps<T>) {
  const [store, setStore] = createStore<{ filter: string }>({ filter: "" })
  // OCO: `appliedFilter` lags `store.filter` while typing if items are async; this
  // collapses keystroke-bursts into one fetch (was one SDK IPC per keystroke).
  const [appliedFilter, setAppliedFilter] = createSignal("")
  let pendingDebounce: ReturnType<typeof setTimeout> | undefined
  const flushPendingDebounce = () => {
    if (pendingDebounce === undefined) return
    clearTimeout(pendingDebounce)
    pendingDebounce = undefined
  }
  onCleanup(flushPendingDebounce)

  type Group = { category: string; items: [T, ...T[]] }
  const empty: Group[] = []

  const [grouped, { refetch }] = createResource(
    () => ({
      filter: appliedFilter(),
      items: typeof props.items === "function" ? props.items(appliedFilter()) : props.items,
    }),
    async ({ filter, items }) => {
      const query = filter ?? ""
      const needle = query.toLowerCase()
      const all = (await Promise.resolve(items)) || []
      const result = pipe(
        all,
        (x) => {
          if (!needle) return x
          if (!props.filterKeys && Array.isArray(x) && x.every((e) => typeof e === "string")) {
            return fuzzysort.go(needle, x).map((x) => x.target) as T[]
          }
          return fuzzysort.go(needle, x, { keys: props.filterKeys! }).map((x) => x.obj)
        },
        groupBy((x) => (props.groupBy ? props.groupBy(x) : "")),
        entries(),
        map(([k, v]) => ({ category: k, items: props.sortBy ? v.sort(props.sortBy) : v })),
        (groups) => (props.sortGroupsBy ? groups.sort(props.sortGroupsBy) : groups),
      )
      return result
    },
    { initialValue: empty },
  )

  const flat = createMemo(() => {
    return pipe(
      grouped.latest || [],
      flatMap((x) => x.items),
    )
  })

  function initialActive() {
    if (props.noInitialSelection) return ""
    if (props.current) return props.key(props.current)

    const items = flat()
    if (items.length === 0) return ""
    return props.key(items[0])
  }

  const list = createList({
    items: () => flat().map(props.key),
    initialActive: initialActive(),
    loop: true,
  })

  const reset = () => {
    if (props.noInitialSelection) {
      list.setActive("")
      return
    }
    const all = flat()
    if (all.length === 0) return
    list.setActive(props.key(all[0]))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault()
      const selectedIndex = flat().findIndex((x) => props.key(x) === list.active())
      const selected = flat()[selectedIndex]
      if (selected) props.onSelect?.(selected, selectedIndex)
    } else if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === "n" || event.key === "p") {
        event.preventDefault()
        const navEvent = new KeyboardEvent("keydown", {
          key: event.key === "n" ? "ArrowDown" : "ArrowUp",
          bubbles: true,
        })
        list.onKeyDown(navEvent)
      }
    } else {
      // Skip list navigation for text editing shortcuts (e.g., Option+Arrow, Option+Backspace on macOS)
      if (event.altKey || event.metaKey) return
      list.onKeyDown(event)
    }
  }

  createEffect(
    on(grouped, () => {
      reset()
    }),
  )

  const debounceMs = () => props.debounceFilterMs ?? 0

  const onInput = (value: string) => {
    setStore("filter", value)
    const wait = debounceMs()
    // Empty filter (user cleared) and the no-debounce case both apply immediately.
    if (wait <= 0 || value === "") {
      flushPendingDebounce()
      setAppliedFilter(value)
      return
    }
    flushPendingDebounce()
    pendingDebounce = setTimeout(() => {
      pendingDebounce = undefined
      setAppliedFilter(value)
    }, wait)
  }

  // OCO: flush any pending debounce so a tab-complete or programmatic refetch
  // sees the latest filter rather than the last applied one.
  const flushAndRefetch = () => {
    if (pendingDebounce !== undefined) {
      flushPendingDebounce()
      setAppliedFilter(store.filter)
    }
    return refetch()
  }

  return {
    grouped,
    filter: () => store.filter,
    flat,
    reset,
    refetch: flushAndRefetch,
    clear: () => {
      flushPendingDebounce()
      setStore("filter", "")
      setAppliedFilter("")
    },
    onKeyDown,
    onInput,
    active: list.active,
    setActive: list.setActive,
  }
}
