/** Presentation of the current DSH turn in the composer and the native right pane. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { IJobs, JobsSnapshot } from '@deepseek-ai/dsh-api-job-controller/client'
import type { ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconBrowseOutlineRegular, IconCodeOutlineRegular, IconPanelLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import type {} from '@deepseek-ai/dsh-working-directory'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import css from './task-runtime.module.css'

const pane = 'claude-ui.session-details'
const zh = {
  details: '会话详情', environment: '执行环境', directory: '工作目录', files: '文件', changes: '文件改动',
  review: '查看改动', deliveries: '交付物', tasks: '任务清单', progress: '{done} / {total} 完成',
  jobs: '后台任务', jobsRunning: '{count} 项执行中', working: '执行中', tool: '正在运行 {name}',
  stop: '停止', stopping: '正在停止', completed: '本轮完成', ended: '本轮已结束', stopped: '本轮已停止', failed: '本轮失败',
  wait: '需要你处理', approval: '命令审批', question: '等待回答', plan: '等待计划确认', pending: '待确认',
  context: '上下文', used: '{percent}% 已用', seconds: '{seconds} 秒', minutes: '{minutes} 分 {seconds} 秒',
  disconnected: '连接已断开', connecting: '正在重新连接', unavailable: '当前会话详情暂不可用',
  todoDone: '已完成', todoActive: '执行中', todoPending: '待开始', openFailed: '无法打开此项',
  changeCount: '{count} 个文件', changesLoading: '正在读取改动…', changesMissing: '本轮改动详情已不可用',
}
const en: Record<keyof typeof zh, string> = {
  details: 'Session details', environment: 'Environment', directory: 'Working directory', files: 'Files', changes: 'Changes',
  review: 'Review changes', deliveries: 'Deliverables', tasks: 'Task list', progress: '{done} / {total} complete',
  jobs: 'Background tasks', jobsRunning: '{count} running', working: 'Working', tool: 'Running {name}',
  stop: 'Stop', stopping: 'Stopping', completed: 'Turn completed', ended: 'Turn ended', stopped: 'Turn stopped', failed: 'Turn failed',
  wait: 'Needs your attention', approval: 'Command approval', question: 'Awaiting an answer', plan: 'Awaiting plan review', pending: 'Pending',
  context: 'Context', used: '{percent}% used', seconds: '{seconds} sec', minutes: '{minutes} min {seconds} sec',
  disconnected: 'Disconnected', connecting: 'Reconnecting', unavailable: 'Session details are unavailable',
  todoDone: 'Completed', todoActive: 'In progress', todoPending: 'Pending', openFailed: 'Could not open this item',
  changeCount: '{count} files', changesLoading: 'Loading changes…', changesMissing: 'Change details are no longer available for this turn',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'claude.runtime': keyof typeof zh }
}
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap { 'changes-review': { index?: number } }
}

type Locale = PropsLocale<'claude.runtime'>
type ChatFace = { hooks: { chat: HostObservable<ChatSnapshot | undefined> } }
type StripFace = { stop: () => Promise<void>; hooks: ChatFace['hooks'] & { connectionState: ConnectionStateSource } }
type DetailsFace = {
  hooks: ChatFace['hooks'] & { jobs: HostObservable<JobsSnapshot>; canReview: HostObservable<boolean> }
  watchJobs: () => () => void
  openFiles?: () => boolean
  openChanges: (seq: number, turn: number, index?: number) => boolean
  readChanges: (seq: number, signal: AbortSignal) => Promise<ChangeSummary | undefined>
  openFile: (cwd: string | undefined, path: string) => boolean
}
type HeaderFace = {
  openDetails: () => boolean
  openDetailsWhenReady: () => void
  openFiles?: () => boolean
  openChanges: DetailsFace['openChanges']
  hooks: ChatFace['hooks'] & { canReview: HostObservable<boolean> }
}

const empty = <T,>(value: T): HostObservable<T> => ({ getSnapshot: () => value, subscribe: () => () => {} })
const emptyChat = empty<ChatSnapshot | undefined>(undefined)
const emptyJobs = empty<JobsSnapshot>({ rows: {}, observed: {} })
const noReview = empty(false)
const noConnection = empty<undefined>(undefined)

function lastTurn(view: ChatSnapshot | undefined): TurnLocation | undefined {
  const timeline = view?.timeline
  const latest = timeline?.turnOrder.at(-1)
  return latest === undefined ? undefined : timeline?.turns.get(latest)
}

type DeliveredFile = { path: string; seq: number; index: number }
type Deliverables = { changes?: { seq: number }; presented?: readonly DeliveredFile[] }

/** The optional native deliverables plugin publishes these facts on closed turns. */
function deliveryOf(turn: TurnLocation | undefined): Deliverables | undefined {
  if (turn?.status !== 'closed') return undefined
  return (turn.data.get as (key: string) => Deliverables | undefined)('deliverables')
}

function duration(ms: number, t: Locale['t']): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return seconds < 60 ? t('seconds', { seconds }) : t('minutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
}

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || path
}

function TaskStrip({ session, sessionId, useChat, useSessionStatus, useConnectionState, useAccess, stop, t }:
PropsRuntime<'conversation.input.dock'> & InjectFace<StripFace> & Locale) {
  const turn = useChat(lastTurn)
  const tool = useChat(view => view?.legacy.runningCalls.at(-1))
  const pending = useSessionStatus(status => status.get(sessionId)?.pendingInteraction?.kind)
  const connection = useConnectionState(value => value)
  const canStop = useAccess('session/cancel')
  const live = session.running && pending === undefined && connection === 'connected'
  const [now, setNow] = useState(Date.now)
  const [stopping, setStopping] = useState(false)
  const stopPending = useRef(false)
  const start = tool?.time ?? turn?.start?.time
  useEffect(() => {
    if (!live || start === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live, start])
  if (session.blank || pending !== undefined || (turn === undefined && !session.running)) return null
  const reason = turn?.end?.data.reason.kind
  const state = live ? 'running' : session.running ? 'offline' : reason
  if (state === undefined) return null
  const label = state === 'running' ? (tool === undefined ? t('working') : t('tool', { name: tool.name }))
    : state === 'offline' ? t(connection === 'connecting' ? 'connecting' : 'disconnected')
    : state === 'completed' ? t('completed') : state === 'aborted' || state === 'interrupted' ? t('stopped')
    : state === 'error' ? t('failed') : t('ended')
  const end = live ? now : turn?.end?.time
  const begin = live ? start : turn?.start?.time
  const elapsed = begin === undefined || end === undefined ? undefined : duration(end - begin, t)
  const showStop = live && canStop
  return <div className={css.strip} data-claude-task-strip={state} data-claude-task-stop={showStop || undefined}>
    <div className={css.stripLabel}>
      <span className={css.state} data-state={state} aria-hidden="true">{state === 'completed' ? '✓' : ''}</span>
      <span role="status">{label}</span>{elapsed !== undefined && <span className={css.secondary}>· {elapsed}</span>}
    </div>
    {showStop && <button type="button" className={css.stop} disabled={stopping} onClick={async () => {
      if (stopPending.current) return
      stopPending.current = true
      setStopping(true)
      try { await stop() } finally { stopPending.current = false; setStopping(false) }
    }}><span className={css.stopIcon} aria-hidden="true" />{t(stopping ? 'stopping' : 'stop')}</button>}
  </div>
}

function SessionToolbar({ sessionId, useSession, useSessionStatus, useChat, useCanReview, openDetails, openDetailsWhenReady, openChanges, openFiles, t }:
PropsRuntime<'conversation.session.header.utilities'> & InjectFace<HeaderFace> & Locale) {
  const blank = useSession(session => session.blank)
  const running = useSession(session => session.running)
  const pending = useSessionStatus(status => status.get(sessionId)?.pendingInteraction?.kind)
  const turn = useChat(lastTurn)
  const enabled = useCanReview(value => value)
  const delivery = deliveryOf(turn)
  const changes = enabled ? delivery?.changes : undefined
  const shouldRevealDetails = running || pending !== undefined || changes !== undefined || (delivery?.presented?.length ?? 0) > 0
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!blank && shouldRevealDetails) openDetailsWhenReady()
  }, [blank, shouldRevealDetails, openDetailsWhenReady])
  const act = (open: () => boolean): void => { setFailed(!open()) }
  if (blank) return null
  return <div className={css.toolbar} data-claude-task-toolbar="" data-attention={pending ?? (running ? 'running' : undefined)}>
    <button type="button" className={css.detailsButton} onClick={() => act(openDetails)} aria-label={t('details')} title={t('details')}>
      <IconPanelLeftOutlineRegular size={16} /><span>{t('details')}</span>
    </button>
    {changes !== undefined && turn !== undefined && <button type="button" onClick={() => act(() => openChanges(changes.seq, turn.turn))} aria-label={t('review')} title={t('review')}>
      <IconCodeOutlineRegular size={16} />
    </button>}
    {openFiles !== undefined && <button type="button" onClick={() => act(openFiles)} aria-label={t('files')} title={t('files')}>
      <IconBrowseOutlineRegular size={16} />
    </button>}
    {failed && <span role="status" className={css.openError}>{t('openFailed')}</span>}
  </div>
}

function Section({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  return <section className={css.section}><header><h3>{title}</h3>{summary && <span>{summary}</span>}</header>{children}</section>
}

type ChangeFile = { display: string; added: number; deleted: number }
type ChangeSummary = { total: number; files: readonly ChangeFile[] }

function isChangeFile(value: unknown): value is ChangeFile {
  if (typeof value !== 'object' || value === null) return false
  const file = value as Partial<ChangeFile>
  return typeof file.display === 'string' && Number.isSafeInteger(file.added) && Number.isSafeInteger(file.deleted)
}

function Changes({ seq, turn, readChanges, openChanges, t }: Pick<DetailsFace, 'readChanges' | 'openChanges'> & Locale & { seq: number; turn: number }) {
  const [summary, setSummary] = useState<ChangeSummary | null>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void readChanges(seq, controller.signal).then(result => {
      if (!controller.signal.aborted) setSummary(result ?? null)
    })
    return () => controller.abort()
  }, [seq, readChanges])
  if (summary?.total === 0) return null
  return <Section title={t('changes')} summary={summary ? t('changeCount', { count: summary.total }) : undefined}>
    {summary == null ? <p className={css.secondary}>{t(summary === null ? 'changesMissing' : 'changesLoading')}</p> : <>
      <ul>{summary.files.map((file, index) => <li key={`${file.display}:${index}`}>
        <button type="button" className={css.file} title={file.display} onClick={() => setFailed(!openChanges(seq, turn, index))}>
          <IconCodeOutlineRegular size={14} /><span>{file.display}</span>
          <small className={css.delta}><span>+{file.added}</span> <span>−{file.deleted}</span></small>
        </button>
      </li>)}</ul>
      <button type="button" className={css.link} onClick={() => setFailed(!openChanges(seq, turn))}>{t('review')}</button>
    </>}
    {failed && <p role="status" className={css.secondary}>{t('openFailed')}</p>}
  </Section>
}

function Details({ sessionId, useSessions, useWorkspaces, useSessionStatus, useProjection, useChat, useJobs, useCanReview, useTabInfo,
  watchJobs, openFiles, openChanges, openFile, readChanges, t }: PropsRuntime<'sidebar.right.pane.tab'> & InjectFace<DetailsFace> & Locale) {
  const { tab: { visible } } = useTabInfo()
  const originalCwd = useSessions(list => list.byId[sessionId]?.cwd)
  const workspace = useWorkspaces(list => list.items.find(item => item.sessionIds.includes(sessionId)))
  const cwd = useProjection('workingDirectory') ?? originalCwd ?? workspace?.path
  const todos = useProjection('todos') ?? []
  const pending = useSessionStatus(status => status.get(sessionId)?.pendingInteraction?.kind)
  const pressure = useProjection('contextPressure')
  const turn = useChat(lastTurn)
  const jobs = useJobs(value => value.rows[sessionId])
  const enabled = useCanReview(value => value)
  const [failed, setFailed] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => visible ? watchJobs() : undefined, [visible, watchJobs])
  useLayoutEffect(() => {
    const column = detailRef.current?.closest('[data-rightbar-col]')
    const frame = column?.parentElement
    if (!visible || frame === undefined || frame === null) return
    // Keep DSH's current left column and apply the Pen rail only to the
    // selected, docked details page. The native layout preference is untouched.
    const sync = (): void => {
      const left = /^\d+(?:\.\d+)?px/.exec(frame.style.gridTemplateColumns)?.[0]
      if (left === undefined) return
      if (frame.style.getPropertyValue('--claude-details-left') !== left) frame.style.setProperty('--claude-details-left', left)
      if (!frame.hasAttribute('data-claude-details-track')) frame.setAttribute('data-claude-details-track', '')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      frame.removeAttribute('data-claude-details-track')
      frame.style.removeProperty('--claude-details-left')
    }
  }, [visible])
  const done = todos.filter(item => item.status === 'completed').length
  const activeJobs = jobs?.filter(job => job.status === 'running' || job.status === 'stopping') ?? []
  const delivery = deliveryOf(turn)
  const files = delivery?.presented ?? []
  const changed = enabled ? delivery?.changes : undefined
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const capacity = pressure?.contextWindow
  const percent = used !== undefined && capacity !== undefined && capacity > 0
    ? Math.round(Math.max(0, Math.min(100, used / capacity * 100))) : undefined
  const act = (open: () => boolean): void => { setFailed(!open()) }
  if (!visible) return null
  return <div ref={detailRef} className={css.details} data-claude-session-details="">
    <h2>{t('details')}</h2>
    {cwd !== undefined && <Section title={t('environment')}>
      <div className={css.row}><IconBrowseOutlineRegular size={14} /><span title={cwd}>{workspace?.title ?? baseName(cwd)}</span></div>
      <div className={css.directory} title={cwd}><span>{t('directory')}</span><code>{cwd}</code></div>
      {openFiles !== undefined && <button type="button" className={css.link} onClick={() => act(openFiles)}>{t('files')}</button>}
    </Section>}
    {todos.length > 0 && <Section title={t('tasks')} summary={t('progress', { done, total: todos.length })}>
      <ul>{todos.map((item, index) => <li className={css.row} key={`${index}:${item.content}`}>
        <span className={css.state} data-state={item.status} aria-label={t(item.status === 'completed' ? 'todoDone' : item.status === 'in_progress' ? 'todoActive' : 'todoPending')}>
          {item.status === 'completed' ? '✓' : ''}
        </span><span>{item.content}</span>
      </li>)}</ul>
    </Section>}
    {pending !== undefined && <Section title={t('wait')} summary={t('pending')}>
      <div className={css.row}><span className={css.state} data-state="pending" aria-hidden="true" />
        <span>{t(pending === 'approval' ? 'approval' : pending === 'plan-review' ? 'plan' : 'question')}</span>
      </div>
    </Section>}
    {activeJobs.length > 0 && <Section title={t('jobs')} summary={t('jobsRunning', { count: activeJobs.length })}>
      <ul>{activeJobs.map(job => <li className={css.row} key={job.id}>
        <span className={css.state} data-state="running" aria-hidden="true" /><span title={job.progress}>{job.label}</span>
      </li>)}</ul>
    </Section>}
    {changed !== undefined && turn !== undefined && <Changes key={changed.seq} seq={changed.seq} turn={turn.turn} {...{ readChanges, openChanges, t }} />}
    {files.length > 0 && <Section title={t('deliveries')}>
      <ul>{files.map(file => <li key={`${file.seq}:${file.index}`}>
        <button type="button" className={css.file} title={file.path} onClick={() => act(() => openFile(cwd, file.path))}>
          <IconCodeOutlineRegular size={14} /><span>{baseName(file.path)}</span>
        </button>
      </li>)}</ul>
    </Section>}
    {percent !== undefined && <Section title={t('context')} summary={t('used', { percent })}>
      <div className={css.meter} role="meter" aria-label={t('context')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
    </Section>}
    {cwd === undefined && todos.length === 0 && pending === undefined && activeJobs.length === 0 && changed === undefined && files.length === 0 && percent === undefined
      && <p className={css.secondary}>{t('unavailable')}</p>}
    {failed && <p role="status" className={css.secondary}>{t('openFailed')}</p>}
  </div>
}

/** Register the turn status and a session details page without changing DSH's pane ownership. */
export function installTaskRuntime(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('claude.runtime', { zh, en }), 'claude-ui: task runtime strings')
  const chatFor = (sessionId: SessionId): HostObservable<ChatSnapshot | undefined> => {
    const binding = ctx.sessions.binding(sessionId)
    return binding === undefined ? emptyChat : ctx.get('uiConversation')?.binding(binding).target('chat') ?? emptyChat
  }
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'claude-ui.task-status', order: 100, locale: 'claude.runtime',
    inject: (sessionId): StripFace => ({
      hooks: { chat: chatFor(sessionId), connectionState: ctx.get('connection')?.state ?? noConnection },
      stop: async () => {
        try { await ctx.sessions.binding(sessionId)?.session.cancel() } catch { /* The Session owns the stop error. */ }
      },
    }),
  }, props => <TaskStrip key={props.sessionId} {...props} />))

  ctx.inject(['sidebarRight', 'sidebarRightTabs'], scope => {
    const t = scope.locale.bind('claude.runtime')
    const right = scope.sidebarRight
    const tabs = scope.sidebarRightTabs
    const canReview = scope.configForms.developerTools.enabled ?? noReview
    const offeredDetails = new Set<SessionId>()
    const navigate = (sessionId: SessionId, action: () => void): boolean => {
      if (right.mounted.getSnapshot() !== sessionId) return false
      try { action(); return true } catch { return false }
    }
    const fileNavigation = (sessionId: SessionId): Pick<HeaderFace, 'openFiles' | 'openChanges'> => ({
      openFiles: tabs.get('files') === undefined ? undefined : () => navigate(sessionId, () => right.openTab('files')),
      openChanges: (seq, turn, index) => canReview.getSnapshot() && tabs.get('changes-review') !== undefined
        && navigate(sessionId, () => right.openResource(`dsh-resource://changes-review/session/${encodeURIComponent(sessionId)}/${seq}/${turn}`, { kind: 'changes-review', params: index === undefined ? undefined : { index } })),
    })
    scope.effect(() => tabs.register({ id: pane, kind: pane, title: () => t('details') }), 'claude-ui: details pane type')
    scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab', key: pane, locale: 'claude.runtime',
      inject: (sessionId): DetailsFace => {
        const jobs = scope.get('jobs') as IJobs | undefined
        return {
          ...fileNavigation(sessionId),
          hooks: { chat: chatFor(sessionId), jobs: jobs?.state ?? emptyJobs, canReview },
          watchJobs: () => jobs?.watchRows(sessionId) ?? (() => {}),
          openFile: (cwd, path) => navigate(sessionId, () => right.openResource(fileAddressFor(sessionId, cwd, path))),
          readChanges: async (seq, signal) => {
            // Same authenticated, document-relative route the native turn-tail uses.
            const params = new URLSearchParams({ sessionId, seq: String(seq) })
            try {
              const response = await fetch(`api/changes.summary?${params}`, { signal })
              if (!response.ok) return undefined
              const summary = await response.json() as Partial<ChangeSummary> | null
              if (summary === null || typeof summary.total !== 'number' || !Number.isSafeInteger(summary.total)
                || !Array.isArray(summary.files) || !summary.files.every(isChangeFile)) return undefined
              return { total: summary.total, files: summary.files }
            } catch { return undefined }
          },
        }
      },
    }, props => <Details key={props.sessionId} {...props} />))
    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities', id: pane, order: -30, locale: 'claude.runtime',
      inject: (sessionId): HeaderFace => ({
        ...fileNavigation(sessionId), hooks: { chat: chatFor(sessionId), canReview },
        openDetailsWhenReady: () => {
          if (offeredDetails.has(sessionId) || !window.matchMedia('(min-width: 1120px)').matches) return
          if (navigate(sessionId, () => {
            if (!right.isExpanded()) right.openTab(pane)
          })) offeredDetails.add(sessionId)
        },
        openDetails: () => navigate(sessionId, () => {
          offeredDetails.add(sessionId)
          if (right.isExpanded() && right.active()?.kind === pane) right.toggleExpanded()
          else right.openTab(pane)
        }),
      }),
    }, props => <SessionToolbar key={props.sessionId} {...props} />))
  })
}
