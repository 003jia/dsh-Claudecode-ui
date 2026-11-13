/** Validated, presentation-only context facts; no fabricated missing measurements. */
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'

export type ContextRowKey = 'mcp' | 'messages' | 'tools' | 'otherTools' | 'system' | 'skills' | 'instructions' | 'memory' | 'buffer' | 'free'
export type MessageRowKey = 'user' | 'inject' | 'skill' | 'assistant' | 'tool'
export interface ContextTool { name: string; tokens: number; plugin?: string }
export interface ContextRow { key: ContextRowKey; color: string; tokens?: number }
export interface ContextData {
  used?: number
  capacity?: number
  percent?: number
  estimated: boolean
  rows: ContextRow[]
  tools?: ContextTool[]
  mcp?: ContextTool[]
  otherTools?: ContextTool[]
  messages?: { key: MessageRowKey; tokens?: number }[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Read every valid entry in the latest tool header, retaining the original order. */
export function readContextTools(value: unknown): ContextTool[] | undefined {
  const headers = record(value)?.headers
  if (!Array.isArray(headers) || headers.length === 0) return undefined
  const tools = record(headers.at(-1))?.tools
  if (!Array.isArray(tools)) return undefined
  const parsed: ContextTool[] = []
  for (const value of tools) {
    const tool = record(value)
    const tokens = count(tool?.tokens)
    // A malformed optional projection is unknown, not a misleading partial sum.
    if (typeof tool?.name !== 'string' || tokens === undefined) return undefined
    parsed.push({ name: tool.name, tokens, plugin: typeof tool.plugin === 'string' ? tool.plugin : undefined })
  }
  return parsed
}

/** Derive all display rows without equating heuristic composition to provider usage. */
export function deriveContextData(
  pressure: ContextPressureProjection | undefined,
  breakdown: ContextBreakdownProjection | undefined,
  headers: unknown,
  timeline: unknown,
): ContextData {
  const used = count(pressure?.projectedTokens) ?? count(pressure?.pressureTokens)
  const rawCapacity = count(pressure?.contextWindow)
  const capacity = rawCapacity !== undefined && rawCapacity > 0 ? rawCapacity : undefined
  const tools = readContextTools(headers)
  const mcp = tools?.filter(tool => tool.name.startsWith('mcp__') || tool.plugin?.startsWith('mcp:'))
  const otherTools = tools?.filter(tool => !tool.name.startsWith('mcp__') && !tool.plugin?.startsWith('mcp:'))
  const totalTools = tools?.reduce((sum, tool) => sum + tool.tokens, 0)
  const mcpTotal = mcp?.reduce((sum, tool) => sum + tool.tokens, 0)
  const toolTokens = count(breakdown?.toolsTokens)
  const mcpTokens = toolTokens !== undefined && totalTools !== undefined && mcpTotal !== undefined
    ? totalTools > 0 ? Math.round(toolTokens * mcpTotal / totalTools) : toolTokens === 0 ? 0 : undefined
    : undefined
  const facts = record(timeline)
  const current = facts?.ok === true && !facts.unsupported ? record(facts.current) : undefined
  const keys: MessageRowKey[] = ['user', 'inject', 'skill', 'assistant', 'tool']
  const messages = current === undefined ? undefined : keys.map(key => ({ key, tokens: count(current[key]) }))
  const messageTotal = messages?.every(item => item.tokens !== undefined)
    ? messages.reduce((sum, item) => sum + item.tokens!, 0) : undefined
  const skillTokens = count(current?.skill)
  const messageTokens = count(breakdown?.messageTokens)
  const skills = messageTokens !== undefined && skillTokens !== undefined && messageTotal !== undefined
    ? messageTotal > 0 ? Math.round(messageTokens * skillTokens / messageTotal) : messageTokens === 0 ? 0 : undefined
    : undefined
  const rows: ContextRow[] = [
    { key: 'mcp', color: '#257de0', tokens: mcpTokens },
    { key: 'messages', color: '#f47330', tokens: messageTokens === undefined ? undefined : Math.max(0, messageTokens - (skills ?? 0)) },
    { key: mcpTokens === undefined ? 'tools' : 'otherTools', color: '#06b894', tokens: toolTokens === undefined ? undefined : Math.max(0, toolTokens - (mcpTokens ?? 0)) },
    { key: 'system', color: '#f2a604', tokens: count(breakdown?.systemTokens) },
    { key: 'skills', color: '#8b8397', tokens: skills },
    { key: 'instructions', color: '#94908a' },
    { key: 'memory', color: '#94908a' },
    { key: 'buffer', color: '#b9b6ae' },
    { key: 'free', color: '#e7e5e0', tokens: used !== undefined && capacity !== undefined ? Math.max(0, capacity - used) : undefined },
  ]
  return {
    used, capacity, percent: used !== undefined && capacity !== undefined ? used / capacity * 100 : undefined,
    // Native pressure/capacity records are approximate and may come from different moments.
    estimated: used !== undefined,
    rows, tools, mcp, otherTools, messages,
  }
}

/** Compact visible token count; exact counts remain available on the row title. */
export function formatContextTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`
  return String(Math.round(value))
}
