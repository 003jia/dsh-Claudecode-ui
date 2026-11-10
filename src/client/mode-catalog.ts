/** Live mode choices and blank-session selection through DSH's public services. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { isBuiltInPreset } from '@deepseek-ai/dsh-agent-preset-registry/display'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** A Host roster row, including the same Coding Tools gate as the native picker. */
export interface ModeOption extends AgentPresetRow {
  readonly blockedByCodingTools: boolean
}

/** Current roster and the main conversation's authoritative selection. */
export interface ModeCatalogState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly options: readonly ModeOption[]
  readonly current: string
  readonly sessionId: SessionId | null
  readonly busy: boolean
  readonly writable: boolean
  readonly blocked: 'no-session' | 'started' | 'read-only' | null
  readonly error: string | null
}

/** Registration-owned handle; components receive its store through inject hooks. */
export interface ModeCatalog {
  readonly store: SnapshotStore<ModeCatalogState>
  /** Refresh the roster; simultaneous reads share one request. */
  load(): Promise<void>
  /** Select only for the currently displayed blank Session; never creates a Session. */
  select(id: string): Promise<boolean>
  /** Withdraw listeners and ignore in-flight read or selection completions. */
  dispose(): void
}

/**
 * Create the sidebar's mode adapter without replacing the native preset owner.
 * @param ctx - Plugin context injecting sessions, uiSession, remote.agentPresets and configForms.
 * @returns A disposable roster and explicit selection face.
 */
export function createModeCatalog(ctx: Context): ModeCatalog {
  const store = createSnapshotStore<ModeCatalogState>({
    status: 'idle', options: [], current: '', sessionId: null,
    busy: false, writable: false, blocked: 'no-session', error: null,
  })
  const developerTools = ctx.configForms.developerTools.enabled
  let rows: readonly AgentPresetRow[] = []
  let alive = true
  let loading: Promise<void> | undefined
  let selecting = false
  let accessSessionId: SessionId | null = null
  let allowed = false
  let stopAccess: () => void = () => {}
  let syncing = false
  let resync = false

  const main = (): SessionSummary | undefined => {
    const candidates = Object.values(ctx.sessions.list.getSnapshot().byId)
      .filter(session => (session.retainedBy.mainView ?? 0) > 0)
    // Never guess a target while navigation temporarily owns two bindings.
    return candidates.length === 1 ? candidates[0] : undefined
  }
  const sync = (): void => {
    if (!alive) return
    if (syncing) { resync = true; return }
    syncing = true
    try {
      do {
        resync = false
        const session = main()
        const sessionId = session?.id ?? null
        if (sessionId !== accessSessionId) {
          const previous = stopAccess
          stopAccess = () => {}
          accessSessionId = sessionId
          allowed = false
          previous()
          if (sessionId !== null) {
            stopAccess = ctx.uiSession.whenAccess(sessionId, 'agentPresets/select', () => {
              allowed = true; sync()
              return () => { allowed = false; sync() }
            })
          }
        }
        const before = store.getSnapshot()
        const projected = session?.projectionValues?.agentPreset
        const current = typeof projected === 'string' ? projected : ''
        const blocked = session === undefined || session.origin === 'subagent' ? 'no-session'
          : !session.blank || session.running ? 'started'
            : !allowed ? 'read-only' : null
        const toolsEnabled = developerTools.getSnapshot()
        const options = rows.map(row => ({
          ...row,
          blockedByCodingTools: !toolsEnabled && isBuiltInPreset(row)
            && (row.id === 'ptc' || row.id === 'minimal'),
        }))
        store.set({
          ...before, sessionId, current, options, blocked, busy: selecting,
          writable: blocked === null && !selecting && before.status === 'ready',
          error: before.sessionId !== sessionId && before.status !== 'error' ? null : before.error,
        })
      } while (resync && alive)
    } finally { syncing = false }
  }
  const failure = (error: unknown): string => error instanceof Error ? error.message : String(error)
  const load = (): Promise<void> => {
    if (!alive) return Promise.resolve()
    if (loading !== undefined) return loading
    store.set({ ...store.getSnapshot(), status: 'loading', error: null, writable: false })
    loading = (async () => {
      try {
        const result = await ctx.remote.agentPresets.list()
        if (!alive) return
        if (!result.ok) {
          store.set({ ...store.getSnapshot(), status: 'error', error: result.error.message })
          return
        }
        rows = result.value.presets
        store.set({ ...store.getSnapshot(), status: 'ready', error: null })
      } catch (error) {
        if (alive) store.set({ ...store.getSnapshot(), status: 'error', error: failure(error) })
      } finally { loading = undefined; sync() }
    })()
    return loading
  }
  const select = async (id: string): Promise<boolean> => {
    sync()
    const before = store.getSnapshot()
    const row = before.options.find(option => option.id === id)
    if (!alive || !before.writable || before.sessionId === null
      || row === undefined || row.broken !== undefined || row.blockedByCodingTools) return false
    if (before.current === id) return true
    const sessionId = before.sessionId
    selecting = true
    store.set({ ...before, busy: true, writable: false, error: null })
    try {
      const result = await ctx.remote.agentPresets.select(sessionId, id)
      if (!alive) return false
      if (!result.ok) {
        if (main()?.id === sessionId) store.set({ ...store.getSnapshot(), error: result.error.message })
        return false
      }
      // Publish only Session Controller facts. The native picker can change the
      // same Session, so no local staged value may overwrite its later choice.
      await ctx.sessions.refresh()
      sync()
      const after = store.getSnapshot()
      return alive && after.sessionId === sessionId && after.current === result.value && result.value === id
    } catch (error) {
      if (alive && main()?.id === sessionId) store.set({ ...store.getSnapshot(), error: failure(error) })
      return false
    } finally { selecting = false; sync() }
  }
  const subscriptions = [
    ctx.sessions.list.subscribe(sync),
    developerTools.subscribe(sync),
    ctx.remote.$on('settings/document-updated', ns => {
      if (ns === 'agent-preset-registry') void load()
    }),
    ctx.on('connection/reset', () => { void load() }),
  ]
  sync()
  return { store, load, select, dispose: () => {
    if (!alive) return
    alive = false
    for (const stop of subscriptions) stop()
    stopAccess()
  } }
}
