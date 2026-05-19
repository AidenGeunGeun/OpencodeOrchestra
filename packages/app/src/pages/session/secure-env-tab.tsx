// OCO-only file: Project Secure Env management surface inside the Tool Dock.
// See oco-dev skill deltas-catalog.md.
//
// Threat-model note: this component fetches stored values into the renderer so
// "show/hide" can be a pure UI toggle without per-click round trips. Models do
// not have access to the renderer's memory. The actual defense against
// model-driven exfiltration of secret values lives in the SecretRedaction
// layer that rewrites all model-visible tool output. This UI is a
// productivity guardrail, not a cybersecurity console.

import { Show, For, Match, Switch, createEffect, createMemo, createSignal } from "solid-js"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import {
  removeSecureEnvIDs,
  secureEnvBulkDeleteResult,
  selectAllSecureEnvVisible,
  selectedSecureEnvEntries,
  toggleSecureEnvSelection,
} from "./secure-env-helpers"

const MIN_VALUE_LENGTH = 8

type Risk = "low" | "medium" | "high" | "production"
const RISK_OPTIONS: Risk[] = ["low", "medium", "high", "production"]
const DEFAULT_RISK: Risk = "medium"

type EntryView = {
  id: string
  name: string
  risk: Risk
  enabled: boolean
  value: string
}

type AddDraft = { kind: "add"; name: string; value: string; risk: Risk }
type EditDraft = { kind: "edit"; id: string; name: string; value: string; risk: Risk }
type PasteDraft = { kind: "paste"; content: string; overwrite: boolean; risk: Risk }
type ConfirmDelete = { kind: "confirm-delete"; id: string }
type ConfirmBulkDelete = { kind: "confirm-bulk-delete" }
type Mode = { kind: "list" } | AddDraft | EditDraft | PasteDraft | ConfirmDelete | ConfirmBulkDelete

const DEFAULT_PROFILE_NAME = "default"
const DEFAULT_PROFILE_LABEL = "Project secure env"

function describeError(error: unknown) {
  if (!error) return "Something went wrong"
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error && "message" in error && typeof (error as { message: unknown }).message === "string")
    return (error as { message: string }).message
  return "Something went wrong"
}

export function SecureEnvTab() {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const [entries, setEntries] = createSignal<EntryView[]>([])
  const [profileID, setProfileID] = createSignal<string | undefined>(undefined)
  const [adminToken, setAdminToken] = createSignal<string | undefined>(undefined)
  const [tokenExpiresAt, setTokenExpiresAt] = createSignal(0)
  const [revealed, setRevealed] = createSignal<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [mode, setMode] = createSignal<Mode>({ kind: "list" })
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  type Notice = { kind: "error" | "info"; message: string } | undefined
  const [topNotice, setTopNotice] = createSignal<Notice>(undefined)
  const [draftError, setDraftError] = createSignal<string | undefined>(undefined)
  let loadVersion = 0

  const projectLabel = createMemo(() => {
    const project = sync.project
    if (project && project.id !== "global") return project.name || project.worktree || ""
    const workspaceName = sync.data.projectMeta?.name
    if (workspaceName) return workspaceName
    const directory = sync.data.path.directory || sdk.directory
    if (directory) return directory.split(/[\\/]/).filter(Boolean).at(-1) || directory
    if (!project) return ""
    return project.name || project.worktree || ""
  })
  const count = createMemo(() => entries().length)
  const selectedEntries = createMemo(() => selectedSecureEnvEntries(entries(), selected()))
  const selectedCount = createMemo(() => selectedEntries().length)
  const allVisibleSelected = createMemo(() => count() > 0 && selectedCount() === count())

  // ----- Token + SDK helpers -----------------------------------------------

  async function mintToken(client = sdk.client, version = loadVersion) {
    const result = await client.secret.adminToken()
    if (!result.data?.token) throw new Error(describeError(result.error) || "Could not mint admin token")
    if (version === loadVersion) {
      setAdminToken(result.data.token)
      setTokenExpiresAt(result.data.expiresAt)
    }
    return result.data.token
  }

  async function ensureToken(client = sdk.client, version = loadVersion): Promise<string> {
    const existing = adminToken()
    const buffer = 30_000 // re-mint at least 30s before expiry
    if (version === loadVersion && existing && Date.now() + buffer < tokenExpiresAt()) return existing
    return mintToken(client, version)
  }

  function authHeaders(token: string) {
    return { headers: { "x-oco-secret-admin-token": token } }
  }

  // ----- Load -------------------------------------------------------------

  async function findExistingProfile(client = sdk.client) {
    const profiles = await client.secret.profiles().then((r) => r.data ?? [])
    return profiles[0]?.id
  }

  // Creates a default profile if none exists yet. Called only on first SAVE
  // (add / edit / paste). Opening the panel never creates a profile, so a user
  // who opens Secure Env and never adds anything leaves no project state behind.
  async function ensureProfileForSave(client = sdk.client, version = loadVersion) {
    const existing = profileID() ?? (await findExistingProfile(client))
    if (existing) {
      if (!profileID()) setProfileID(existing)
      return existing
    }
    const token = await ensureToken(client, version)
    const created = await client.secret.admin.profile
      .create({ name: DEFAULT_PROFILE_NAME, label: DEFAULT_PROFILE_LABEL }, authHeaders(token))
      .then((r) => r.data)
    if (!created?.id) throw new Error("Could not create default secret profile")
    if (version === loadVersion) setProfileID(created.id)
    return created.id
  }

  async function loadEntriesAndValues(pid: string, client = sdk.client, version = loadVersion) {
    const list = await client.secret
      .entries({ profileID: pid })
      .then((r) => r.data ?? [])
    if (list.length === 0) return [] as EntryView[]

    const token = await ensureToken(client, version)
    const valued = await Promise.all(
      list.map(async (entry) => {
        const result = await client.secret.admin.entry
          .value({ profileID: pid, entryID: entry.id }, authHeaders(token))
          .then((r) => r.data)
        return {
          id: entry.id,
          name: entry.name,
          risk: (entry.risk as Risk) ?? DEFAULT_RISK,
          enabled: entry.enabled !== false,
          value: result?.value ?? "",
        } satisfies EntryView
      }),
    )
    return valued.sort((a, b) => a.name.localeCompare(b.name))
  }

  async function refresh(client = sdk.client, version = loadVersion) {
    if (version === loadVersion) setTopNotice(undefined)
    try {
      let pid = profileID()
      if (!pid) {
        const existing = await findExistingProfile(client)
        if (version !== loadVersion) return
        if (existing) {
          pid = existing
          setProfileID(existing)
        }
      }
      const next = pid ? await loadEntriesAndValues(pid, client, version) : []
      if (version !== loadVersion) return
      setEntries(next)
      // Drop reveal flags for entries that no longer exist
      const validIds = new Set(next.map((e) => e.id))
      const current = revealed()
      let changed = false
      const pruned = new Set<string>()
      for (const id of current) {
        if (validIds.has(id)) pruned.add(id)
        else changed = true
      }
      if (changed) setRevealed(pruned)
      const nextSelected = new Set([...selected()].filter((id) => validIds.has(id)))
      if (nextSelected.size !== selected().size) setSelected(nextSelected)
    } catch (error) {
      if (version === loadVersion) setTopNotice({ kind: "error", message: describeError(error) })
    }
  }

  function resetWorkspaceState() {
    setEntries([])
    setProfileID(undefined)
    setAdminToken(undefined)
    setTokenExpiresAt(0)
    setRevealed(new Set<string>())
    setSelected(new Set<string>())
    setMode({ kind: "list" })
    setBusy(false)
    setTopNotice(undefined)
    setDraftError(undefined)
  }

  createEffect(() => {
    const directory = sdk.directory
    const client = sdk.client
    const version = ++loadVersion
    resetWorkspaceState()
    setLoading(true)
    void Promise.resolve()
      .then(() => {
        void directory
        return refresh(client, version)
      })
      .finally(() => {
        if (version === loadVersion) setLoading(false)
      })
  })

  // ----- Mode helpers ------------------------------------------------------

  function startAdd() {
    setDraftError(undefined)
    setMode({ kind: "add", name: "", value: "", risk: DEFAULT_RISK })
  }

  function startEdit(entry: EntryView) {
    setDraftError(undefined)
    setMode({ kind: "edit", id: entry.id, name: entry.name, value: "", risk: entry.risk })
  }

  function startPaste() {
    setDraftError(undefined)
    setMode({ kind: "paste", content: "", overwrite: false, risk: DEFAULT_RISK })
  }

  function startConfirmDelete(entryID: string) {
    setMode({ kind: "confirm-delete", id: entryID })
  }

  function startConfirmBulkDelete() {
    if (selectedCount() === 0) return
    setMode({ kind: "confirm-bulk-delete" })
  }

  function cancel() {
    setDraftError(undefined)
    setMode({ kind: "list" })
  }

  function toggleSelection(entryID: string) {
    setSelected((current) => toggleSecureEnvSelection(current, entryID))
  }

  function toggleSelectAllVisible() {
    setSelected(allVisibleSelected() ? new Set<string>() : selectAllSecureEnvVisible(entries()))
  }

  // ----- CRUD --------------------------------------------------------------

  function validateValue(value: string) {
    if (value.length === 0) return language.t("session.secureEnv.error.valueEmpty")
    if (value.length < MIN_VALUE_LENGTH) return language.t("session.secureEnv.error.valueTooShort", { min: MIN_VALUE_LENGTH })
    return undefined
  }

  function validateName(name: string) {
    const trimmed = name.trim()
    if (trimmed.length === 0) return language.t("session.secureEnv.error.nameEmpty")
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return language.t("session.secureEnv.error.nameInvalid")
    return undefined
  }

  async function saveAdd(draft: AddDraft) {
    const nameError = validateName(draft.name)
    const valueError = validateValue(draft.value)
    if (nameError || valueError) {
      setDraftError(nameError ?? valueError)
      return
    }
    setBusy(true)
    setDraftError(undefined)
    try {
      const client = sdk.client
      const version = loadVersion
      const pid = await ensureProfileForSave(client, version)
      const token = await ensureToken(client, version)
      await client.secret.admin.entry.create(
        { profileID: pid, name: draft.name.trim(), risk: draft.risk, value: draft.value },
        authHeaders(token),
      )
      if (version !== loadVersion) return
      cancel()
      await refresh(client, version)
    } catch (error) {
      setDraftError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(draft: EditDraft) {
    const nameError = validateName(draft.name)
    if (nameError) {
      setDraftError(nameError)
      return
    }
    const valueChanged = draft.value.length > 0
    if (valueChanged) {
      const valueError = validateValue(draft.value)
      if (valueError) {
        setDraftError(valueError)
        return
      }
    }
    setBusy(true)
    setDraftError(undefined)
    try {
      const client = sdk.client
      const version = loadVersion
      const pid = profileID()
      if (!pid) throw new Error("Profile not initialized")
      const token = await ensureToken(client, version)
      await client.secret.admin.entry.update(
        {
          profileID: pid,
          entryID: draft.id,
          name: draft.name.trim(),
          risk: draft.risk,
          ...(valueChanged ? { value: draft.value } : {}),
        },
        authHeaders(token),
      )
      if (version !== loadVersion) return
      cancel()
      await refresh(client, version)
    } catch (error) {
      setDraftError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(entryID: string) {
    setBusy(true)
    try {
      const client = sdk.client
      const version = loadVersion
      const pid = profileID()
      if (!pid) throw new Error("Profile not initialized")
      const token = await ensureToken(client, version)
      await client.secret.admin.entry.delete({ profileID: pid, entryID }, authHeaders(token))
      if (version !== loadVersion) return
      cancel()
      await refresh(client, version)
    } catch (error) {
      setTopNotice({ kind: "error", message: describeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function confirmBulkDelete() {
    const targets = selectedEntries()
    if (targets.length === 0) return
    setBusy(true)
    try {
      const client = sdk.client
      const version = loadVersion
      const pid = profileID()
      if (!pid) throw new Error("Profile not initialized")
      const token = await ensureToken(client, version)
      const results = await Promise.allSettled(
        targets.map((entry) => client.secret.admin.entry.delete({ profileID: pid, entryID: entry.id }, authHeaders(token))),
      )
      if (version !== loadVersion) return
      const deleted = targets.filter((_, index) => results[index]?.status === "fulfilled").map((entry) => entry.id)
      const outcome = secureEnvBulkDeleteResult(targets.length, targets.length - deleted.length)
      setSelected((current) => removeSecureEnvIDs(current, deleted))
      setRevealed((current) => removeSecureEnvIDs(current, deleted))
      cancel()
      await refresh(client, version)
      if (outcome.complete) {
        setTopNotice({ kind: "info", message: language.t("session.secureEnv.bulk.deleted", { count: outcome.deleted }) })
      } else {
        setTopNotice({
          kind: "error",
          message: language.t("session.secureEnv.bulk.partial", { deleted: outcome.deleted, failed: outcome.failed }),
        })
      }
    } catch (error) {
      setTopNotice({ kind: "error", message: describeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function savePaste(draft: PasteDraft) {
    if (!draft.content.trim()) {
      setDraftError(language.t("session.secureEnv.error.pasteEmpty"))
      return
    }
    setBusy(true)
    setDraftError(undefined)
    try {
      const client = sdk.client
      const version = loadVersion
      const pid = await ensureProfileForSave(client, version)
      const token = await ensureToken(client, version)
      const imported = await client.secret.admin.import
        .env(
          {
            profileID: pid,
            content: draft.content,
            overwrite: draft.overwrite,
            risk: draft.risk,
          },
          authHeaders(token),
        )
        .then((r) => r.data ?? [])
      if (version !== loadVersion) return
      cancel()
      await refresh(client, version)
      const importedCount = imported.length
      if (importedCount === 0) {
        setTopNotice({ kind: "info", message: language.t("session.secureEnv.paste.noneImported") })
      } else {
        setTopNotice({
          kind: "info",
          message: language.t("session.secureEnv.paste.importedSummary", { count: importedCount }),
        })
      }
    } catch (error) {
      setDraftError(describeError(error))
    } finally {
      setBusy(false)
    }
  }

  // ----- Reveal toggle (pure UI state) ------------------------------------

  function toggleReveal(id: string) {
    const current = revealed()
    const next = new Set(current)
    if (current.has(id)) next.delete(id)
    else next.add(id)
    setRevealed(next)
  }

  // ----- Render ------------------------------------------------------------

  return (
    <div class="size-full flex flex-col bg-background-stronger" data-tool-dock-secure-env>
      <Header projectLabel={projectLabel()} count={count()} />
      <Show when={topNotice()} keyed>
        {(notice) => (
          <div
            class="shrink-0 px-3 py-1.5 text-11-regular border-b border-border-weaker-base"
            classList={{
              "text-text-warning": notice.kind === "error",
              "text-text-weak": notice.kind === "info",
            }}
          >
            {notice.message}
          </div>
        )}
      </Show>
      <Switch>
        <Match when={loading()}>
          <div class="flex-1 px-3 py-4 text-12-regular text-text-weak">
            {language.t("session.secureEnv.loading")}
          </div>
        </Match>
        <Match when={mode().kind === "paste"}>
          <PasteForm
            draft={mode() as PasteDraft}
            onChange={(next) => setMode(next)}
            onCancel={cancel}
            onSave={savePaste}
            busy={busy()}
            error={draftError()}
          />
        </Match>
        <Match when={true}>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show
              when={count() > 0 || mode().kind === "add"}
              fallback={<EmptyState onAdd={startAdd} onPaste={startPaste} />}
            >
              <ul class="flex flex-col">
                <SelectionToolbar
                  count={count()}
                  selectedCount={selectedCount()}
                  allVisibleSelected={allVisibleSelected()}
                  onToggleAll={toggleSelectAllVisible}
                  onDeleteSelected={startConfirmBulkDelete}
                  busy={busy()}
                />
                <Show when={mode().kind === "confirm-bulk-delete"}>
                  <BulkDeleteConfirm
                    entries={selectedEntries()}
                    onConfirm={confirmBulkDelete}
                    onCancel={cancel}
                    busy={busy()}
                  />
                </Show>
                <Show when={mode().kind === "add"}>
                  <li class="px-3 py-3 border-b border-border-weaker-base bg-background-base">
                    <AddRowForm
                      draft={mode() as AddDraft}
                      onChange={(next) => setMode(next)}
                      onCancel={cancel}
                      onSave={saveAdd}
                      busy={busy()}
                      error={draftError()}
                    />
                  </li>
                </Show>
                <For each={entries()}>
                  {(entry) => (
                    <Show
                      when={mode().kind === "edit" && (mode() as EditDraft).id === entry.id}
                      fallback={
                        <EntryRow
                          entry={entry}
                          selected={selected().has(entry.id)}
                          onToggleSelected={() => toggleSelection(entry.id)}
                          revealed={revealed().has(entry.id)}
                          onToggleReveal={() => toggleReveal(entry.id)}
                          onEdit={() => startEdit(entry)}
                          onDelete={() => startConfirmDelete(entry.id)}
                          confirmingDelete={mode().kind === "confirm-delete" && (mode() as ConfirmDelete).id === entry.id}
                          onConfirmDelete={() => confirmDelete(entry.id)}
                          onCancelDelete={cancel}
                          busy={busy()}
                        />
                      }
                    >
                      <EditRowForm
                        draft={mode() as EditDraft}
                        onChange={(next) => setMode(next)}
                        onCancel={cancel}
                        onSave={saveEdit}
                        busy={busy()}
                        error={draftError()}
                      />
                    </Show>
                  )}
                </For>
              </ul>
            </Show>
          </div>
          <Show when={!loading() && mode().kind !== "paste"}>
            <Footer
              hasEntries={count() > 0}
              onAdd={startAdd}
              onPaste={startPaste}
              addActive={mode().kind === "add"}
              busy={busy()}
            />
          </Show>
        </Match>
      </Switch>
    </div>
  )
}

// ----- Subcomponents -------------------------------------------------------

function Header(props: { projectLabel: string; count: number }) {
  const language = useLanguage()
  const summary = createMemo(() => {
    if (props.count === 0) return language.t("session.secureEnv.header.summary.empty")
    if (props.count === 1) return language.t("session.secureEnv.header.summary.one")
    return language.t("session.secureEnv.header.summary.other", { count: props.count })
  })
  return (
    <div class="shrink-0 px-3 py-2 border-b border-border-weaker-base">
      <div class="flex items-center gap-1.5 min-w-0">
        <Icon name="status" class="size-3.5 text-text-weak shrink-0" />
        <div class="text-13-medium text-text-strong truncate">
          <Show when={props.projectLabel} fallback={language.t("session.secureEnv.header.fallbackProject")}>
            {props.projectLabel}
          </Show>
        </div>
      </div>
      <div class="mt-1 text-11-regular text-text-weak">{summary()}</div>
      <div class="text-11-regular text-text-weak">{language.t("session.secureEnv.header.redaction")}</div>
    </div>
  )
}

function EmptyState(props: { onAdd: () => void; onPaste: () => void }) {
  const language = useLanguage()
  return (
    <div class="h-full flex flex-col items-center justify-center text-center px-6 py-8 gap-3">
      <Icon name="status" class="size-7 text-text-dimmer" />
      <div class="text-13-regular text-text-weak max-w-60">{language.t("session.secureEnv.empty.body")}</div>
      <div class="flex items-center gap-2 mt-1">
        <Button variant="primary" size="small" icon="plus-small" onClick={props.onAdd}>
          {language.t("session.secureEnv.action.add")}
        </Button>
        <Button variant="secondary" size="small" icon="download" onClick={props.onPaste}>
          {language.t("session.secureEnv.action.paste")}
        </Button>
      </div>
    </div>
  )
}

function SelectionToolbar(props: {
  count: number
  selectedCount: number
  allVisibleSelected: boolean
  onToggleAll: () => void
  onDeleteSelected: () => void
  busy: boolean
}) {
  const language = useLanguage()
  return (
    <Show when={props.count > 0}>
      <li class="px-3 py-2 border-b border-border-weaker-base bg-background-stronger flex items-center justify-between gap-2">
        <label class="min-w-0 flex items-center gap-2 text-11-regular text-text-weak select-none">
          <input
            type="checkbox"
            checked={props.allVisibleSelected}
            onChange={props.onToggleAll}
            disabled={props.busy}
            aria-label={language.t("session.secureEnv.bulk.selectAll")}
          />
          <span class="truncate">
            <Show
              when={props.selectedCount > 0}
              fallback={language.t("session.secureEnv.bulk.selectAll")}
            >
              {language.t("session.secureEnv.bulk.selected", { count: props.selectedCount })}
            </Show>
          </span>
        </label>
        <Show when={props.selectedCount > 0}>
          <Button variant="ghost" size="small" onClick={props.onDeleteSelected} disabled={props.busy}>
            {language.t("session.secureEnv.bulk.deleteSelected")}
          </Button>
        </Show>
      </li>
    </Show>
  )
}

function BulkDeleteConfirm(props: {
  entries: EntryView[]
  onConfirm: () => Promise<void>
  onCancel: () => void
  busy: boolean
}) {
  const language = useLanguage()
  const visibleNames = createMemo(() => props.entries.slice(0, 8).map((entry) => entry.name))
  const overflow = createMemo(() => Math.max(0, props.entries.length - visibleNames().length))
  return (
    <li class="px-3 py-2 border-b border-border-weaker-base bg-background-base">
      <div class="rounded-lg border border-border-warning-base/60 bg-background-stronger px-3 py-2 shadow-xs-border-base">
        <div class="flex items-start gap-2">
          <Icon name="status" class="mt-0.5 size-3.5 shrink-0 text-text-warning" />
          <div class="min-w-0 flex-1">
            <div class="text-12-medium text-text-strong">
              {language.t("session.secureEnv.bulk.confirmTitle", { count: props.entries.length })}
            </div>
            <div class="mt-1 max-h-18 overflow-y-auto text-11-regular text-text-weak font-mono break-all">
              <For each={visibleNames()}>{(name) => <div>{name}</div>}</For>
              <Show when={overflow() > 0}>
                <div class="font-sans">{language.t("session.secureEnv.bulk.more", { count: overflow() })}</div>
              </Show>
            </div>
          </div>
        </div>
      </div>
      <div class="mt-2 flex items-center justify-end gap-1">
        <Button variant="ghost" size="small" onClick={props.onCancel} disabled={props.busy}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="primary" size="small" onClick={() => void props.onConfirm()} disabled={props.busy}>
          {language.t("session.secureEnv.bulk.deleteSelected")}
        </Button>
      </div>
    </li>
  )
}

function Footer(props: {
  hasEntries: boolean
  onAdd: () => void
  onPaste: () => void
  addActive: boolean
  busy: boolean
}) {
  const language = useLanguage()
  return (
    <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border-weaker-base bg-background-stronger">
      <Button
        variant="secondary"
        size="small"
        icon="plus-small"
        onClick={props.onAdd}
        disabled={props.addActive || props.busy}
      >
        {language.t("session.secureEnv.action.add")}
      </Button>
      <Button variant="ghost" size="small" icon="download" onClick={props.onPaste} disabled={props.busy}>
        {language.t("session.secureEnv.action.paste")}
      </Button>
    </div>
  )
}

function RiskChip(props: { risk: Risk }) {
  const language = useLanguage()
  return (
    <span
      class="shrink-0 rounded-full border border-border-weak-base bg-background-stronger px-2 py-0.5 text-10-medium uppercase tracking-[0.08em] text-text-dimmer"
      data-risk={props.risk}
    >
      {language.t(`session.secureEnv.risk.${props.risk}`)}
    </span>
  )
}

function RiskSelect(props: { value: Risk; onChange: (risk: Risk) => void; disabled?: boolean }) {
  const language = useLanguage()
  return (
    <DropdownMenu placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger
        as={Button}
        variant="ghost"
        size="small"
        disabled={props.disabled}
        aria-label={language.t("session.secureEnv.risk.selectLabel")}
      >
        <span class="text-11-medium uppercase tracking-[0.08em] text-text-base">
          {language.t(`session.secureEnv.risk.${props.value}`)}
        </span>
        <Icon name="chevron-down" class="size-3 text-text-weak ml-1" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content>
          <For each={RISK_OPTIONS}>
            {(risk) => (
              <DropdownMenu.Item onSelect={() => props.onChange(risk)}>
                <DropdownMenu.ItemLabel>
                  <span class="text-12-regular text-text-strong">
                    {language.t(`session.secureEnv.risk.${risk}`)}
                  </span>
                </DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

// Fixed dot count so the masked field never leaks the underlying value's length.
function MaskedDots() {
  return <span class="text-12-regular text-text-weak font-mono select-none">••••••••••••••••</span>
}

function EntryRow(props: {
  entry: EntryView
  selected: boolean
  onToggleSelected: () => void
  revealed: boolean
  onToggleReveal: () => void
  onEdit: () => void
  onDelete: () => void
  confirmingDelete: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
  busy: boolean
}) {
  const language = useLanguage()
  return (
    <li class="px-3 py-2.5 border-b border-border-weaker-base group hover:bg-background-base">
      <div class="flex items-center gap-2 min-w-0">
        <input
          type="checkbox"
          checked={props.selected}
          onChange={props.onToggleSelected}
          disabled={props.busy}
          aria-label={language.t("session.secureEnv.bulk.selectEntry", { name: props.entry.name })}
        />
        <div class="min-w-0 flex-1 truncate text-12-medium text-text-strong font-mono">{props.entry.name}</div>
        <RiskChip risk={props.entry.risk} />
      </div>
      <div class="mt-1 flex items-center gap-2 min-w-0">
        <div class="min-w-0 flex-1 truncate">
          <Show when={props.revealed} fallback={<MaskedDots />}>
            <span class="text-12-regular text-text-strong font-mono break-all">{props.entry.value}</span>
          </Show>
        </div>
        <Show when={props.revealed}>
          <Tooltip value={language.t("session.secureEnv.action.copy")} placement="top" gutter={4}>
            <IconButton
              icon="copy"
              variant="ghost"
              class="size-6"
              onClick={() => navigator.clipboard.writeText(props.entry.value).catch(() => undefined)}
              aria-label={language.t("session.secureEnv.action.copy")}
              disabled={props.busy}
            />
          </Tooltip>
        </Show>
        <Tooltip
          value={
            props.revealed
              ? language.t("session.secureEnv.action.hide")
              : language.t("session.secureEnv.action.reveal")
          }
          placement="top"
          gutter={4}
        >
          <IconButton
            icon={props.revealed ? "glasses" : "eye"}
            variant="ghost"
            class="size-6"
            onClick={props.onToggleReveal}
            aria-label={
              props.revealed
                ? language.t("session.secureEnv.action.hide")
                : language.t("session.secureEnv.action.reveal")
            }
            disabled={props.busy}
          />
        </Tooltip>
        <DropdownMenu placement="bottom-end" gutter={4}>
          <Tooltip value={language.t("session.secureEnv.action.more")} placement="top" gutter={4}>
            <DropdownMenu.Trigger
              as={IconButton}
              icon="selector"
              variant="ghost"
              class="size-6"
              aria-label={language.t("session.secureEnv.action.more")}
              disabled={props.busy}
            />
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={props.onEdit}>
                <DropdownMenu.ItemLabel>{language.t("session.secureEnv.action.edit")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={props.onDelete}>
                <DropdownMenu.ItemLabel>{language.t("session.secureEnv.action.delete")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
      <Show when={props.confirmingDelete}>
        <div class="mt-2 flex items-center justify-between gap-2 rounded-md border border-border-warning-base bg-surface-warning-weak px-2 py-1.5">
          <div class="text-11-regular text-text-strong">
            {language.t("session.secureEnv.delete.confirm", { name: props.entry.name })}
          </div>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="small" onClick={props.onCancelDelete} disabled={props.busy}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="small" onClick={props.onConfirmDelete} disabled={props.busy}>
              {language.t("session.secureEnv.action.delete")}
            </Button>
          </div>
        </div>
      </Show>
    </li>
  )
}

function FieldLabel(props: { children: string }) {
  return <div class="text-10-medium uppercase tracking-[0.08em] text-text-dimmer mb-1">{props.children}</div>
}

function NameInput(props: { value: string; onInput: (value: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <input
      type="text"
      value={props.value}
      placeholder={props.placeholder ?? "VARIABLE_NAME"}
      autocomplete="off"
      autocapitalize="characters"
      spellcheck={false}
      disabled={props.disabled}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      class="w-full h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-medium text-text-strong font-mono outline-none focus:border-border-strong-base disabled:opacity-50"
    />
  )
}

function ValueInput(props: { value: string; onInput: (value: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <input
      type="password"
      value={props.value}
      placeholder={props.placeholder}
      autocomplete="off"
      spellcheck={false}
      disabled={props.disabled}
      onInput={(e) => props.onInput(e.currentTarget.value)}
      class="w-full h-8 rounded-md border border-border-weak-base bg-background-base px-2 text-12-regular text-text-strong font-mono outline-none focus:border-border-strong-base disabled:opacity-50"
    />
  )
}

function AddRowForm(props: {
  draft: AddDraft
  onChange: (next: AddDraft) => void
  onCancel: () => void
  onSave: (draft: AddDraft) => Promise<void>
  busy: boolean
  error?: string
}) {
  const language = useLanguage()
  const valueHint = createMemo(() => {
    if (props.draft.value.length === 0) return undefined
    if (props.draft.value.length < MIN_VALUE_LENGTH)
      return language.t("session.secureEnv.error.valueTooShort", { min: MIN_VALUE_LENGTH })
    return undefined
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!props.busy) void props.onSave(props.draft)
      }}
      class="flex flex-col gap-2"
    >
      <div>
        <FieldLabel>{language.t("session.secureEnv.field.name")}</FieldLabel>
        <NameInput
          value={props.draft.name}
          onInput={(name) => props.onChange({ ...props.draft, name })}
          disabled={props.busy}
        />
      </div>
      <div>
        <FieldLabel>{language.t("session.secureEnv.field.value")}</FieldLabel>
        <ValueInput
          value={props.draft.value}
          onInput={(value) => props.onChange({ ...props.draft, value })}
          disabled={props.busy}
          placeholder={language.t("session.secureEnv.field.valuePlaceholder")}
        />
        <Show when={valueHint()} keyed>
          {(hint) => <div class="mt-1 text-11-regular text-text-weak">{hint}</div>}
        </Show>
      </div>
      <div class="flex items-center justify-between gap-2">
        <RiskSelect
          value={props.draft.risk}
          onChange={(risk) => props.onChange({ ...props.draft, risk })}
          disabled={props.busy}
        />
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="small" onClick={props.onCancel} disabled={props.busy} type="button">
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="small" type="submit" disabled={props.busy}>
            {language.t("session.secureEnv.action.save")}
          </Button>
        </div>
      </div>
      <Show when={props.error} keyed>
        {(msg) => <div class="text-11-regular text-text-warning">{msg}</div>}
      </Show>
    </form>
  )
}

function EditRowForm(props: {
  draft: EditDraft
  onChange: (next: EditDraft) => void
  onCancel: () => void
  onSave: (draft: EditDraft) => Promise<void>
  busy: boolean
  error?: string
}) {
  const language = useLanguage()
  const valueHint = createMemo(() => {
    if (props.draft.value.length === 0) return language.t("session.secureEnv.field.valueLeaveBlank")
    if (props.draft.value.length < MIN_VALUE_LENGTH)
      return language.t("session.secureEnv.error.valueTooShort", { min: MIN_VALUE_LENGTH })
    return undefined
  })
  return (
    <li class="px-3 py-3 border-b border-border-weaker-base bg-background-base">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!props.busy) void props.onSave(props.draft)
        }}
        class="flex flex-col gap-2"
      >
        <div>
          <FieldLabel>{language.t("session.secureEnv.field.name")}</FieldLabel>
          <NameInput
            value={props.draft.name}
            onInput={(name) => props.onChange({ ...props.draft, name })}
            disabled={props.busy}
          />
        </div>
        <div>
          <FieldLabel>{language.t("session.secureEnv.field.replaceValue")}</FieldLabel>
          <ValueInput
            value={props.draft.value}
            onInput={(value) => props.onChange({ ...props.draft, value })}
            disabled={props.busy}
            placeholder={language.t("session.secureEnv.field.replaceValuePlaceholder")}
          />
          <Show when={valueHint()} keyed>
            {(hint) => <div class="mt-1 text-11-regular text-text-weak">{hint}</div>}
          </Show>
        </div>
        <div class="flex items-center justify-between gap-2">
          <RiskSelect
            value={props.draft.risk}
            onChange={(risk) => props.onChange({ ...props.draft, risk })}
            disabled={props.busy}
          />
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="small" onClick={props.onCancel} disabled={props.busy} type="button">
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" size="small" type="submit" disabled={props.busy}>
              {language.t("session.secureEnv.action.save")}
            </Button>
          </div>
        </div>
        <Show when={props.error} keyed>
          {(msg) => <div class="text-11-regular text-text-warning">{msg}</div>}
        </Show>
      </form>
    </li>
  )
}

function PasteForm(props: {
  draft: PasteDraft
  onChange: (next: PasteDraft) => void
  onCancel: () => void
  onSave: (draft: PasteDraft) => Promise<void>
  busy: boolean
  error?: string
}) {
  const language = useLanguage()
  return (
    <div class="flex-1 min-h-0 flex flex-col">
      <div class="shrink-0 px-3 py-2 border-b border-border-weaker-base">
        <div class="text-12-medium text-text-strong">{language.t("session.secureEnv.paste.title")}</div>
        <div class="mt-0.5 text-11-regular text-text-weak">{language.t("session.secureEnv.paste.description")}</div>
      </div>
      <div class="flex-1 min-h-0 px-3 pt-3">
        <textarea
          value={props.draft.content}
          onInput={(e) => props.onChange({ ...props.draft, content: e.currentTarget.value })}
          placeholder={language.t("session.secureEnv.paste.placeholder")}
          spellcheck={false}
          autocomplete="off"
          disabled={props.busy}
          class="w-full h-full min-h-32 rounded-md border border-border-weak-base bg-background-base px-2 py-2 text-12-regular text-text-strong font-mono outline-none focus:border-border-strong-base resize-none disabled:opacity-50"
        />
      </div>
      <div class="shrink-0 px-3 py-2 flex items-center justify-between gap-2 border-t border-border-weaker-base">
        <div class="flex items-center gap-2 min-w-0">
          <RiskSelect
            value={props.draft.risk}
            onChange={(risk) => props.onChange({ ...props.draft, risk })}
            disabled={props.busy}
          />
          <label class="flex items-center gap-1.5 text-11-regular text-text-weak select-none">
            <input
              type="checkbox"
              checked={props.draft.overwrite}
              onChange={(e) => props.onChange({ ...props.draft, overwrite: e.currentTarget.checked })}
              disabled={props.busy}
            />
            {language.t("session.secureEnv.paste.overwrite")}
          </label>
        </div>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="small" onClick={props.onCancel} disabled={props.busy}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={() => void props.onSave(props.draft)}
            disabled={props.busy || props.draft.content.trim().length === 0}
          >
            {language.t("session.secureEnv.paste.import")}
          </Button>
        </div>
      </div>
      <Show when={props.error} keyed>
        {(msg) => (
          <div class="shrink-0 px-3 pb-2 text-11-regular text-text-warning border-t border-border-weaker-base">
            {msg}
          </div>
        )}
      </Show>
    </div>
  )
}
