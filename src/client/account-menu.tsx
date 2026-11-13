/** Scoped presentation over the native account owner, including its sign-in/out dialogs. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleSettings } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import css from './account-menu.module.css'

const zh = {
  menu: '账户菜单', personal: '个人账户', local: '本地工作区', signedOut: '未登录',
  connected: 'DSH 已连接', connecting: 'DSH 连接中', disconnected: 'DSH 未连接',
  language: '语言', appearance: '外观', light: '浅色', dark: '深色',
  releases: '查看更新日志', updates: '检查更新', desktopOnly: '仅桌面端可用',
  failed: '操作未完成，请重试。', saving: '正在保存…', navigationFailed: '未能打开设置页面，请重试。',
}
const en: Record<keyof typeof zh, string> = {
  menu: 'Account menu', personal: 'Personal account', local: 'Local workspace', signedOut: 'Not signed in',
  connected: 'DSH connected', connecting: 'DSH connecting', disconnected: 'DSH disconnected',
  language: 'Language', appearance: 'Appearance', light: 'Light', dark: 'Dark',
  releases: 'View release notes', updates: 'Check for updates', desktopOnly: 'Desktop only',
  failed: 'Could not complete the action. Try again.', saving: 'Saving…', navigationFailed: 'Could not open Settings. Try again.',
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'claude.account': keyof typeof zh }
}

type UpdateBridge = { open: () => Promise<void> }
type Identity = { name: string; signedOut: boolean }
const triggerSelector = '[data-slot="settings.launcher"] button[data-signed-out][aria-haspopup="menu"]'

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className !== undefined) element.className = className
  return element
}
function text(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value
}
function icon(kind: 'chevron' | 'globe' | 'palette' | 'sun' | 'moon' | 'notes' | 'refresh'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '17', height: '17', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value)
  const paths: Record<typeof kind, string[]> = {
    chevron: ['m7 10 5 5 5-5'],
    globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', 'M3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z'],
    palette: ['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-.4a1.6 1.6 0 0 1 0-3H15a6 6 0 0 0 0-11Z', 'M7 10h.01M9 6h.01M14 6h.01M17 10h.01'],
    sun: ['M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M12 2v2M12 20v2M2 12h2M20 12h2m-3-7 1.4-1.4M5 19l1.4-1.4M5 5l1.4 1.4M17.6 17.6 19 19'],
    moon: ['M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z'],
    notes: ['M8 3h11v18H8V7H3V3h5M3 7V3M11 8h5M11 12h5M11 16h5'],
    refresh: ['M20 7v5h-5M4 17v-5h5', 'M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17'],
  }
  for (const d of paths[kind]) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path) }
  return svg
}

function nativeMenu(ctx: Context, trigger: HTMLButtonElement): HTMLElement | null {
  if (trigger.getAttribute('aria-expanded') !== 'true') return null
  const native = ctx.locale.bind('settings.account')
  const candidates = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].filter(menu => {
    const labels = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .filter(button => !button.closest('[data-dsh-claude-account-owned]')).map(button => button.textContent?.trim() ?? '')
    return labels.some(label => label.startsWith(native('settings')))
      && labels.some(label => label === native('contactUs'))
      && labels.some(label => label === native('signIn') || label === native('signOut'))
  })
  return candidates.length === 1 ? candidates[0]! : null
}

/** Open the existing settings owner, then select exactly one live section label. */
export function openNativeSettingsSection(ctx: Context, id: string): Promise<void> {
  const t = ctx.locale.bind('claude.account')
  return new Promise((resolve, reject) => {
    let settled = false
    let releaseNavigation: (() => Promise<void>) | undefined
    let openedAccount = false
    let requestedSettings = false
    const finish = (success: boolean): void => {
      if (settled) return
      settled = true; observer.disconnect(); window.clearTimeout(timeout)
      void releaseNavigation?.()
      if (success) resolve(); else reject(new Error(t('navigationFailed')))
    }
    const seek = (): void => {
      if (settled) return
      const panel = document.querySelector('[data-shortcut-modal="settings"]')
      if (panel !== null) {
        const entry = ctx.slots.entries('settings.section').find(candidate => candidate.options.id === id)
        const label = typeof entry?.options.label === 'function' ? entry.options.label() : entry?.options.label
        const rows = [...panel.querySelectorAll<HTMLButtonElement>('nav button')].filter(button => button.textContent?.trim() === label?.trim())
        if (label && rows.length === 1) { rows[0]!.click(); finish(true) }
        return
      }
      const trigger = document.querySelector<HTMLButtonElement>(triggerSelector)
      if (trigger === null) return
      if (!openedAccount) {
        openedAccount = true
        if (trigger.getAttribute('aria-expanded') !== 'true') { trigger.click(); return }
      }
      if (requestedSettings) return
      const menu = nativeMenu(ctx, trigger)
      const label = ctx.locale.bind('settings.account')('settings')
      const rows = [...menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []]
        .filter(button => !button.closest('[data-dsh-claude-account-owned]') && button.textContent?.trim().startsWith(label))
      if (rows.length === 1) { requestedSettings = true; rows[0]!.click() }
    }
    const observer = new MutationObserver(seek)
    const timeout = window.setTimeout(() => { finish(false) }, 2000)
    releaseNavigation = ctx.effect(() => () => { finish(false) }, 'claude-ui: bounded settings navigation')
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    seek()
  })
}

/** Style only the inspected native launcher and add preference rows to its own menu. */
export function installAccountMenu(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('claude.account', { zh, en }), 'claude-ui: account dictionaries')
  ctx.effect(() => {
    const t = ctx.locale.bind('claude.account')
    const preferences = ctx.configForms.get<{ displayName: string }>('claude-ui')
    const appearance = ctx.configForms.get<ThemeSettings>('ui-theme')
    const language = ctx.configForms.get<LocaleSettings>('locale')
    const connection = ctx.get('connection') as ConnectionHandle | undefined
    const carrier = (globalThis as typeof globalThis & { dshDesktop?: { protocolVersion: number; updates?: UpdateBridge } }).dshDesktop
    const updates = carrier?.protocolVersion === 1 ? carrier.updates : undefined
    let alive = true
    let busy = false
    let failure = false
    let trigger: HTMLButtonElement | null = null
    let content: HTMLSpanElement | null = null
    let menu: HTMLElement | null = null
    let summary: HTMLDivElement | null = null
    let controls: HTMLDivElement | null = null
    let initial: HTMLSpanElement | null = null
    let nameLabel: HTMLSpanElement | null = null
    let subtitle: HTMLElement | null = null
    let summaryName: HTMLSpanElement | null = null
    let status: HTMLSpanElement | null = null
    let languageLabel: HTMLSpanElement | null = null
    let languageValue: HTMLSpanElement | null = null
    let languageChoices: HTMLDivElement | null = null
    let languageButton: HTMLButtonElement | null = null
    let appearanceLabel: HTMLSpanElement | null = null
    let releaseLabel: HTMLSpanElement | null = null
    let updateLabel: HTMLSpanElement | null = null
    let notice: HTMLParagraphElement | null = null
    let languageVersion = ''
    let floating: HTMLButtonElement | null = null
    let avatarMarkup: string | undefined
    const themeButtons = new Map<'light' | 'dark', HTMLButtonElement>()
    const close = (): void => { if (trigger?.getAttribute('aria-expanded') === 'true') trigger.click() }
    const persist = async (operation: () => Promise<boolean>): Promise<void> => {
      if (busy) return
      busy = true; failure = false; sync()
      try { if (!await operation()) throw new Error('rejected') }
      catch { failure = true }
      finally { busy = false; if (alive) sync() }
    }
    const clearMenu = (): void => {
      menu?.classList.remove(css.menu)
      summary?.remove(); controls?.remove()
      menu = null; summary = null; controls = null; themeButtons.clear(); languageVersion = ''
    }
    const clearTrigger = (): void => {
      trigger?.classList.remove(css.trigger)
      trigger?.removeAttribute('data-dsh-claude-account')
      content?.remove(); trigger = null; content = null
    }
    const clearFloating = (): void => {
      floating?.remove(); floating = null; avatarMarkup = undefined
    }
    const row = (kind: Parameters<typeof icon>[0]): { button: HTMLButtonElement; label: HTMLSpanElement } => {
      const button = node('button', css.row); button.type = 'button'; button.setAttribute('role', 'menuitem')
      const label = node('span', css.rowLabel); button.append(icon(kind), label)
      return { button, label }
    }
    const sync = (): void => {
      if (!alive) return
      const next = document.querySelector<HTMLButtonElement>(triggerSelector)
      if (next !== trigger) { clearMenu(); clearTrigger(); trigger = next }
      if (trigger === null) { clearFloating(); return }
      const signedOut = trigger.getAttribute('data-signed-out') === 'true'
      const nativeLabel = [...trigger.children].find(child => child.tagName === 'SPAN' && (child.textContent?.trim().length ?? 0) > 0 && !child.hasAttribute('data-avatar-status') && !child.hasAttribute('data-dsh-claude-account-owned'))
      const identity: Identity = { signedOut, name: (!signedOut ? nativeLabel?.textContent?.trim() : '') || preferences.getSnapshot().value?.displayName.trim() || t(signedOut ? 'local' : 'personal') }
      const collapsed = document.documentElement.getAttribute('data-platform') === 'darwin'
        && document.querySelector('[data-sidebar-collapsed]') !== null
      if (!collapsed) {
        clearFloating()
      } else {
        if (floating === null) {
          floating = node('button', css.floatingAvatar)
          floating.type = 'button'
          floating.setAttribute('data-dsh-claude-floating-account', '')
          floating.setAttribute('aria-label', t('menu'))
          floating.addEventListener('click', () => {
            document.querySelector<HTMLButtonElement>(triggerSelector)?.click()
          })
          document.body.append(floating)
        }
        const avatar = trigger.querySelector<HTMLElement>('[data-avatar-status]')
        const markup = avatar?.outerHTML ?? ''
        if (markup !== avatarMarkup) {
          avatarMarkup = markup
          floating.replaceChildren()
          if (avatar !== null) {
            const clone = avatar.cloneNode(true) as HTMLElement
            clone.setAttribute('aria-hidden', 'true')
            floating.append(clone)
          } else {
            const fallback = node('span', css.floatingInitial)
            text(fallback, Array.from(identity.name)[0]?.toLocaleUpperCase() ?? 'D')
            floating.append(fallback)
          }
        }
      }
      if (content === null) {
        content = node('span', css.triggerContent); content.setAttribute('data-dsh-claude-account-owned', ''); content.setAttribute('aria-hidden', 'true')
        initial = node('span', css.initial)
        const labels = node('span', css.identity); nameLabel = node('span', css.name); subtitle = node('small', css.subtitle)
        labels.append(nameLabel, subtitle); content.append(initial, labels, icon('chevron')); trigger.append(content)
        trigger.classList.add(css.trigger); trigger.setAttribute('data-dsh-claude-account', '')
      }
      text(initial!, Array.from(identity.name)[0]?.toLocaleUpperCase() ?? 'D')
      text(nameLabel!, identity.name); text(subtitle!, t(signedOut ? 'signedOut' : 'personal'))
      const discoveredMenu = nativeMenu(ctx, trigger)
      // Locale changes update the native labels after this subscriber; retain the known open owner meanwhile.
      const nextMenu = discoveredMenu ?? (menu?.isConnected && trigger.getAttribute('aria-expanded') === 'true' ? menu : null)
      if (nextMenu !== menu) { clearMenu(); menu = nextMenu }
      if (menu === null) return
      if (summary === null) {
        const first = menu.querySelector<HTMLButtonElement>('button[role="menuitem"]')
        const wrapper = first?.parentElement
        const viewport = wrapper?.parentElement
        if (wrapper === undefined || wrapper === null || viewport === null || viewport === undefined) return
        menu.classList.add(css.menu)
        summary = node('div', css.summary); summary.setAttribute('data-dsh-claude-account-owned', '')
        summaryName = node('span', css.summaryName); status = node('span', css.status); summary.append(summaryName, status); viewport.prepend(summary)
        controls = node('div', css.controls); controls.setAttribute('data-dsh-claude-account-owned', '')
        const languageRow = row('globe'); languageButton = languageRow.button; languageLabel = languageRow.label
        languageValue = node('span', css.detail); languageButton.append(languageValue); languageButton.setAttribute('aria-expanded', 'false')
        languageChoices = node('div', css.languages); languageChoices.hidden = true
        languageButton.addEventListener('click', () => { if (languageChoices === null || languageButton === null) return; languageChoices.hidden = !languageChoices.hidden; languageButton.setAttribute('aria-expanded', String(!languageChoices.hidden)); sync() })
        const themeRow = node('div', css.themeRow); appearanceLabel = node('span', css.rowLabel); themeRow.append(icon('palette'), appearanceLabel)
        const choices = node('div', css.themeChoices); choices.setAttribute('role', 'group')
        for (const value of ['light', 'dark'] as const) {
          const button = node('button', css.themeButton); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.append(icon(value === 'light' ? 'sun' : 'moon'))
          button.addEventListener('click', () => { void persist(() => appearance.set('preference', value)) }); themeButtons.set(value, button); choices.append(button)
        }
        themeRow.append(choices)
        const separator = node('div', css.separator); separator.setAttribute('role', 'separator')
        const releases = row('notes'); releaseLabel = releases.label
        releases.button.addEventListener('click', () => { close(); window.open('https://github.com/deepseek-ai/deepseek-harness/releases', '_blank', 'noopener,noreferrer') })
        const update = row('refresh'); updateLabel = update.label
        update.button.disabled = updates === undefined
        if (updates === undefined) { const detail = node('span', css.detail); detail.dataset.desktopOnly = ''; update.button.append(detail) }
        update.button.addEventListener('click', () => { if (updates === undefined) return; failure = false; void updates.open().catch(() => { failure = true; if (alive) sync() }) })
        notice = node('p', css.notice); notice.setAttribute('role', 'status')
        const finalSeparator = node('div', css.separator); finalSeparator.setAttribute('role', 'separator')
        controls.append(languageButton, languageChoices, themeRow, separator, releases.button, update.button, notice, finalSeparator)
        wrapper.insertAdjacentElement('afterend', controls)
      }
      text(summaryName!, identity.name)
      const state = connection?.state.getSnapshot()
      text(status!, `${t(signedOut ? 'signedOut' : 'personal')} · ${t(state === 'connected' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected')}`)
      status!.dataset.connected = String(state === 'connected')
      text(languageLabel!, t('language')); text(appearanceLabel!, t('appearance')); text(releaseLabel!, t('releases')); text(updateLabel!, t('updates'))
      controls?.querySelectorAll<HTMLElement>('[data-desktop-only]').forEach(element => { text(element, t('desktopOnly')) })
      const locales = ctx.locale.getSnapshot()
      text(languageValue!, locales.locales.find(item => item.id === locales.active)?.label ?? locales.active)
      const nextLanguageVersion = JSON.stringify(locales.locales.map(item => [item.id, item.label]))
      if (languageVersion !== nextLanguageVersion && languageChoices !== null) {
        languageVersion = nextLanguageVersion; languageChoices.replaceChildren()
        for (const item of locales.locales) {
          const button = node('button', css.languageChoice); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.dataset.locale = item.id; text(button, item.label)
          button.addEventListener('click', () => {
            if (busy) return
            void persist(() => language.set('preference', item.id)).then(() => {
              if (!alive || !menu?.isConnected || trigger?.getAttribute('aria-expanded') !== 'true') return
              // Restore only focus owned by this selection; never take it from another interaction.
              if (document.activeElement !== button && document.activeElement !== document.body) return
              if (languageChoices !== null) languageChoices.hidden = true
              languageButton?.setAttribute('aria-expanded', 'false')
              sync()
              languageButton?.focus()
            })
          }); languageChoices.append(button)
        }
      }
      const languageReady = language.getSnapshot().status === 'ready' && language.getSnapshot().writable
      languageChoices?.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = !languageReady || languageChoices?.hidden === true; button.setAttribute('aria-disabled', String(busy)); button.setAttribute('aria-current', button.dataset.locale === locales.active ? 'true' : 'false') })
      const theme = appearance.getSnapshot()
      const activeTheme = ctx.theme.getTheme().active.colorScheme
      for (const [value, button] of themeButtons) { button.disabled = theme.status !== 'ready' || !theme.writable; button.setAttribute('aria-disabled', String(busy)); button.setAttribute('aria-label', t(value)); button.title = t(value); button.setAttribute('aria-pressed', String(activeTheme === value)) }
      text(notice!, failure ? t('failed') : busy ? t('saving') : ''); notice!.hidden = !failure && !busy
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['data-signed-out', 'data-avatar-status', 'data-collapsed', 'data-sidebar-collapsed', 'aria-expanded'] })
    const unsubscribers = [preferences.subscribe(sync), appearance.subscribe(sync), language.subscribe(sync), ctx.locale.subscribe(sync), ctx.on('theme/change', sync), connection?.state.subscribe(sync)]
    sync()
    return () => { alive = false; observer.disconnect(); for (const unsubscribe of unsubscribers) unsubscribe?.(); clearMenu(); clearTrigger(); clearFloating() }
  }, 'claude-ui: native account presentation')
}
