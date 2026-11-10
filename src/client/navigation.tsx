/** Design navigation backed by native Workspace, Plugins, Schedule, and file-preview owners. */
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './navigation.module.css'

const zh = {
  'artifacts.nav': 'Artifacts',
  'artifacts.title': '交付文件与工作区预览',
  'artifacts.description': '选择工作区，浏览文件并打开预览。对话中的交付文件仍可在对应会话中查看。',
  'artifacts.open': '打开文件预览',
  'artifacts.unavailable': '文件预览当前不可用。请先启用 DSH 的工作区文件与右侧栏插件。',
  'schedules.nav': '计划任务',
  'custom.nav': '自定义',
  'custom.description': '插件扩展管理',
  'workspace.empty': '还没有工作区',
  'workspace.defaultName': '默认工作区',
  'workspace.emptyHint': '从左侧添加工作区，或返回新对话选择一个工作目录。',
  'workspace.loading': '正在读取工作区…',
  'workspace.error': '暂时无法读取工作区，请检查连接或访问权限。',
  'workspace.openFailed': '无法打开这个工作区，请重试。',
  'workspace.opening': '正在打开…',
  'workspace.sessions': '{count} 个会话',
  'navigation.back': '返回对话',
  'navigation.new': '新建对话',
  'navigation.dismiss': '关闭通知',
  'preview.failed': '文件预览未能打开，请从当前会话的右侧栏重试。',
}

const en: Record<keyof typeof zh, string> = {
  'artifacts.nav': 'Artifacts',
  'artifacts.title': 'Delivered files and workspace previews',
  'artifacts.description': 'Choose a workspace to browse and preview files. Files delivered in a conversation remain available there.',
  'artifacts.open': 'Preview workspace files',
  'artifacts.unavailable': 'File previews are unavailable. Enable the native workspace-files and right-sidebar plugins first.',
  'schedules.nav': 'Scheduled tasks',
  'custom.nav': 'Customize',
  'custom.description': 'Plugin and extension management',
  'workspace.empty': 'No workspaces yet',
  'workspace.defaultName': 'Default workspace',
  'workspace.emptyHint': 'Add a workspace from the sidebar, or return to a new conversation to choose a working directory.',
  'workspace.loading': 'Loading workspaces…',
  'workspace.error': 'Workspaces could not be loaded. Check your connection or access permissions.',
  'workspace.openFailed': 'Could not open this workspace. Try again.',
  'workspace.opening': 'Opening…',
  'workspace.sessions': '{count} conversations',
  'navigation.back': 'Back to conversation',
  'navigation.new': 'New conversation',
  'navigation.dismiss': 'Dismiss notification',
  'preview.failed': 'Could not open the file preview. Try the current conversation’s right sidebar.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Existing-capability navigation and Workspace pages. */
    'claude.navigation': keyof typeof zh
  }
}

type Glyph = 'artifacts' | 'schedules' | 'custom'
type GlyphFace = { glyph: Glyph }
type GlyphProps = PropsRuntime<'sidebar.panellist'> & InjectFace<GlyphFace> & PropsLocale<'claude.navigation'>

/** One small navigation glyph, inside the native sidebar-owned button. */
function NavigationGlyph({ size, glyph, t }: GlyphProps) {
  const paths: Record<Glyph, string> = {
    artifacts: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
    schedules: 'M5 5h14v15H5zM8 3v4m8-4v4M5 10h14M9 14h2v2H9',
    custom: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M10 15v6',
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" data-dsh-claude-nav={glyph}>
      {glyph === 'custom' && <title>{t('custom.description')}</title>}
      <path d={paths[glyph]} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type NavigationPreferences = { mode: 'standard' | 'create' }
type FoldedPanelsFace = { hooks: { preferences: ConfigForm<NavigationPreferences> } }
type FoldedPanelsProps = PropsRuntime<'sidebar.panellist.actions'> & InjectFace<FoldedPanelsFace>

/** Keep every registered panel reachable through the native More menu in Create mode. */
function FoldedPanels({ entries, onOpen, onDismiss, usePreferences }: FoldedPanelsProps) {
  const creating = usePreferences(snapshot => snapshot.value?.mode === 'create')
  if (!creating) return null
  return <div className={css.foldedMenu} data-dsh-claude-folded-panels="">
    {entries.map(entry => <MenuItemButton key={entry.id} current={entry.active === true}
      onSelect={() => { onDismiss(); onOpen(entry.id) }}>
      <span className={css.foldedLabel}>{entry.label}</span>
    </MenuItemButton>)}
  </div>
}

/** Fold presentation only while our replacement destinations and the native More launcher exist. */
function installFoldedNavigation(ctx: Context, preferences: ConfigForm<NavigationPreferences>): () => void {
  const marked = new Set<HTMLElement>()
  const sync = (): void => {
    const enabled = preferences.getSnapshot().value?.mode === 'create'
      && ctx.slots.entriesOfSlot('sidebar.panellist.actions').some(entry => entry.component === FoldedPanels)
    const next = new Set<HTMLElement>()
    if (enabled) {
      for (const glyph of document.querySelectorAll('[data-slot="sidebar"] [data-dsh-claude-nav="custom"]')) {
        const nav = glyph.closest('nav')
        if (nav !== null && nav.querySelector('button[aria-haspopup="menu"]') !== null) next.add(nav)
      }
    }
    for (const nav of marked) {
      if (!next.has(nav)) { nav.classList.remove(css.foldedNavigation); marked.delete(nav) }
    }
    for (const nav of next) {
      if (!marked.has(nav)) { nav.classList.add(css.foldedNavigation); marked.add(nav) }
    }
  }
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  const stopPreferences = preferences.subscribe(sync)
  const stopActions = ctx.slots.subscribe('sidebar.panellist.actions', sync)
  sync()
  return () => {
    observer.disconnect(); stopPreferences(); stopActions()
    for (const nav of marked) nav.classList.remove(css.foldedNavigation)
  }
}

type PageFace = {
  hooks: { filesAvailable: HostObservable<boolean> }
  openWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  back: () => void
  startSession: () => void
}
type PageProps = PropsRuntime<'main'> & InjectFace<PageFace> & PropsLocale<'claude.navigation'>

/** Choose a Workspace for file previews; project navigation remains in the native sidebar tree. */
function WorkspacePage({ useWorkspaces, useFilesAvailable, openWorkspace, back, startSession, t }: PageProps) {
  const workspaces = useWorkspaces(snapshot => snapshot)
  const filesAvailable = useFilesAvailable(value => value)
  const [opening, setOpening] = useState<WorkspaceId | null>(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const open = async (workspaceId: WorkspaceId): Promise<void> => {
    if (opening !== null) return
    setOpening(workspaceId)
    setFailed(false)
    try {
      await openWorkspace(workspaceId)
    } catch (error) {
      // Native commands own detailed authorization and transport failures; keep this page retryable.
      if (alive.current) setFailed(true)
    } finally {
      if (alive.current) setOpening(null)
    }
  }
  return (
    <main className={css.page} data-dsh-claude-navigation="artifacts">
      <div className={css.toolbar}>
        <button type="button" className={css.back} onClick={back}>← {t('navigation.back')}</button>
      </div>
      <header className={css.heading}>
        <p className={css.eyebrow}>{t('artifacts.nav')}</p>
        <h1>{t('artifacts.title')}</h1>
        <p className={css.description}>{t('artifacts.description')}</p>
      </header>
      {!filesAvailable && <p className={css.notice} role="status">{t('artifacts.unavailable')}</p>}
      {workspaces.state === 'error' && <p className={css.notice} role="alert">{t('workspace.error')}</p>}
      {failed && <p className={css.notice} role="alert">{t('workspace.openFailed')}</p>}
      {workspaces.phase === 'pending' && workspaces.state !== 'error' && <p className={css.status} role="status">{t('workspace.loading')}</p>}
      {workspaces.phase === 'ready' && workspaces.state !== 'error' && workspaces.items.length === 0 && (
        <div className={css.empty}>
          <h2>{t('workspace.empty')}</h2>
          <p>{t('workspace.emptyHint')}</p>
          <button type="button" className={css.action} onClick={startSession}>{t('navigation.new')}</button>
        </div>
      )}
      <div className={css.workspaces}>
        {workspaces.items.map(workspace => (
          <article key={workspace.workspaceId} className={css.workspace}>
            <div className={css.workspaceInfo}>
              <h2>{workspaceDisplayTitle(workspace.title || workspace.path, t('workspace.defaultName'))}</h2>
              <p className={css.path} title={workspace.path}>{workspace.path}</p>
              <span className={css.count}>{t('workspace.sessions', { count: String(workspace.sessionIds.length) })}</span>
            </div>
            <button type="button" className={css.action} disabled={opening !== null || !filesAvailable}
              onClick={() => { void open(workspace.workspaceId) }}>
              {t(opening === workspace.workspaceId ? 'workspace.opening' : 'artifacts.open')}
            </button>
          </article>
        ))}
      </div>
    </main>
  )
}

type PreviewRequest = { sessionId: SessionId; token: number } | null
type CommitFace = {
  hooks: { previewRequest: HostObservable<PreviewRequest> }
  commit: (token: number) => void
}
type CommitProps = PropsRuntime<'conversation.input.dock'> & InjectFace<CommitFace>

/** Open a requested native tab only after the destination Session's UI has committed. */
function PreviewCommit({ sessionId, usePreviewRequest, commit }: CommitProps) {
  const request = usePreviewRequest(value => value)
  useEffect(() => {
    // The native right-sidebar store is adopted during render; a passive effect runs after that commit.
    if (request?.sessionId === sessionId) commit(request.token)
  }, [request, sessionId, commit])
  return null
}

type NoticeFace = { hooks: { notice: HostObservable<boolean> }; dismiss: () => void }
type NoticeProps = PropsRuntime<'shell.overlay'> & InjectFace<NoticeFace> & PropsLocale<'claude.navigation'>

/** A tab-opening error remains visible after leaving the Workspace selection page. */
function NavigationNotice({ useNotice, dismiss, t }: NoticeProps) {
  const notice = useNotice(value => value)
  if (!notice) return null
  return (
    <div className={css.toast} role="alert">
      <span>{t('preview.failed')}</span>
      <button type="button" className={css.dismiss} onClick={dismiss} aria-label={t('navigation.dismiss')}>×</button>
    </div>
  )
}

/** Relabel one existing native cell while retaining its identity, panel, pin state, and fallback. */
function relabelNative(ctx: Context, id: 'schedules' | 'plugins', glyph: 'schedules' | 'custom', order: number): void {
  const t = ctx.locale.bind('claude.navigation')
  ctx.slots.inject('sidebar.panellist', () => {
    let dispose: (() => void) | undefined
    const sync = (): void => {
      const rows = ctx.slots.entries('sidebar.panellist').filter(entry => entry.options.id === id)
      const native = rows.some(entry => (entry.options.priority ?? 0) !== -100)
        && ctx.slots.entries('main').some(entry => entry.options.key === id)
      if (!native && dispose !== undefined) {
        const remove = dispose
        dispose = undefined
        remove()
      } else if (native && dispose === undefined && !rows.some(entry => entry.options.priority === -100)) {
        dispose = ctx.slots.register({
          name: 'sidebar.panellist', id, priority: -100, order, locale: 'claude.navigation',
          label: () => t(glyph === 'schedules' ? 'schedules.nav' : 'custom.nav'),
          inject: (): GlyphFace => ({ glyph }),
        }, NavigationGlyph)
      }
    }
    const stopPanels = ctx.slots.subscribe('main', sync)
    const stopRows = ctx.slots.subscribe('sidebar.panellist', sync)
    sync()
    return () => { stopPanels(); stopRows(); dispose?.() }
  })
}

/** Add the design's navigation using existing DSH data, commands, and plugin registries. */
export function installNavigation(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('claude.navigation', { zh, en }), 'claude-ui: navigation dictionaries')
  const t = ctx.locale.bind('claude.navigation')
  const preferences = ctx.configForms.get<NavigationPreferences>('claude-ui')
  // An older installation may still have the removed central Projects page selected.
  if (ctx.layout.panelInfo.getSnapshot().activePanelId === 'claude-ui.projects') ctx.layout.selectPanel(null)
  const filesAvailable = createSnapshotStore(false)
  const previewRequest = createSnapshotStore<PreviewRequest>(null)
  const notice = createSnapshotStore(false)
  let sequence = 0
  let sidebar: ISidebarRight | undefined
  let active = true
  ctx.effect(() => () => {
    active = false
    previewRequest.set(null)
  }, 'claude-ui: navigation lifetime')
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope: Context) => {
    const controller = scope.sidebarRight
    sidebar = controller
    const sync = (): void => {
      const definition = scope.sidebarRightTabs.get('files')
      filesAvailable.set(definition !== undefined && scope.slots.entriesOfSlot('sidebar.right.pane.tab')
        .some(entry => entry.options.key === definition.id))
    }
    const cancelSuperseded = (): void => {
      const request = previewRequest.getSnapshot()
      const mounted = controller.mounted.getSnapshot()
      if (request !== null && mounted !== undefined && mounted !== request.sessionId) previewRequest.set(null)
    }
    scope.effect(() => {
      const stopTypes = scope.sidebarRightTabs.subscribe(sync)
      const stopBodies = scope.slots.subscribe('sidebar.right.pane.tab', sync)
      const stopMounted = controller.mounted.subscribe(cancelSuperseded)
      sync()
      return () => {
        stopTypes(); stopBodies(); stopMounted()
        if (sidebar === controller) sidebar = undefined
        filesAvailable.set(false)
        previewRequest.set(null)
      }
    }, 'claude-ui: native preview availability')
  })
  ctx.effect(() => ctx.layout.panelInfo.subscribe(() => {
    if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) previewRequest.set(null)
  }), 'claude-ui: cancel preview after another navigation')

  const openWorkspace = async (workspaceId: WorkspaceId): Promise<void> => {
    if (!filesAvailable.getSnapshot()) throw new Error('Native files preview is unavailable')
    previewRequest.set(null)
    notice.set(false)
    await ctx.uiWorkspace.openWorkspace(workspaceId, sessionId => {
      if (active) previewRequest.set({ sessionId, token: ++sequence })
    })
  }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'claude-ui.artifacts', locale: 'claude.navigation',
    inject: (): PageFace => ({
      hooks: { filesAvailable }, openWorkspace,
      back: () => { ctx.layout.selectPanel(null) },
      startSession: () => { ctx.uiWorkspace.startSession() },
    }),
  }, WorkspacePage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'claude-ui.artifacts', order: -20, locale: 'claude.navigation',
    label: () => t('artifacts.nav'),
    inject: (): GlyphFace => ({ glyph: 'artifacts' }),
  }, NavigationGlyph))
  relabelNative(ctx, 'schedules', 'schedules', -10)
  relabelNative(ctx, 'plugins', 'custom', 0)
  ctx.slots.inject('sidebar.panellist.actions', () => {
    const removeRows = ctx.slots.register({
      name: 'sidebar.panellist.actions', id: 'claude-ui.folded-panels', order: -100,
      inject: (): FoldedPanelsFace => ({ hooks: { preferences } }),
    }, FoldedPanels)
    const restoreNavigation = installFoldedNavigation(ctx, preferences)
    return () => { restoreNavigation(); removeRows() }
  })
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'claude-ui.preview-commit', order: 100,
    inject: (sessionId): CommitFace => ({
      hooks: { previewRequest },
      commit: token => {
        const request = previewRequest.getSnapshot()
        if (request?.sessionId !== sessionId || request.token !== token) return
        previewRequest.set(null)
        if (!active || sidebar?.mounted.getSnapshot() !== sessionId) return
        if (!filesAvailable.getSnapshot()) { notice.set(true); return }
        try {
          sidebar.openTab('files')
        } catch (error) {
          // Preserve native navigation and surface failure without inventing an empty file preview.
          notice.set(true)
        }
      },
    }),
  }, PreviewCommit))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'claude-ui.navigation-notice', locale: 'claude.navigation', order: 100,
    inject: (): NoticeFace => ({ hooks: { notice }, dismiss: () => { notice.set(false) } }),
  }, NavigationNotice))
}
