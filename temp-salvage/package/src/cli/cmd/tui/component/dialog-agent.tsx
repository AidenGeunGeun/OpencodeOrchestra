import { createMemo } from "solid-js"
import { useLocal } from "@tui/context/local"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()

  // Check if we're in a subagent session (has parentID)
  const isSubagentSession = createMemo(() => {
    if (route.data.type !== "session") return false
    const session = sync.session.get(route.data.sessionID)
    return !!session?.parentID
  })

  // Get the locked agent for subagent sessions
  const lockedAgentID = createMemo(() => {
    if (route.data.type !== "session") return null
    const session = sync.session.get(route.data.sessionID)
    if (session?.parentID) return session.agentID
    return null
  })

  const options = createMemo(() => {
    // If in subagent session, only show the locked agent
    const locked = lockedAgentID()
    if (locked) {
      const allAgents = [...local.agent.list(), ...sync.data.agent.filter(a => a.mode === "subagent")]
      const agent = allAgents.find(a => a.name === locked)
      if (agent) {
        return [{
          value: agent.name,
          title: agent.name,
          description: agent.native ? "locked" : agent.description,
        }]
      }
    }
    
    // Normal case: show all primary agents
    return local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.name,
        description: item.native ? "native" : item.description,
      }
    })
  })

  return (
    <DialogSelect
      title={isSubagentSession() ? "Agent (locked)" : "Select agent"}
      current={lockedAgentID() ?? local.agent.current().name}
      options={options()}
      onSelect={(option) => {
        // Don't allow changing agent in subagent session
        if (isSubagentSession()) {
          dialog.clear()
          return
        }
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
