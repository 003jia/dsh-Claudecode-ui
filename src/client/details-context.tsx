/** Full context usage in the existing session-details pane. */
import { useEffect, useId, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { deriveContextData, formatContextTokens, type ContextTool } from './details-context-data.ts'
import css from './details-context.module.css'

const zh = {
  context: '上下文', used: '已使用', capacity: '窗口容量', mcp: 'MCP 工具', messages: '消息', tools: '工具（合计）', otherTools: '其他工具',
  system: '系统提示词', skills: '技能', instructions: 'MCP 服务器指令', memory: '记忆文件', buffer: '自动压缩预留', free: '可用空间',
  unavailable: '未提供', unknown: '暂无用量数据', noMeasurement: '当前数据源未提供独立计量',
  estimate: '分类用量为估算值；— 表示暂无独立统计。', inferred: 'MCP 和技能按各自明细占比拆分。',
  toolDetails: '工具定义明细', messageDetails: '消息构成', emptyTools: '当前请求没有工具定义',
  user: '用户消息', inject: '注入内容', skill: '技能内容', assistant: '助手回复', tool: '工具结果',
  full: '查看完整上下文', openFailed: '当前会话没有可用的完整上下文视图',
  percent: '{value}% 已用', exact: '{value} tokens', categories: '用量分类', toolCount: '{count} 项',
}
const en: Record<keyof typeof zh, string> = {
  context: 'Context', used: 'Used', capacity: 'Window capacity', mcp: 'MCP tools', messages: 'Messages', tools: 'Tools (total)', otherTools: 'Other tools',
  system: 'System prompt', skills: 'Skills', instructions: 'MCP server instructions', memory: 'Memory files', buffer: 'Autocompact buffer', free: 'Free space',
  unavailable: 'Unavailable', unknown: 'Usage is not available yet', noMeasurement: 'No separate measurement from the current data source',
  estimate: 'Category sizes are estimates; — means no separate measurement.', inferred: 'MCP and skills are split using their detail proportions.',
  toolDetails: 'Tool definition details', messageDetails: 'Message composition', emptyTools: 'No tool definitions in the current request',
  user: 'User messages', inject: 'Injected content', skill: 'Skill content', assistant: 'Assistant replies', tool: 'Tool results',
  full: 'View full context', openFailed: 'A full context view is unavailable for this chat',
  percent: '{value}% used', exact: '{value} tokens', categories: 'Usage categories', toolCount: '{count} items',
}
type TextKey = keyof typeof zh
export type DetailsContextText = (key: TextKey, args?: Record<string, string | number>) => string

/** Registration-side actions; navigation occurs only when the user clicks. */
export interface DetailsContextActions {
  contextText: DetailsContextText
  openContextDetails: () => boolean
}
export interface DetailsContextProps extends DetailsContextActions {
  sessionId: SessionId
  pressure: ContextPressureProjection | undefined
  breakdown: ContextBreakdownProjection | undefined
  headers: unknown
  timeline: unknown
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'claude.detailsContext': TextKey }
}

function ToolGroup({ label, tools, text, id }: { label: string; tools: ContextTool[]; text: DetailsContextText; id: string }) {
  return <details className={css.group}>
    <summary><span>{label}</span><span>{text('toolCount', { count: tools.length })}</span></summary>
    {tools.length === 0 ? <p className={css.note}>{text('emptyTools')}</p> : <ul id={id} className={css.toolList}>
      {tools.map((tool, index) => <li key={`${tool.name}:${index}`}>
        <span className={css.toolName} title={tool.plugin === undefined ? tool.name : `${tool.name} · ${tool.plugin}`}>{tool.name}</span>
        <span title={text('exact', { value: tool.tokens.toLocaleString() })}>{formatContextTokens(tool.tokens)}</span>
      </li>)}
    </ul>}
  </details>
}

/** Render every available category, with expandable uncapped tool/message detail. */
export function DetailsContext({ sessionId, pressure, breakdown, headers, timeline, contextText: t, openContextDetails }: DetailsContextProps) {
  const id = useId()
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [sessionId])
  const data = deriveContextData(pressure, breakdown, headers, timeline)
  const occupancy = Math.min(100, Math.max(0, data.percent ?? 0))
  const measured = data.rows.filter(row => row.key !== 'free' && row.tokens !== undefined && row.tokens > 0)
  const total = measured.reduce((sum, row) => sum + row.tokens!, 0)
  const segments = total > 0 ? measured.map(row => ({ key: row.key, color: row.color, width: occupancy * row.tokens! / total }))
    : [{ key: 'used', color: '#257de0', width: occupancy }]
  const exact = (value: number): string => t('exact', { value: value.toLocaleString() })
  return <section className={css.card} data-claude-details-context="" aria-labelledby={`${id}-heading`}>
    <header className={css.header}>
      <h3 id={`${id}-heading`}>{t('context')}</h3>
    </header>
    <div className={css.summary} aria-label={t('used')}>
      <span>{data.percent === undefined ? t('unavailable') : t('percent', { value: Math.round(data.percent) })}</span>
      <span className={css.summaryTokens}>
        <strong title={data.used === undefined ? t('unknown') : exact(data.used)}>{data.used === undefined ? '—' : `${data.estimated ? '≈' : ''}${formatContextTokens(data.used)}`}</strong>
        <span> / </span>
        <span title={data.capacity === undefined ? t('noMeasurement') : exact(data.capacity)}>{data.capacity === undefined ? '—' : formatContextTokens(data.capacity)}</span>
      </span>
    </div>
    {data.percent === undefined ? <p className={css.note}>{t('unknown')}</p> : <div className={css.bar} role="meter" aria-label={t('context')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(occupancy)} aria-valuetext={t('percent', { value: Math.round(data.percent) })}>
      {segments.filter(segment => segment.width > 0).map(segment => <span key={segment.key} style={{ width: `${segment.width}%`, backgroundColor: segment.color }} />)}
    </div>}
    <dl className={css.legend} aria-label={t('categories')}>
      {data.rows.map(row => <div className={css.row} key={row.key} data-unavailable={row.tokens === undefined || undefined}>
        <dt><i style={{ backgroundColor: row.color }} aria-hidden="true" /><span>{t(row.key)}</span></dt>
        <dd title={row.tokens === undefined ? t('noMeasurement') : exact(row.tokens)}>{row.tokens === undefined ? '—' : formatContextTokens(row.tokens)}</dd>
        <dd>{row.tokens === undefined || data.capacity === undefined ? '—' : `${(row.tokens / data.capacity * 100).toFixed(1)}%`}</dd>
      </div>)}
    </dl>
    <p className={css.note} title={t('inferred')}>{t('estimate')}</p>
    {data.tools !== undefined && <div className={css.groups} aria-label={t('toolDetails')}>
      <ToolGroup label={t('mcp')} tools={data.mcp ?? []} text={t} id={`${id}-mcp`} />
      <ToolGroup label={t('otherTools')} tools={data.otherTools ?? []} text={t} id={`${id}-tools`} />
    </div>}
    {data.messages !== undefined && <details className={css.group}>
      <summary><span>{t('messageDetails')}</span></summary>
      <dl className={css.messageList}>{data.messages.map(item => <div key={item.key}>
        <dt>{t(item.key)}</dt><dd title={item.tokens === undefined ? t('noMeasurement') : exact(item.tokens)}>{item.tokens === undefined ? '—' : formatContextTokens(item.tokens)}</dd>
      </div>)}</dl>
    </details>}
    <button type="button" className={css.fullButton} onClick={() => setFailed(!openContextDetails())}>{t('full')}<span aria-hidden="true">↗</span></button>
    {failed && <p className={css.error} role="status">{t('openFailed')}</p>}
  </section>
}

/** Register the local context-card strings with disposal managed by Cordis. */
export function installDetailsContextLocale(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('claude.detailsContext', { zh, en }), 'claude-ui: details context strings')
}

/** Reuse the registered full context pane, preserving its data and navigation owner. */
export function createDetailsContextActions(ctx: Context, sessionId: SessionId): DetailsContextActions {
  const text = ctx.locale.bind('claude.detailsContext')
  return {
    contextText: (key, args) => text(key, args),
    openContextDetails: () => {
      const right = ctx.get('sidebarRight')
      const tabs = ctx.get('sidebarRightTabs')
      if (right === undefined || right.mounted.getSnapshot() !== sessionId || tabs?.get('dsh-context') === undefined
        || !ctx.slots.entriesOfSlot('sidebar.right.pane.tab').some(entry => entry.options.key === 'dsh-context')) return false
      try { right.openTab('dsh-context'); return true } catch { return false }
    },
  }
}
