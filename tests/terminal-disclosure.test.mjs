import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { installRunningTerminalDisclosure } from '../src/client/terminal-disclosure.ts'

const require = createRequire(resolve(process.env.DSH_SOURCE ?? resolve(import.meta.dirname, '../../../dsh-upgrades/upgrade-0.2.2-alpha.2'), 'package.json'))
const { JSDOM } = require('jsdom')

function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><input id="draft"><button id="approve">Approve</button><button id="stop">Stop</button><button id="group">Group</button><main></main></body></html>', { pretendToBeVisual: true })
  const { window: win } = dom
  const observers = []
  win.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.rows = new Set(); this.disconnected = false; observers.push(this) }
    observe(row) { this.rows.add(row) }
    unobserve(row) { this.rows.delete(row) }
    disconnect() { this.rows.clear(); this.disconnected = true }
    show(row, visible = true) {
      this.callback([{ target: row, isIntersecting: visible, intersectionRect: { width: visible ? 700 : 0, height: visible ? 32 : 0 } }])
    }
  }
  let forbiddenClicks = 0
  for (const id of ['approve', 'stop', 'group']) win.document.getElementById(id).addEventListener('click', () => forbiddenClicks++)
  const add = ({ session = 's1', call = 'c1', flow = 'tool:c1', state = 'running', expanded = false } = {}) => {
    const container = win.document.createElement('section')
    container.dataset.conversationSession = session
    container.innerHTML = `<div data-chat-flow-kind="tool-call" data-chat-flow-key="${flow}"><div data-chat-call-id="${call}"><div data-slot="tool.call.toolview"><div class="native_card"><div class="native_root" data-sample="bash" data-variant="bash" data-state="${state}" data-expandable="true" role="button" tabindex="0" aria-expanded="${expanded}"><span class="native_leading"><svg></svg></span><span class="native_status">Running</span><span data-shimmer="true">Bash · command</span></div></div></div></div></div>`
    win.document.querySelector('main').append(container)
    const row = container.querySelector('[data-sample]')
    row.getClientRects = () => [{ width: 700, height: 32 }]
    let clicks = 0
    row.addEventListener('click', () => { clicks++; row.setAttribute('aria-expanded', String(row.getAttribute('aria-expanded') !== 'true')) })
    return { container, row, clicks: () => clicks }
  }
  const settle = () => new Promise(resolve => win.setTimeout(resolve, 35))
  return { win, add, observers, settle, forbiddenClicks: () => forbiddenClicks, close: () => win.close() }
}

test('opens only the visible native running disclosure once and retains editor focus', async () => {
  const f = fixture()
  const a = f.add()
  const draft = f.win.document.getElementById('draft')
  draft.focus()
  const dispose = installRunningTerminalDisclosure(f.win.document)
  const io = f.observers[0]
  assert.equal(a.clicks(), 0)
  io.show(a.row)
  await f.settle()
  assert.equal(a.clicks(), 1)
  assert.equal(a.row.getAttribute('aria-expanded'), 'true')
  assert.equal(f.win.document.activeElement, draft)
  assert.equal(f.forbiddenClicks(), 0)
  a.row.click()
  await f.settle()
  io.show(a.row)
  assert.equal(a.clicks(), 2)
  assert.equal(a.row.getAttribute('aria-expanded'), 'false')
  dispose(); f.close()
})

test('a remounted call stays closed after a user collapse, with identity scoped by session and call', async () => {
  const f = fixture()
  const a = f.add()
  const dispose = installRunningTerminalDisclosure(f.win.document)
  const io = f.observers[0]
  io.show(a.row)
  a.row.click()
  a.container.remove()
  const again = f.add()
  const otherSession = f.add({ session: 's2' })
  const subcall = f.add({ call: 'c2' })
  await f.settle()
  for (const item of [again, otherSession, subcall]) io.show(item.row)
  assert.equal(again.clicks(), 0)
  assert.equal(otherSession.clicks(), 1)
  assert.equal(subcall.clicks(), 1)
  dispose(); f.close()
})

test('preparing, historical, stopped, failed and non-native shapes never trigger actions', async () => {
  const f = fixture()
  const rows = ['preparing', 'ok', 'error', 'stopped'].map((state, i) => f.add({ call: 'c'+i, state }))
  const generic = f.add({ call: 'generic' }); generic.row.removeAttribute('data-sample')
  const unknown = f.add({ call: 'unknown' }); unknown.row.querySelector('svg').remove()
  const interactive = f.add({ call: 'interactive' }); interactive.row.append(f.win.document.createElement('button'))
  const dispose = installRunningTerminalDisclosure(f.win.document)
  const io = f.observers[0]
  for (const item of rows) io.show(item.row)
  await f.settle()
  for (const item of [...rows, generic, unknown, interactive]) assert.equal(item.clicks(), 0)
  assert.equal(io.rows.has(unknown.row), false)
  assert.equal(io.rows.has(interactive.row), false)
  assert.equal(f.forbiddenClicks(), 0)
  dispose(); f.close()
})

test('hidden or clipped rows wait for visibility; failure after auto-open remains open', async () => {
  const f = fixture()
  const a = f.add()
  a.container.hidden = true
  const dispose = installRunningTerminalDisclosure(f.win.document)
  const io = f.observers[0]
  io.show(a.row)
  assert.equal(a.clicks(), 0)
  io.show(a.row, false)
  a.container.hidden = false
  await f.settle()
  assert.equal(a.clicks(), 0)
  io.show(a.row)
  assert.equal(a.clicks(), 1)
  a.row.dataset.state = 'error'
  await f.settle()
  assert.equal(a.row.getAttribute('aria-expanded'), 'true')
  assert.equal(a.clicks(), 1)
  dispose(); f.close()
})

test('an already open row and an early user keyboard/click choice are never overridden', async () => {
  const f = fixture()
  const open = f.add({ expanded: true })
  const early = f.add({ call: 'early' })
  const dispose = installRunningTerminalDisclosure(f.win.document)
  const io = f.observers[0]
  io.show(open.row)
  open.row.click()
  early.row.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  io.show(early.row)
  await f.settle()
  assert.equal(open.row.getAttribute('aria-expanded'), 'false')
  assert.equal(open.clicks(), 1)
  assert.equal(early.clicks(), 0)
  dispose(); f.close()
})

test('disposal disconnects pending work without toggling native state', async () => {
  const f = fixture()
  const a = f.add()
  const dispose = installRunningTerminalDisclosure(f.win.document)
  const io = f.observers[0]
  io.show(a.row)
  const late = f.add({ call: 'late' })
  dispose()
  await f.settle()
  io.show(late.row)
  assert.equal(io.disconnected, true)
  assert.equal(late.clicks(), 0)
  assert.equal(a.row.getAttribute('aria-expanded'), 'true')
  assert.equal(f.forbiddenClicks(), 0)
  f.close()
})
