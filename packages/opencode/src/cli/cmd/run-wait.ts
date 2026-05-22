export const DEFAULT_WAIT_FOR_CHILDREN_TIMEOUT_MS = 30 * 60 * 1000

export type RunSessionCreatedInfo = {
  id: string
  parentID?: string | null
  agentID?: string | null
}

export type RunWaitTimeoutResult = {
  exitCode: 1
  message: string
  childSessionIDs: string[]
}

export class RunChildSessionTracker {
  private readonly sessionIDs: Set<string>
  private readonly persistentChildSessionIDs = new Set<string>()
  private readonly activePersistentChildSessionIDs = new Set<string>()
  private rootIdle = false

  constructor(
    private readonly rootSessionID: string,
    private readonly waitForChildren: boolean,
  ) {
    this.sessionIDs = new Set([rootSessionID])
  }

  hasSession(sessionID: string | null | undefined) {
    return !!sessionID && this.sessionIDs.has(sessionID)
  }

  observeSessionCreated(info: RunSessionCreatedInfo, persistent: boolean) {
    if (!this.hasSession(info.parentID)) return false

    this.sessionIDs.add(info.id)
    if (!this.waitForChildren || !persistent) return false

    this.persistentChildSessionIDs.add(info.id)
    this.activePersistentChildSessionIDs.add(info.id)
    return true
  }

  observeSessionStatus(sessionID: string, status: string) {
    if (sessionID === this.rootSessionID) {
      this.rootIdle = status === "idle"
      return
    }

    if (!this.persistentChildSessionIDs.has(sessionID)) return
    if (status === "idle") {
      this.activePersistentChildSessionIDs.delete(sessionID)
      return
    }
    this.activePersistentChildSessionIDs.add(sessionID)
  }

  observeSessionIdle(sessionID: string) {
    if (sessionID === this.rootSessionID) {
      this.rootIdle = true
      return
    }
    this.activePersistentChildSessionIDs.delete(sessionID)
  }

  observeRootActivity(sessionID: string) {
    if (sessionID !== this.rootSessionID) return
    if (!this.waitForChildren) return
    if (!this.rootIdle) return
    if (this.persistentChildSessionIDs.size === 0) return
    this.rootIdle = false
  }

  shouldExit() {
    if (!this.rootIdle) return false
    if (!this.waitForChildren) return true
    return this.activePersistentChildSessionIDs.size === 0
  }

  getActivePersistentChildSessionIDs() {
    return Array.from(this.activePersistentChildSessionIDs)
  }

  getPersistentChildSessionIDs() {
    return Array.from(this.persistentChildSessionIDs)
  }
}

export function createWaitForChildrenTimeoutResult(tracker: RunChildSessionTracker): RunWaitTimeoutResult {
  const active = tracker.getActivePersistentChildSessionIDs()
  const childSessionIDs = active.length > 0 ? active : tracker.getPersistentChildSessionIDs()
  const formatted = childSessionIDs.length > 0 ? childSessionIDs.join(", ") : "none"
  return {
    exitCode: 1,
    childSessionIDs,
    message: `Timed out waiting for persistent child sessions to finish: ${formatted}`,
  }
}
