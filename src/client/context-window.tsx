/** Claude-style presentation of the resident composer's context projections. */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { ContextBreakdownProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './context-window.module.css'

const zh = {
  window: '上下文窗口', details: '查看详细分布', mcp: 'MCP 工具', messages: '消息',
  compact: '压缩上下文', compacting: '正在压缩…', compacted: '上下文已压缩',
  compactFailed: '压缩失败 · {reason}', compactUnavailable: '当前会话不支持压缩上下文',
  compactBusy: '会话正在运行，结束后可压缩上下文', compactReadOnly: '当前会话没有压缩权限',
  tools: '工具（合计）', otherTools: '其他工具', system: '系统提示词', skills: '技能',
  instructions: 'MCP 服务器指令', memory: '记忆文件', buffer: '自动压缩预留', free: '可用空间',
  unavailable: '当前数据源未提供此分项', breakdown: '分类为估算。短横线表示当前数据源未提供此分项。',
  used: '上下文已用 {percent}', estimate: '估算占用',
}
const en: Record<keyof typeof zh, string> = {
  window: 'Context window', details: 'See detailed breakdown', mcp: 'MCP tools', messages: 'Messages',
  compact: 'Compact context', compacting: 'Compacting…', compacted: 'Context compacted',
  compactFailed: 'Compaction failed · {reason}', compactUnavailable: 'Context compaction is unavailable for this chat',
  compactBusy: 'You can compact context when the session stops running', compactReadOnly: 'You do not have permission to compact this chat',
  tools: 'Tools (total)', otherTools: 'Other tools', system: 'System prompt', skills: 'Skills',
  instructions: 'MCP server instructions', memory: 'Memory files', buffer: 'Autocompact buffer', free: 'Free space',
  unavailable: 'No separate measurement from the current data source',
  breakdown: 'Category sizes are estimates. A dash means a separate measurement is unavailable.',
  used: 'Context used: {percent}', estimate: 'Estimated usage',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'claude.context': keyof typeof zh }
}

type Face = {
  openDetails: (session: SessionId) => boolean
  compactContext?: (session: SessionId) => Promise<string | undefined>
}
type Props = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'claude.context'> & InjectFace<Face>
type Tool = { name: string; tokens: number; plugin?: string }
type Row = { id: keyof typeof zh; color: string; tokens?: number }
const unavailableColor = '#878787'

function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function latestTools(value: unknown): Tool[] | undefined {
  const headers = record(value)?.headers
  if (!Array.isArray(headers)) return undefined
  const tools = record(headers.at(-1))?.tools
  if (!Array.isArray(tools)) return undefined
  return tools.flatMap(value => {
    const item = record(value)
    if (typeof item?.name !== 'string' || !numeric(item.tokens)) return []
    return [{ name: item.name, tokens: item.tokens, plugin: typeof item.plugin === 'string' ? item.plugin : undefined }]
  })
}

function skillShare(value: unknown): number | undefined {
  const timeline = record(value)
  if (timeline?.ok !== true || timeline.unsupported) return undefined
  const current = record(timeline.current)
  if (current === undefined || !numeric(current.skill)) return undefined
  const counts = [current.user, current.inject, current.skill, current.assistant, current.tool]
  const total = counts.reduce<number>((sum, count) => sum + (numeric(count) ? count : 0), 0)
  return total > 0 ? current.skill / total : 0
}

function composition(breakdown: ContextBreakdownProjection | undefined, tools: Tool[] | undefined, share: number | undefined, free: number) {
  const mcp = tools?.filter(tool => tool.name.startsWith('mcp__') || tool.plugin?.startsWith('mcp:'))
  const mcpTotal = mcp?.reduce((sum, tool) => sum + tool.tokens, 0)
  const toolsTotal = tools?.reduce((sum, tool) => sum + tool.tokens, 0)
  const toolsTokens = breakdown?.toolsTokens
  const mcpTokens = toolsTokens !== undefined && toolsTotal !== undefined && toolsTotal > 0 && mcpTotal !== undefined
    ? Math.round(toolsTokens * mcpTotal / toolsTotal) : undefined
  const skills = breakdown !== undefined && share !== undefined ? Math.round(breakdown.messageTokens * share) : undefined
  const rows: Row[] = [
    { id: 'mcp', color: '#257de0', tokens: mcpTokens },
    { id: 'messages', color: '#f47330', tokens: breakdown === undefined ? undefined : breakdown.messageTokens - (skills ?? 0) },
    { id: mcpTokens === undefined ? 'tools' : 'otherTools', color: '#06b894', tokens: toolsTokens === undefined ? undefined : toolsTokens - (mcpTokens ?? 0) },
    { id: 'system', color: '#f2a604', tokens: breakdown?.systemTokens },
    { id: 'skills', color: unavailableColor, tokens: skills },
    { id: 'instructions', color: unavailableColor },
    { id: 'memory', color: unavailableColor },
    { id: 'buffer', color: '#c2c2c2' },
    { id: 'free', color: '#ededed', tokens: free },
  ]
  return { rows, mcp, mcpTotal }
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`
  return String(value)
}

function Chevron({ expanded }: { expanded: boolean }) {
  return <svg className={`${css.chevron} ${expanded ? css.expandedChevron : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m4.5 3 3 3-3 3" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function ContextWindow({ useProjection, useSession, useAccess, sessionId, openDetails, compactContext, t }: Props) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const sessionRunning = useSession(session => session.running)
  const canExecute = useAccess('commands/execute')
  // Optional projections from dsh-context. Validate the part this UI consumes.
  const useOptionalProjection = useProjection as (key: string) => unknown
  const header = useOptionalProjection('contextHeaders')
  const timeline = useOptionalProjection('contextTimeline')
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  const available = numeric(used) && numeric(capacity) && capacity > 0
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [explain, setExplain] = useState(false)
  const [compactStatus, setCompactStatus] = useState<{ kind: 'running' | 'done' | 'error'; text: string } | null>(null)
  const compactPending = useRef(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLButtonElement>(null)
  const id = useId()
  const shown = open && available
  const position = useAnchoredPosition({ open: shown, anchorRef: anchor, panelRef: panel, side: 'top', align: 'end', gap: 8, margin: 12 })
  useDismissOnOutsidePointer(anchor, shown, setOpen, panel)
  const positioned = shown && position !== null
  useEffect(() => { if (positioned) heading.current?.focus({ preventScroll: true }) }, [positioned])
  useEffect(() => { if (!available) setOpen(false) }, [available])
  useEffect(() => {
    if (compactStatus === null || compactStatus.kind === 'running') return
    const timeout = window.setTimeout(() => setCompactStatus(null), 8000)
    return () => window.clearTimeout(timeout)
  }, [compactStatus])

  if (!available) return null
  const occupancy = Math.min(100, used / capacity * 100)
  const reading = `${Math.round(occupancy)}%`
  const { rows, mcp, mcpTotal } = composition(breakdown, latestTools(header), skillShare(timeline), Math.max(0, capacity - used))
  const measured = rows.filter(row => row.id !== 'free' && (row.tokens ?? 0) > 0)
  const totalEstimate = measured.reduce((sum, row) => sum + (row.tokens ?? 0), 0)
  const segments = totalEstimate > 0 ? measured.map(row => ({ ...row, width: occupancy * (row.tokens ?? 0) / totalEstimate }))
    : [{ id: 'used', color: '#257de0', width: occupancy }]
  const estimated = pressure?.projectedTokens !== undefined && pressure.projectedTokens !== pressure.pressureTokens
  const summary = `${estimated ? '≈' : ''}${compact(used)} / ${compact(capacity)} (${reading})`
  const compactDisabled = !canExecute || sessionRunning || compactStatus?.kind === 'running'
  const runCompaction = async (): Promise<void> => {
    if (compactContext === undefined || compactDisabled || compactPending.current) return
    compactPending.current = true
    setCompactStatus({ kind: 'running', text: t('compacting') })
    try {
      const result = await compactContext(sessionId)
      setCompactStatus(result === undefined
        ? { kind: 'error', text: t('compactUnavailable') }
        : { kind: 'done', text: result || t('compacted') })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setCompactStatus({ kind: 'error', text: t('compactFailed', { reason }) })
    } finally {
      compactPending.current = false
    }
  }
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  const onEscape = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !shown) return
    event.preventDefault(); event.stopPropagation(); close()
  }
  return <span ref={anchor} className={css.anchor} data-dsh-claude-context-meter=""
    data-dsh-claude-context-compact={compactContext === undefined ? undefined : ''}>
    <button ref={trigger} type="button" className={css.trigger} aria-label={t('used', { percent: reading })}
      title={`${t('window')} · ${summary}`} aria-haspopup="dialog" aria-controls={shown ? id : undefined}
      aria-expanded={shown} onClick={() => { setOpen(!shown) }} onKeyDown={onEscape}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="2" aria-hidden="true">
        <circle cx="8" cy="8" r="6" className={css.ringTrack} />
        {occupancy > 0 && <circle cx="8" cy="8" r="6" className={css.ringValue} pathLength="100"
          strokeDasharray={`${occupancy} 100`} strokeLinecap="round" transform="rotate(-90 8 8)" />}
      </svg>
    </button>
    {shown && createPortal(<div ref={panel} id={id} className={css.panel} data-dsh-claude-context-panel=""
      role="dialog" aria-label={t('window')} onKeyDown={onEscape} style={position ?? { visibility: 'hidden', left: 0, top: 0 }}>
      <button ref={heading} type="button" className={css.heading} aria-expanded={expanded} aria-controls={expanded ? `${id}-legend` : undefined}
        onClick={() => { setExpanded(!expanded); if (expanded) setExplain(false) }}>
        <span>{t('window')}</span><span className={css.totals}>{summary}</span><Chevron expanded={expanded} />
      </button>
      <div className={css.bar} role="meter" aria-label={t('window')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(occupancy)}>
        {segments.filter(segment => segment.width > 0).map(segment => <span key={segment.id} className={css.segment}
          style={{ width: `${segment.width}%`, backgroundColor: segment.color }} />)}
      </div>
      {expanded && <div id={`${id}-legend`}>
        <dl className={css.legend}>
          {rows.map(row => <div className={css.row} key={row.id} title={row.tokens === undefined ? t('unavailable') : t('estimate')}>
            <dt><span className={css.swatch} style={{ backgroundColor: row.color }} aria-hidden="true" />{t(row.id)}</dt>
            <dd className={css.count}>{row.tokens === undefined ? '—' : compact(row.tokens)}</dd>
            <dd>{row.tokens === undefined ? '—' : `${(row.tokens / capacity * 100).toFixed(1)}%`}</dd>
          </div>)}
        </dl>
        <div>
          {mcp !== undefined && mcp.length > 0 ? <button type="button" className={css.groupButton} aria-expanded={showTools} aria-controls={showTools ? `${id}-tools` : undefined}
            onClick={() => { setShowTools(!showTools) }}>
            <span className={css.groupLabel}><Chevron expanded={showTools} />{t('mcp')}</span>
            <span>{mcpTotal === undefined ? '—' : compact(mcpTotal)}</span><span>{mcp.length}</span>
          </button> : <div className={`${css.groupButton} ${css.unavailable}`} title={t('unavailable')}>
            <span className={css.groupLabel}><Chevron expanded={false} />{t('mcp')}</span>
            <span>{mcpTotal === undefined ? '—' : compact(mcpTotal)}</span><span>{mcp === undefined ? '—' : mcp.length}</span>
          </div>}
          {showTools && mcp !== undefined && mcp.length > 0 && <ul className={css.groupList} id={`${id}-tools`}>
            {mcp.map((tool, index) => <li key={`${tool.name}-${index}`}><span title={tool.name}>{tool.name}</span><span>{compact(tool.tokens)}</span></li>)}
          </ul>}
          <div className={`${css.groupButton} ${css.unavailable}`} title={t('unavailable')}>
            <span className={css.groupLabel}><Chevron expanded={false} />{t('memory')}</span><span>—</span><span>—</span>
          </div>
        </div>
        {explain && <p className={css.explanation}>{t('breakdown')}</p>}
      </div>}
      <div className={`${css.footer} ${expanded ? css.expandedFooter : ''}`}>
        <div className={css.actions}>
          <button type="button" className={css.detailButton} onClick={() => {
            if (openDetails(sessionId)) close()
            else { setExpanded(true); setExplain(true); setShowTools(true) }
          }}>{t('details')}</button>
          {compactContext !== undefined && <button type="button" className={`${css.detailButton} ${css.compactButton}`}
            aria-disabled={compactDisabled} title={!canExecute ? t('compactReadOnly') : sessionRunning ? t('compactBusy') : undefined}
            onClick={() => { void runCompaction() }}>
            {t('compact')}
          </button>}
        </div>
        <div className={css.compactStatus} role="status" data-error={compactStatus?.kind === 'error' || undefined}>
          {compactStatus?.text}
        </div>
      </div>
    </div>, document.body)}
  </span>
}

/** Mount in the native conversation dock and open the existing context pane when registered. */
export function installContextWindow(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('claude.context', { zh, en }), 'claude-ui: context strings')
  const openDetails = (sessionId: SessionId): boolean => {
    const sidebar = ctx.get('sidebarRight')
    const tabs = ctx.get('sidebarRightTabs')
    if (sidebar === undefined || tabs?.get('dsh-context') === undefined
      || !ctx.slots.entriesOfSlot('sidebar.right.pane.tab').some(entry => entry.options.key === 'dsh-context')
      || !(ctx.sessions.list.getSnapshot().byId[sessionId]?.retainedBy.mainView ?? 0)) return false
    const mounted = sidebar.mounted.getSnapshot()
    if (mounted !== sessionId) return false
    sidebar.openTab('dsh-context')
    return true
  }
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'claude-ui.context-window', locale: 'claude.context',
    inject: (): Face => {
      const commands = ctx.get('remote.commands') as Context['remote']['commands'] | undefined
      if (commands === undefined) return { openDetails }
      return { openDetails, compactContext: async (sessionId) => {
        const response = await commands.execute(sessionId, '/compact', [])
        if (!response.ok) throw new Error(response.error.message)
        const result = response.value?.result
        if (result === undefined) return undefined
        if (result.kind === 'error') throw new Error(result.text)
        return result.text ?? ''
      } }
    },
  }, props => <ContextWindow key={props.sessionId} {...props} />))
}
