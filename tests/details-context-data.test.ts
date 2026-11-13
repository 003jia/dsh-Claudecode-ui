import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveContextData, readContextTools } from '../src/client/details-context-data.ts'

test('missing measurements stay unknown instead of appearing as zero', () => {
  const empty = deriveContextData(undefined, undefined, undefined, undefined)
  assert.equal(empty.used, undefined)
  assert.equal(empty.capacity, undefined)
  assert.equal(empty.percent, undefined)
  assert.equal(empty.tools, undefined)
  assert.ok(empty.rows.every(row => row.tokens === undefined))
  const measured = deriveContextData({ pressureTokens: 0, contextWindow: 1000 }, { messageTokens: 0, toolsTokens: 0, systemTokens: 0 }, { headers: [{ tools: [] }] }, { ok: true, current: { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 } })
  assert.equal(measured.percent, 0)
  assert.equal(measured.rows.find(row => row.key === 'mcp')?.tokens, 0)
  assert.equal(measured.rows.find(row => row.key === 'skills')?.tokens, 0)
  assert.equal(measured.rows.find(row => row.key === 'free')?.tokens, 1000)
  for (const key of ['instructions', 'memory', 'buffer']) assert.equal(measured.rows.find(row => row.key === key)?.tokens, undefined)
})

test('MCP and skill subdivisions preserve their native parent estimates', () => {
  const data = deriveContextData({ projectedTokens: 800, pressureTokens: 750, contextWindow: 1000 }, { messageTokens: 300, toolsTokens: 200, systemTokens: 70 }, { headers: [{ tools: [{ name: 'mcp__search', tokens: 9 }, { name: 'read', tokens: 21 }] }] }, { ok: true, current: { user: 30, inject: 10, skill: 20, assistant: 20, tool: 20 } })
  const rows = Object.fromEntries(data.rows.map(row => [row.key, row.tokens]))
  assert.equal(rows.mcp, 60)
  assert.equal(rows.otherTools, 140)
  assert.equal(rows.mcp + rows.otherTools, 200)
  assert.equal(rows.skills, 60)
  assert.equal(rows.messages + rows.skills, 300)
  assert.equal(rows.system, 70)
  assert.equal(data.percent, 80)
  assert.equal(data.used, 800)
  assert.equal(data.estimated, true)
  assert.notEqual(rows.mcp + rows.otherTools + rows.messages + rows.skills + rows.system, data.used)
})

test('all latest-header tool entries remain available beyond ten and across MCP sources', () => {
  const tools = Array.from({ length: 36 }, (_, index) => ({ name: `tool-${index}`, tokens: index, plugin: index % 2 ? 'mcp:testing' : 'native' }))
  const headers = { headers: [{ tools: [{ name: 'old', tokens: 10 }] }, { tools }] }
  assert.deepEqual(readContextTools(headers), tools)
  const data = deriveContextData(undefined, undefined, headers, undefined)
  assert.equal(data.tools?.length, 36)
  assert.equal(data.mcp?.length, 18)
  assert.equal(data.otherTools?.length, 18)
  assert.equal(data.tools?.at(-1)?.name, 'tool-35')
})

test('malformed optional data does not yield a misleading partial measurement', () => {
  assert.equal(readContextTools({ headers: [{ tools: [{ name: 'good', tokens: 10 }, { name: 'bad', tokens: NaN }] }] }), undefined)
  const data = deriveContextData({ contextWindow: 0, pressureTokens: -1, projectedTokens: NaN }, undefined, { headers: [] }, { ok: true, current: { user: 5, skill: 10 } })
  assert.equal(data.percent, undefined)
  assert.equal(data.capacity, undefined)
  assert.equal(data.used, undefined)
  assert.equal(data.rows.find(row => row.key === 'skills')?.tokens, undefined)
  assert.equal(data.messages?.find(row => row.key === 'assistant')?.tokens, undefined)
})
