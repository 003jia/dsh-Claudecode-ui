import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { installComposerLayout } from '../src/client/composer-v2.ts'

const sourceRequire = createRequire(resolve(process.env.DSH_SOURCE ?? resolve(import.meta.dirname, '../../../dsh-upgrades/upgrade-0.2.2-alpha.2'), 'package.json'))
const { JSDOM } = sourceRequire('jsdom')
const marker = 'data-claude-composer-v2'

function fixture() {
  const dom = new JSDOM(`<!doctype html><html><body><section data-content-phase="active">
    <div data-composer-card>
      <div data-composer-overlay></div>
      <div data-slot="conversation.input.attachments"></div>
      <div data-input-scroll><div contenteditable="true" data-composer-input>Draft remains here</div></div>
      <div class="native-row">
        <div><button aria-haspopup="listbox">Add</button><input type="file" multiple hidden><div>Permission</div><div data-slot="conversation.input.left">Plugin left</div></div>
        <div><div><div data-slot="conversation.input.right">Plugin right</div><div data-slot="conversation.input.model">Model</div></div><div data-slot="conversation.input.activity"></div><button>Send</button></div>
      </div>
    </div></section></body></html>`, { pretendToBeVisual: true })
  const { window } = dom
  let width = 820
  const card = window.document.querySelector('[data-composer-card]')
  card.getBoundingClientRect = () => ({ width })
  const row = card.querySelector('.native-row')
  const observations = []
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.observed = new Set(); this.disconnected = false; observations.push(this) }
    observe(element) { this.observed.add(element) }
    unobserve(element) { this.observed.delete(element) }
    disconnect() { this.disconnected = true; this.observed.clear() }
  }
  const settle = () => new Promise(resolve => window.setTimeout(resolve, 35))
  return { dom, window, card, row, observations, settle, setWidth(value) { width = value; window.dispatchEvent(new window.Event('resize')) } }
}

test('compact layout keeps the resident draft, attachment slot and native controls', () => {
  const f = fixture()
  const before = [...f.card.querySelectorAll('*')]
  let submitted = 0
  f.row.lastElementChild.lastElementChild.addEventListener('click', () => submitted++)
  const dispose = installComposerLayout(f.window.document)
  assert.equal(f.card.hasAttribute(marker), true)
  assert.deepEqual([...f.card.querySelectorAll('*')], before)
  assert.equal(f.card.querySelector('[data-composer-input]').textContent, 'Draft remains here')
  f.row.lastElementChild.lastElementChild.click()
  assert.equal(submitted, 1)
  assert.equal(f.card.querySelector('[data-slot="conversation.input.left"]').textContent, 'Plugin left')
  assert.equal(f.card.querySelector('[data-slot="conversation.input.right"]').textContent, 'Plugin right')
  dispose()
  assert.equal(f.card.hasAttribute(marker), false)
  assert.equal(f.observations[0].disconnected, true)
  f.window.close()
})

test('attachments, activity, dual primary actions and a narrow card retain native layout', async () => {
  const f = fixture()
  const dispose = installComposerLayout(f.window.document)
  const attachments = f.card.querySelector('[data-slot="conversation.input.attachments"]')
  const preview = f.window.document.createElement('button')
  preview.textContent = 'Remove uploaded file'
  attachments.append(preview)
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), false)
  assert.equal(attachments.firstElementChild, preview)
  preview.remove()
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), true)
  f.row.firstElementChild.hidden = true
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), false)
  f.row.firstElementChild.hidden = false
  await f.settle()
  const stop = f.window.document.createElement('button')
  stop.textContent = 'Stop'
  f.row.lastElementChild.append(stop)
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), false)
  stop.remove()
  f.setWidth(500)
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), false)
  f.setWidth(700)
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), true)
  dispose()
  f.window.close()
})

test('unknown accessory and inactive conversation restore layout; disposal restores prior marker', async () => {
  const f = fixture()
  f.card.setAttribute(marker, 'previous')
  const dispose = installComposerLayout(f.window.document)
  const accessory = f.window.document.createElement('div')
  accessory.textContent = 'A custom composer accessory'
  f.card.prepend(accessory)
  await f.settle()
  assert.equal(f.card.hasAttribute(marker), false)
  accessory.remove()
  f.card.parentElement.setAttribute('data-content-phase', 'hero')
  await f.settle()
  assert.equal(f.card.getAttribute(marker), 'previous')
  assert.equal(f.observations[0].observed.size, 0)
  dispose()
  assert.equal(f.card.getAttribute(marker), 'previous')
  f.window.close()
})
