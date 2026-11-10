/** Sidebar presentation modes, using the native menu and persisted UI preferences. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import { Menu, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { presetDisplayText, type PresetDisplaySource, type PresetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type {} from '@deepseek-ai/dsh-client-ui-agent-preset/client'
import { createModeCatalog, type ModeCatalogState } from './mode-catalog.ts'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { openNativeSettingsSection } from './account-menu.tsx'
import css from './mode-menu.module.css'

type Mode = 'standard' | 'create'
const zh = {
  label: '工作模式', title: '选择工作模式', custom: '添加自定义模式',
  saving: '正在切换…', failed: '未能保存界面偏好，请重试。',
  loading: '正在加载模式…', retry: '重新加载', empty: '暂无可用模式',
  noSession: '新建会话后可选择模式', started: '当前会话已开始，新建会话后可切换',
  readOnly: '当前会话只读', broken: '暂不可用', codingTools: '需先开启编码工具',
  openFailed: '未能打开自定义模式，请从设置中打开 Agent 预设。',
}
const en: Record<keyof typeof zh, string> = {
  label: 'Work mode', title: 'Choose a work mode', custom: 'Add a custom mode',
  saving: 'Switching…', failed: 'Could not save the interface preference. Try again.',
  loading: 'Loading modes…', retry: 'Reload', empty: 'No modes available',
  noSession: 'Create a chat to choose a mode', started: 'This chat has started. Create a new chat to switch modes.',
  readOnly: 'This chat is read-only', broken: 'Unavailable', codingTools: 'Enable Coding Tools first',
  openFailed: 'Could not open custom modes. Open Agent presets in Settings.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Labels for the sidebar mode menu. */
    'claude.modes': keyof typeof zh
  }
}
type Face = {
  hooks: { preferences: ConfigForm<{ mode: Mode }>; modeCatalog: SnapshotStore<ModeCatalogState> }
  saveMode: (mode: Mode) => Promise<boolean>
  loadModes: () => Promise<void>
  selectPreset: (id: string) => Promise<boolean>
  displayPreset: (preset: PresetDisplaySource) => PresetDisplayText
  openCustom: () => Promise<void>
}
type Props = PropsRuntime<'shell.overlay'> & InjectFace<Face> & PropsLocale<'claude.modes'>

function Glyph({ kind, size = 18 }: { kind: Mode | 'plus' | 'chevron' | 'check'; size?: number }) {
  const paths = {
    standard: ['m3 17 2 2 4-4', 'm3 7 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8'],
    create: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'], plus: ['M12 5v14M5 12h14'],
    chevron: ['m6 9 6 6 6-6'], check: ['m5 12 4 4L19 6'],
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[kind].map(d => <path key={d} d={d} />)}
  </svg>
}

function Dropdown({ usePreferences, useModeCatalog, saveMode, loadModes, selectPreset, displayPreset, openCustom, t, wide }: Props & { wide: boolean }) {
  const preferences = usePreferences(value => value)
  const state = useModeCatalog(value => value)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<'failed' | 'openFailed' | null>(null)
  const alive = useRef(true)
  const pending = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { void loadModes() }, [loadModes])
  useEffect(() => { if (!wide) setOpen(false) }, [wide])
  useEffect(() => { setOpen(false); setError(null) }, [state.sessionId])
  const chosen = state.options.find(option => option.id === state.current)
  const label = chosen ? displayPreset(chosen).name : state.current || t('label')
  const blocked = state.blocked === 'started' ? t('started') : state.blocked === 'read-only' ? t('readOnly') : state.blocked === 'no-session' ? t('noSession') : null
  const choose = async (id: string): Promise<void> => {
    setOpen(false)
    if (pending.current || state.busy || id === state.current) return
    pending.current = true; setError(null)
    try {
      const accepted = await selectPreset(id)
      // Only an explicit successful native mode selection can also change its
      // matching presentation. Existing sessions are never migrated on mount.
      if (accepted && alive.current && preferences.writable && (id === 'standard' || id === 'cordis')) {
        const saved = await saveMode(id === 'cordis' ? 'create' : 'standard')
        if (alive.current && !saved) setError('failed')
      }
    } catch {
      if (alive.current) setError('failed')
    } finally { pending.current = false }
  }
  const custom = (): void => {
    setOpen(false); setError(null)
    void openCustom().catch(() => { if (alive.current) setError('openFailed') })
  }
  return <>
    <Menu open={open} onClose={() => { setOpen(false) }} portal minWidthFromAnchor compact
      className={css.anchor} listClassName={css.menu}
      anchor={<button type="button" className={css.trigger} data-dsh-claude-mode-trigger=""
        aria-label={`${t('label')}：${label}`} aria-haspopup="menu" aria-expanded={open}
        aria-disabled={state.busy || undefined} aria-busy={state.busy}
        onClick={() => { if (!state.busy) { setOpen(!open); if (!open) void loadModes() } }}>
        <Glyph kind={state.current === 'cordis' ? 'create' : 'standard'} size={15} /><span className={css.triggerLabel}>{label}</span>
        <span className={css.chevron} data-open={open}><Glyph kind="chevron" size={12} /></span>
      </button>}>
      <div className={css.title}>{t('title')}</div>
      {blocked && <div className={css.explanation}>{blocked}</div>}
      {state.options.map(option => {
        const copy = displayPreset(option)
        return <div key={option.id} className={css.option} data-selected={state.current === option.id}>
          <MenuItemButton current={state.current === option.id} disabled={state.busy || !state.writable || option.broken !== undefined || option.blockedByCodingTools}
            onSelect={() => { void choose(option.id) }}>
            <span className={css.optionContent} title={option.broken ?? (option.blockedByCodingTools ? t('codingTools') : copy.description)}>
              <Glyph kind={option.id === 'cordis' ? 'create' : 'standard'} size={15} />
              <span className={css.copy}><span className={css.name}>{copy.name}</span>
                {option.broken !== undefined ? <span className={css.hint}>{t('broken')}</span>
                  : option.blockedByCodingTools ? <span className={css.hint}>{t('codingTools')}</span> : null}</span>
              {state.current === option.id && <Glyph kind="check" size={13} />}
            </span>
          </MenuItemButton>
        </div>
      })}
      {state.options.length === 0 && <div className={css.explanation}>{t(state.status === 'loading' ? 'loading' : 'empty')}</div>}
      {state.error && <div className={css.explanation} role="alert">{state.error}</div>}
      {state.status === 'error' && <div className={css.custom}><MenuItemButton onSelect={() => { void loadModes() }}>{t('retry')}</MenuItemButton></div>}
      <div className={css.separator} role="separator" />
      <div className={css.custom}><MenuItemButton onSelect={custom}>
        <span className={css.optionContent}><Glyph kind="plus" size={15} /><span>{t('custom')}</span></span>
      </MenuItemButton></div>
    </Menu>
    {state.busy || error !== null || state.error !== null ? <span className={css.notice} role={error !== null || state.error !== null ? 'alert' : 'status'}>
      {error !== null ? t(error) : state.error ?? t('saving')}
    </span> : null}
  </>
}

/** Portals own only the new mount; the sidebar and its native children stay in place. */
function SidebarModes(props: Props) {
  const [mounts, setMounts] = useState<{ id: number; node: HTMLDivElement; wide: boolean }[]>([])
  useEffect(() => {
    let sequence = 0
    const entries = new Map<HTMLElement, { id: number; node: HTMLDivElement; wide: boolean; original: (string | null)[] }>()
    const attributes = ['data-dsh-claude-sidebar', 'data-dsh-claude-sidebar-wide']
    const restore = (sidebar: HTMLElement, entry: { node: HTMLDivElement; original: (string | null)[] }): void => {
      entry.node.remove()
      attributes.forEach((name, index) => {
        const value = entry.original[index]
        if (value == null) sidebar.removeAttribute(name)
        else sidebar.setAttribute(name, value)
      })
    }
    const sync = (): void => {
      let changed = false
      for (const [sidebar, entry] of entries) if (!sidebar.isConnected) {
        restore(sidebar, entry); entries.delete(sidebar); changed = true
      }
      for (const seat of document.querySelectorAll('[data-slot="sidebar"]')) {
        const sidebar = seat.firstElementChild
        if (!(sidebar instanceof HTMLElement)) continue
        const headers = Array.from(sidebar.children).filter(child => child.hasAttribute('data-window-drag'))
        const header = headers[headers.length - 1]
        if (!header) continue
        const wide = sidebar.style.width !== ''
        let entry = entries.get(sidebar)
        if (!entry) {
          const node = document.createElement('div')
          node.className = css.mount; node.setAttribute('data-dsh-claude-modes', '')
          entry = { id: ++sequence, node, wide, original: attributes.map(name => sidebar.getAttribute(name)) }
          entries.set(sidebar, entry); changed = true
        }
        if (entry.node.previousElementSibling !== header) header.insertAdjacentElement('afterend', entry.node)
        if (entry.wide !== wide) { entry.wide = wide; changed = true }
        entry.node.hidden = !wide
        sidebar.setAttribute(attributes[0]!, ''); sidebar.toggleAttribute(attributes[1]!, wide)
      }
      if (changed) setMounts(Array.from(entries.values()).map(({ id, node, wide }) => ({ id, node, wide })))
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    sync()
    return () => { observer.disconnect(); for (const [sidebar, entry] of entries) restore(sidebar, entry) }
  }, [])
  return <>{mounts.map(mount => createPortal(<Dropdown {...props} wide={mount.wide} />, mount.node, String(mount.id)))}</>
}

/** Show the Host's complete preset roster and preserve its real selection boundaries. */
export function installModeMenu(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('claude.modes', { zh, en }), 'claude-ui: mode menu dictionaries')
  const preferences = ctx.configForms.get<{ mode: Mode }>('claude-ui')
  const catalog = createModeCatalog(ctx)
  ctx.effect(() => () => catalog.dispose(), 'claude-ui: mode catalog')
  const nativeCopy = ctx.locale.bind('settings.agentPreset')
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'claude-ui.mode-menu', locale: 'claude.modes',
    inject: (): Face => ({ hooks: { preferences, modeCatalog: catalog.store },
      saveMode: mode => preferences.set('mode', mode), loadModes: catalog.load, selectPreset: catalog.select,
      displayPreset: preset => presetDisplayText(preset, nativeCopy),
      openCustom: () => openNativeSettingsSection(ctx, 'agent-presets') }),
  }, SidebarModes))
}
