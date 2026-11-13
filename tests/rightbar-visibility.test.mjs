import assert from 'node:assert/strict'
import test from 'node:test'
import { observeRightbarEntry } from '../src/client/rightbar-visibility.ts'

function nativeFace(initial, layouts = {}) {
  let mounted = initial
  const listeners = new Set()
  const adopted = new Map(Object.entries(layouts).map(([id, expanded]) => [id, { expanded, tabs: ['details', 'file'] }]))
  const transitions = []
  const right = {
    mounted: { getSnapshot: () => mounted, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } },
    commandTarget: () => adopted.has(mounted) ? { sessionId: mounted } : undefined,
    isExpanded: () => adopted.get(mounted)?.expanded ?? false,
    toggleExpanded: () => {
      const layout = adopted.get(mounted)
      assert.ok(layout, 'must not toggle an unadopted Session')
      layout.expanded = !layout.expanded
      transitions.push([mounted, layout.expanded])
    },
  }
  return {
    right, adopted, transitions, listeners,
    select: id => { mounted = id; for (const fn of listeners) fn() },
    adopt: (id, expanded) => adopted.set(id, { expanded, tabs: ['details', 'file'] }),
    open: () => { adopted.get(mounted).expanded = true },
  }
}

test('startup collapses an adopted saved surface without removing its tabs', () => {
  const f = nativeFace('A', { A: true })
  const tabs = f.adopted.get('A').tabs
  const policy = observeRightbarEntry(f.right)
  assert.equal(f.right.isExpanded(), false)
  assert.equal(f.adopted.get('A').tabs, tabs)
  assert.deepEqual(f.transitions, [['A', false]])
  policy.dispose()
})

test('late adoption settles once, then synchronous and asynchronous explicit opens survive', async () => {
  const f = nativeFace('A')
  const policy = observeRightbarEntry(f.right)
  policy.check()
  assert.equal(f.transitions.length, 0)
  f.adopt('A', true)
  policy.check()
  f.open()
  policy.check()
  await Promise.resolve()
  f.open()
  policy.check()
  assert.equal(f.right.isExpanded(), true)
  assert.deepEqual(f.transitions, [['A', false]])
  policy.dispose()
})

test('switching and returning close each restored foreground surface, never the background', () => {
  const f = nativeFace('A', { A: false, B: true })
  const policy = observeRightbarEntry(f.right)
  f.open()
  f.select('B')
  assert.equal(f.adopted.get('A').expanded, true)
  assert.equal(f.adopted.get('B').expanded, false)
  f.open()
  f.select('A')
  assert.equal(f.adopted.get('A').expanded, false)
  assert.equal(f.adopted.get('B').expanded, true)
  assert.deepEqual(f.transitions, [['B', false], ['A', false]])
  policy.dispose()
})

test('rapid selections and global-panel absence cannot collapse the wrong Session', () => {
  const f = nativeFace('A')
  const policy = observeRightbarEntry(f.right)
  f.select('B')
  f.adopt('A', true)
  policy.check()
  assert.equal(f.adopted.get('A').expanded, true)
  f.select(undefined)
  f.adopt('B', true)
  policy.check()
  assert.equal(f.adopted.get('B').expanded, true)
  f.select('B')
  assert.equal(f.adopted.get('B').expanded, false)
  policy.dispose()
})

test('a fresh empty collapsed surface stays collapsed and disposal stops all writes', () => {
  const f = nativeFace('A', { A: false })
  f.adopted.get('A').tabs = []
  const policy = observeRightbarEntry(f.right)
  f.open()
  policy.check()
  assert.equal(f.right.isExpanded(), true)
  policy.dispose()
  f.select(undefined)
  f.select('A')
  policy.check()
  assert.equal(f.right.isExpanded(), true)
  assert.equal(f.transitions.length, 0)
  assert.equal(f.listeners.size, 0)
})
