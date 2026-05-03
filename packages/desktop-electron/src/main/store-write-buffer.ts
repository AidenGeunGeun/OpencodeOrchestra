type Timer = ReturnType<typeof setTimeout>

type PendingSet = {
  type: "set"
  value: string
}

type PendingDelete = {
  type: "delete"
}

export type PendingStoreWrite = PendingSet | PendingDelete

type Queue = {
  entries: Map<string, PendingStoreWrite>
  debounceTimer?: Timer
  maxTimer?: Timer
}

export type StoreWriteBufferOptions = {
  debounceMs: number
  maxWaitMs: number
  write: (name: string, entries: [string, PendingStoreWrite][]) => void
  onError?: (name: string, error: unknown) => void
}

export function createStoreWriteBuffer(options: StoreWriteBufferOptions) {
  const queues = new Map<string, Queue>()

  function queue(name: string) {
    let current = queues.get(name)
    if (!current) {
      current = { entries: new Map() }
      queues.set(name, current)
    }
    return current
  }

  function clearTimer(timer?: Timer) {
    if (timer) clearTimeout(timer)
  }

  function setTimer(fn: () => void, ms: number) {
    const timer = setTimeout(fn, ms)
    timer.unref?.()
    return timer
  }

  function schedule(name: string, current: Queue) {
    clearTimer(current.debounceTimer)
    current.debounceTimer = setTimer(() => {
      try {
        flush(name)
      } catch (error) {
        options.onError?.(name, error)
      }
    }, options.debounceMs)
    if (!current.maxTimer) {
      current.maxTimer = setTimer(() => {
        try {
          flush(name)
        } catch (error) {
          options.onError?.(name, error)
        }
      }, options.maxWaitMs)
    }
  }

  function enqueue(name: string, key: string, write: PendingStoreWrite) {
    const current = queue(name)
    current.entries.set(key, write)
    schedule(name, current)
  }

  function pending(name: string, key: string) {
    const current = queues.get(name)
    const entry = current?.entries.get(key)
    if (!entry) return { found: false as const }
    if (entry.type === "delete") return { found: true as const, value: null }
    return { found: true as const, value: entry.value }
  }

  function clearPending(name: string) {
    const current = queues.get(name)
    if (!current) return
    clearTimer(current.debounceTimer)
    clearTimer(current.maxTimer)
    queues.delete(name)
  }

  function flush(name: string) {
    const current = queues.get(name)
    if (!current || current.entries.size === 0) {
      clearPending(name)
      return
    }

    const entries = [...current.entries.entries()]
    clearTimer(current.debounceTimer)
    clearTimer(current.maxTimer)
    current.debounceTimer = undefined
    current.maxTimer = undefined

    try {
      options.write(name, entries)
    } catch (error) {
      schedule(name, current)
      throw error
    }

    current.entries.clear()
    queues.delete(name)
  }

  function flushAll() {
    let firstError: unknown
    for (const name of [...queues.keys()]) {
      try {
        flush(name)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }

  return {
    set(name: string, key: string, value: string) {
      enqueue(name, key, { type: "set", value })
    },
    delete(name: string, key: string) {
      enqueue(name, key, { type: "delete" })
    },
    pending,
    clearPending,
    flush,
    flushAll,
  }
}
