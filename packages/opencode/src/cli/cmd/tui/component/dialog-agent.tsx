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

  const isSubagentSession = createMemo(() => {
    if (route.data.type !== "session") return false
    const session = sync.session.get(route.data.sessionID)
    return !!session?.parentID
  })

  const lockedAgentID = createMemo(() => {
    if (route.data.type !== "session") return undefined
    const session = sync.session.get(route.data.sessionID)
    if (session?.parentID) return session.agentID
    return undefined
  })

  const options = createMemo(() => {
    const locked = lockedAgentID()
    if (locked) {
      const allAgents = [...local.agent.list(), ...sync.data.agent.filter((agent) => agent.mode === "subagent")]
      const agent = allAgents.find((item) => item.name === locked)
      if (agent) {
        return [
          {
            value: agent.name,
            title: agent.displayName ?? agent.name,
            description: agent.native ? "locked" : agent.description,
          },
        ]
      }
    }

    return local.agent.list().map((item) => {
      return {
        value: item.name,
        title: item.displayName ?? item.name,
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
