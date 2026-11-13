/** Additive homepage presentation over the native DSH conversation and sidebar. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './shell.module.css'
import { hideHomeTaskSettings } from './task-settings.ts'
import { installModeMenu } from './mode-menu.tsx'

type Mode = 'standard' | 'create'
type Width = 'narrow' | 'medium' | 'wide'

/** The Host-owned preferences consumed by homepage presentation. */
interface Preferences {
  mode: Mode
  displayName: string
  conversationWidth: Width
}

const zh = {
  'welcome.default': '你来了。',
  'welcome.named': '你来了，{name}。',
  'welcome.create': '从这里，开始构建。',
  'welcome.standardHint': '你的日常工作，交给 dsh 一起完成',
  'welcome.createHint': 'CODE / 与你的代码库一起工作',
  'suggestions.label': '从这里开始',
  'suggestions.daily': '开始今日简报',
  'suggestions.dailyHint': '整理今天的重点',
  'suggestions.dailyPrompt': '请帮我整理一份今日简报。先询问我希望关注的内容和可以使用的资料来源。',
  'suggestions.inbox': '整理收件箱',
  'suggestions.inboxHint': '梳理信息与待办',
  'suggestions.inboxPrompt': '我想整理收件箱与待办。请先确认我希望整理的范围，以及可用的数据来源。',
  'suggestions.custom': '定制我的工作流',
  'suggestions.customHint': '把想法拆成下一步',
  'suggestions.customPrompt': '请帮我设计一个适合我的工作流。先了解我的目标、常用工具和希望减少的重复工作。',
  'suggestions.staged': '已放入草稿，确认后即可发送。',
  'suggestions.unavailable': '当前输入暂不可编辑，请稍后再试。',
}

const en: Record<keyof typeof zh, string> = {
  'welcome.default': 'You’re here.',
  'welcome.named': 'You’re here, {name}.',
  'welcome.create': 'Start building, right here.',
  'welcome.standardHint': 'Your everyday work, together with dsh',
  'welcome.createHint': 'CODE / Work with your codebase',
  'suggestions.label': 'Start here',
  'suggestions.daily': 'Start a daily briefing',
  'suggestions.dailyHint': 'Find today’s priorities',
  'suggestions.dailyPrompt': 'Help me prepare a daily briefing. First ask which topics I want to focus on and which sources may be used.',
  'suggestions.inbox': 'Organize my inbox',
  'suggestions.inboxHint': 'Sort information and next steps',
  'suggestions.inboxPrompt': 'I want to organize my inbox and next steps. First confirm the scope and which data sources are available.',
  'suggestions.custom': 'Build my workflow',
  'suggestions.customHint': 'Turn an idea into a next step',
  'suggestions.customPrompt': 'Help me design a workflow. First understand my goals, everyday tools, and the repetitive work I want to reduce.',
  'suggestions.staged': 'Added to your draft. Review it before sending.',
  'suggestions.unavailable': 'The input cannot be edited right now. Try again shortly.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Homepage and mode labels owned by this plugin. */
    'claude.shell': keyof typeof zh
  }
}

type PreferencesFace = {
  hooks: { preferences: ConfigForm<Preferences> }
}

type WelcomeProps = PropsRuntime<'conversation.hero.brand.mark'>
  & InjectFace<PreferencesFace> & PropsLocale<'claude.shell'>

/** Fill the brand seat while leaving the native composer mounted. */
function Welcome({ usePreferences, t }: WelcomeProps) {
  const preferences = usePreferences(snapshot => snapshot.value)
  const creating = preferences?.mode === 'create'
  const displayName = preferences?.displayName.trim() ?? ''
  return (
    <div className={css.welcome} data-dsh-claude-welcome="">
      <span className={css.welcomeMark} data-dsh-claude-hero-mark="" aria-hidden="true">
        <FishLogo size={34} />
      </span>
      <p className={css.welcomeHint}>{t(creating ? 'welcome.createHint' : 'welcome.standardHint')}</p>
      <h1 className={css.welcomeTitle}>
        {creating ? t('welcome.create') : displayName === '' ? t('welcome.default') : t('welcome.named', { name: displayName })}
      </h1>
    </div>
  )
}

type HeroProps = PropsRuntime<'conversation.hero.options'>
  & InjectFace<PreferencesFace> & PropsLocale<'claude.shell'>

/** Stage suggested requests; project browsing remains in the native sidebar. */
function HeroTools({ usePreferences, useInput, inputActions, t }: HeroProps) {
  const mode = usePreferences(snapshot => snapshot.value?.mode ?? 'standard')
  const inputPhase = useInput(snapshot => snapshot.phase)
  const hasDraft = useInput(snapshot => snapshot.draft.trim().length > 0)
  const [notice, setNotice] = useState<'staged' | 'unavailable' | null>(null)
  const visibleNotice = notice === 'staged' && !hasDraft ? null : notice
  const [suggestionMount, setSuggestionMount] = useState<HTMLDivElement | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (mode !== 'standard') return
    let ancestor = root.current?.parentElement ?? null
    while (ancestor !== null && !ancestor.hasAttribute('data-composer-seat')) {
      const input = Array.from(ancestor.children).find(child => child.matches('[data-slot="conversation.composer.bar"]'))
      if (input !== undefined) {
        // Native input and all dock entries stay in place. Only this owned mount is added after the input.
        const mount = document.createElement('div')
        mount.className = css.suggestionMount
        mount.setAttribute('data-dsh-claude-suggestions', '')
        input.insertAdjacentElement('afterend', mount)
        setSuggestionMount(mount)
        return () => { mount.remove() }
      }
      ancestor = ancestor.parentElement
    }
    return undefined
  }, [mode])
  const stage = (prompt: string): void => {
    const span = inputActions.captureInsertion()
    if (!inputActions.insertText(prompt, span)) {
      setNotice('unavailable')
      return
    }
    inputActions.persistDraft()
    setNotice('staged')
    root.current?.closest('[data-conversation-content]')
      ?.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"]')?.focus()
  }
  return (
    <div ref={root} data-dsh-claude-hero-tools="" hidden>
      {mode !== 'standard' || suggestionMount === null ? null : createPortal((
        <>
        <div className={css.suggestions} aria-label={t('suggestions.label')}>
          {(['daily', 'inbox', 'custom'] as const).map((kind, index) => (
            <button key={kind} type="button" className={css.suggestion}
              disabled={inputPhase !== 'plain'} onClick={() => { stage(t(`suggestions.${kind}Prompt`)) }}>
              <span className={css.suggestionGlyph} aria-hidden="true">{['☷', '▱', '✧'][index]}</span>
              <span className={css.suggestionTitle}>{t(`suggestions.${kind}`)}</span>
              <span className={css.suggestionHint}>{t(`suggestions.${kind}Hint`)}</span>
            </button>
          ))}
        </div>
        {visibleNotice !== null && <div className={css.draftNotice} role="status">{t(visibleNotice === 'staged' ? 'suggestions.staged' : 'suggestions.unavailable')}</div>}
        </>
      ), suggestionMount)}
    </div>
  )
}

/** Attach presentation markers to observed native regions without moving their nodes. */
function installAnchors(): () => void {
  const previous = new Map<HTMLElement, Map<string, string | null>>()
  const mark = (element: HTMLElement | null | undefined, name: string): void => {
    if (element === null || element === undefined || element.hasAttribute(name)) return
    let attributes = previous.get(element)
    if (attributes === undefined) {
      attributes = new Map()
      previous.set(element, attributes)
    }
    attributes.set(name, element.getAttribute(name))
    element.setAttribute(name, '')
  }
  const update = (): void => {
    for (const [element, attributes] of previous) {
      if (!element.isConnected) {
        for (const [name, value] of attributes) {
          if (value === null) element.removeAttribute(name)
          else element.setAttribute(name, value)
        }
        previous.delete(element)
        continue
      }
    }
    for (const welcome of document.querySelectorAll<HTMLElement>('[data-dsh-claude-welcome]')) {
      const brandSeat = welcome.closest('[data-slot="conversation.hero.brand.mark"]')?.parentElement
      const headline = brandSeat?.parentElement
      mark(brandSeat, 'data-dsh-claude-brand-seat')
      mark(headline, 'data-dsh-claude-headline')
      mark(headline?.parentElement?.parentElement, 'data-dsh-claude-hero-welcome')
      if (headline !== null && headline !== undefined) {
        for (const child of headline.children) {
          if (child instanceof HTMLElement && child !== brandSeat && child.tagName === 'SPAN'
            && child.children.length === 2 && child.querySelector('[data-slot]') === null) {
            mark(child, 'data-dsh-claude-native-title')
          }
        }
      }
      let ancestor = headline?.parentElement ?? null
      while (ancestor !== null && !ancestor.hasAttribute('data-composer-seat')) {
        if (Array.from(ancestor.children).some(child => child.matches('[data-slot="conversation.composer.bar"]'))) {
          mark(ancestor, 'data-dsh-claude-hero-stack')
          const workspaceRow = ancestor.querySelector<HTMLElement>('[data-slot="conversation.hero.workspace"]')?.parentElement
          mark(workspaceRow, 'data-dsh-claude-workspace-row')
          mark(workspaceRow?.querySelector<HTMLButtonElement>(':scope > button[aria-haspopup="menu"]'),
            'data-dsh-claude-project-picker')
          break
        }
        ancestor = ancestor.parentElement
      }
    }
    for (const tools of document.querySelectorAll<HTMLElement>('[data-dsh-claude-hero-tools]')) {
      const options = tools.closest('[data-slot="conversation.hero.options"]')?.parentElement
      mark(options, 'data-dsh-claude-options')
      mark(options?.parentElement, 'data-dsh-claude-workspace-row')
    }
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const [element, attributes] of previous) {
      for (const [name, value] of attributes) {
        if (value === null) element.removeAttribute(name)
        else element.setAttribute(name, value)
      }
    }
  }
}

/** Register homepage contributions without replacing native layout or conversation owners. */
export function installShell(ctx: Context): void {
  installModeMenu(ctx)
  const preferences = ctx.configForms.get<Preferences>('claude-ui')
  ctx.effect(() => ctx.locale.register('claude.shell', { zh, en }), 'claude-ui: shell dictionaries')
  ctx.effect(() => {
    const root = document.documentElement
    const previousMode = root.getAttribute('data-dsh-claude-mode')
    const previousWidth = root.getAttribute('data-dsh-claude-width')
    const update = (): void => {
      const value = preferences.getSnapshot().value
      root.setAttribute('data-dsh-claude-mode', value?.mode ?? 'standard')
      root.setAttribute('data-dsh-claude-width', value?.conversationWidth ?? 'medium')
    }
    update()
    const unsubscribe = preferences.subscribe(update)
    const removeAnchors = installAnchors()
    const restoreTaskSettings = hideHomeTaskSettings()
    return () => {
      unsubscribe()
      removeAnchors()
      restoreTaskSettings()
      if (previousMode === null) root.removeAttribute('data-dsh-claude-mode')
      else root.setAttribute('data-dsh-claude-mode', previousMode)
      if (previousWidth === null) root.removeAttribute('data-dsh-claude-width')
      else root.setAttribute('data-dsh-claude-width', previousWidth)
    }
  }, 'claude-ui: presentation preferences and native anchors')
  // The native brand slots keep both the official artwork and the rail's
  // whale-to-toggle behavior. This plugin only decorates its own hero seat.
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark', priority: -100, locale: 'claude.shell',
    inject: (): PreferencesFace => ({ hooks: { preferences } }),
  }, Welcome))
  ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
    name: 'conversation.hero.options', id: 'claude-ui.homepage', order: -100, locale: 'claude.shell',
    inject: (): PreferencesFace => ({ hooks: { preferences } }),
  }, HeroTools))
}
