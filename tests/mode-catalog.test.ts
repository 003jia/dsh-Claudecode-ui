import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createModeCatalog } from '../src/client/mode-catalog.ts'

const first = SessionId('blank-a')
const second = SessionId('blank-b')
const roster: AgentPresetRoster = { presets: [
  { id: 'standard', isDefault: true },
  { id: 'cordis', isDefault: false },
  { id: 'ptc', isDefault: false },
  { id: 'minimal', isDefault: false },
  { id: 'long-task', name: '长任务', isDefault: false },
  { id: 'broken', isDefault: false, broken: 'Missing dependency' },
] }

function row(id = first, preset = 'standard', blank = true): SessionSummary {
  return { id, displayTitle: id, blank, running: false, retainedBy: { mainView: 1 },
    updatedAt: 0, projectionValues: { agentPreset: preset } }
}

function harness() {
  const ctx = new Context()
  const list = createSnapshotStore<SessionListState>({
    ids: [first], byId: { [first]: row() }, phase: 'ready', projectionsBySession: {},
  })
  const tools = createSnapshotStore(true)
  let allowed = true
  let selectionCalls = 0
  let listCalls = 0
  const accessObservers = new Set<(value: boolean) => void>()
  const remoteObservers = new Set<(...args: string[]) => void>()
  const commit = (id: SessionId, preset: string): void => {
    const before = list.getSnapshot()
    const previous = before.byId[id]
    if (previous) list.set({ ...before, byId: { ...before.byId,
      [id]: { ...previous, projectionValues: { agentPreset: preset } } } })
  }
  let selectResponse = async (id: SessionId, preset: string): Promise<RemoteResult<string>> => {
    commit(id, preset)
    return { ok: true, value: preset }
  }
  let listResponse = async (): Promise<RemoteResult<AgentPresetRoster>> => ({ ok: true, value: roster })
  ctx.provide('sessions', { list, refresh: async () => {} })
  ctx.provide('configForms', { developerTools: { enabled: tools } })
  ctx.provide('uiSession', {
    whenAccess(_id: SessionId, action: string, callback: () => () => void) {
      assert.equal(action, 'agentPresets/select')
      let release: (() => void) | undefined
      const observe = (value: boolean): void => {
        if (value && !release) release = callback()
        else if (!value && release) { const stop = release; release = undefined; stop() }
      }
      accessObservers.add(observe)
      observe(allowed)
      return () => { accessObservers.delete(observe); observe(false) }
    },
  })
  ctx.provide('remote', {
    agentPresets: {
      list: () => { listCalls++; return listResponse() },
      select: (id: SessionId, preset: string) => { selectionCalls++; return selectResponse(id, preset) },
    },
    $on(_event: string, callback: (...args: string[]) => void) {
      remoteObservers.add(callback)
      return () => { remoteObservers.delete(callback) }
    },
  })
  const catalog = createModeCatalog(ctx)
  return {
    catalog, list, tools, commit,
    selectUsing: (callback: typeof selectResponse) => { selectResponse = callback },
    listUsing: (callback: typeof listResponse) => { listResponse = callback },
    allow: (value: boolean) => { allowed = value; for (const observe of accessObservers) observe(value) },
    navigate: (session: SessionSummary) => list.set({ ...list.getSnapshot(), ids: [session.id], byId: { [session.id]: session } }),
    calls: () => ({ select: selectionCalls, list: listCalls }),
    subscriptions: () => ({ access: accessObservers.size, remote: remoteObservers.size }),
  }
}

test('loads every Host row and selects through the existing blank Session', async () => {
  const h = harness()
  try {
    await h.catalog.load()
    assert.deepEqual(h.catalog.store.getSnapshot().options.map(option => option.id), roster.presets.map(option => option.id))
    assert.equal(await h.catalog.select('long-task'), true)
    assert.equal(h.catalog.store.getSnapshot().current, 'long-task')
    assert.equal(h.catalog.store.getSnapshot().sessionId, first)
    assert.equal(h.catalog.store.getSnapshot().busy, false)
    assert.equal(h.calls().select, 1)
  } finally { h.catalog.dispose() }
})

test('a Host refusal keeps the accepted preset and exposes its failure', async () => {
  const h = harness()
  try {
    await h.catalog.load()
    h.selectUsing(async () => ({ ok: false, error: {
      code: 'agent-preset/locked', message: 'Already started', details: { sessionId: first, agentPreset: 'cordis' },
    } }))
    assert.equal(await h.catalog.select('cordis'), false)
    assert.equal(h.catalog.store.getSnapshot().current, 'standard')
    assert.equal(h.catalog.store.getSnapshot().error, 'Already started')
    assert.equal(h.catalog.store.getSnapshot().busy, false)
  } finally { h.catalog.dispose() }
})

test('access revocation and started Sessions block selection before any RPC', async () => {
  const h = harness()
  try {
    await h.catalog.load()
    h.allow(false)
    assert.equal(h.catalog.store.getSnapshot().blocked, 'read-only')
    assert.equal(await h.catalog.select('cordis'), false)
    h.allow(true)
    h.navigate(row(first, 'standard', false))
    assert.equal(h.catalog.store.getSnapshot().blocked, 'started')
    assert.equal(await h.catalog.select('cordis'), false)
    assert.equal(h.calls().select, 0)
  } finally { h.catalog.dispose() }
})

test('broken and Coding Tools-only modes stay visible while disabled', async () => {
  const h = harness()
  try {
    await h.catalog.load()
    h.tools.set(false)
    const state = h.catalog.store.getSnapshot()
    assert.equal(state.options.find(option => option.id === 'ptc')?.blockedByCodingTools, true)
    assert.equal(state.options.find(option => option.id === 'minimal')?.blockedByCodingTools, true)
    assert.equal(await h.catalog.select('ptc'), false)
    assert.equal(await h.catalog.select('broken'), false)
    assert.equal(h.calls().select, 0)
    h.tools.set(true)
    assert.equal(await h.catalog.select('ptc'), true)
  } finally { h.catalog.dispose() }
})

test('a late selection response cannot change the newly displayed Session', async () => {
  const h = harness()
  try {
    await h.catalog.load()
    const deferred = Promise.withResolvers<RemoteResult<string>>()
    h.selectUsing(() => deferred.promise)
    const attempt = h.catalog.select('cordis')
    h.navigate(row(second, 'long-task'))
    deferred.resolve({ ok: true, value: 'cordis' })
    assert.equal(await attempt, false)
    assert.equal(h.catalog.store.getSnapshot().current, 'long-task')
    assert.equal(h.catalog.store.getSnapshot().sessionId, second)
    assert.equal(h.calls().select, 1)
  } finally { h.catalog.dispose() }
})

test('a later native-picker choice wins over an earlier sidebar response', async () => {
  const h = harness()
  try {
    await h.catalog.load()
    const deferred = Promise.withResolvers<RemoteResult<string>>()
    h.selectUsing(() => deferred.promise)
    const attempt = h.catalog.select('cordis')
    h.commit(first, 'long-task')
    deferred.resolve({ ok: true, value: 'cordis' })
    assert.equal(await attempt, false)
    assert.equal(h.catalog.store.getSnapshot().current, 'long-task')
    assert.equal(h.calls().select, 1)
  } finally { h.catalog.dispose() }
})

test('disposal withdraws listeners and ignores an unfinished roster response', async () => {
  const h = harness()
  const deferred = Promise.withResolvers<RemoteResult<AgentPresetRoster>>()
  h.listUsing(() => deferred.promise)
  const firstRead = h.catalog.load()
  assert.equal(h.catalog.load(), firstRead)
  h.catalog.dispose()
  const snapshot = h.catalog.store.getSnapshot()
  deferred.resolve({ ok: true, value: roster })
  await firstRead
  assert.equal(h.catalog.store.getSnapshot(), snapshot)
  assert.deepEqual(h.subscriptions(), { access: 0, remote: 0 })
  assert.equal(h.calls().list, 1)
  assert.equal(await h.catalog.select('cordis'), false)
})
