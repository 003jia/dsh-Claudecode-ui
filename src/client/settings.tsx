/** Settings stay owned by the native shell; this plugin adds one appearance page. */
import { useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { Button, Input, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeSettings } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import css from './settings.module.css'

const en = {
  appearance: 'Appearance', appearanceHint: 'Make this space feel like yours.',
  accountMenu: 'Personal menu', personalSpace: 'My workspace', preferences: 'Personal preferences',
  settings: 'Settings', models: 'Inference settings', language: 'Language', account: 'Account',
  theme: 'Theme', themeHint: 'Choose how the interface appears.', light: 'Light', dark: 'Dark', system: 'System',
  typography: 'Typography', textFont: 'Interface font', codeFont: 'Code font', fontDefault: 'System default',
  fontHint: 'Enter installed font names, separated by commas.', textSize: 'Text size', codeSize: 'Code size',
  layout: 'Layout', width: 'Conversation width', narrow: 'Narrow', medium: 'Comfortable', wide: 'Wide',
  applyWidth: 'Apply preset', widthHint: 'You can still drag to adjust the conversation width after applying a preset.',
  widthApplyFailed: 'The preset is saved but could not be applied. Try applying it again.',
  homeMode: 'Home view', standard: 'Standard', create: 'Create',
  homeModeHint: 'Changes the home view while keeping your current model and permissions.',
  displayName: 'Display name', displayNameHint: 'Used in your welcome message.', namePlaceholder: 'How should we call you?',
  saved: 'Saved', saving: 'Saving…', automatic: 'Changes are saved automatically.',
  loading: 'Loading preferences…', unavailable: 'These preferences are unavailable. Reopen Settings to try again.',
  readOnly: 'Preferences are read-only in this connection.', saveFailed: 'Could not save. Your selection is kept; try again.',
  navigationFailed: 'The page could not be opened. Choose it from the Settings navigation.',
  choose: 'Choose', modelHint: 'Manage model services, sign-in methods, and API keys.',
  openModels: 'Open model settings', sizeInvalid: 'Choose a whole number within the displayed range.',
} as const
const zh: Record<keyof typeof en, string> = {
  appearance: '外观', appearanceHint: '让这个空间更合你的习惯。',
  accountMenu: '个人菜单', personalSpace: '我的空间', preferences: '个人偏好',
  settings: '设置', models: '推理配置', language: '语言', account: '账户',
  theme: '主题', themeHint: '选择你喜欢的界面外观。', light: '浅色', dark: '深色', system: '跟随系统',
  typography: '字体', textFont: '界面字体', codeFont: '代码字体', fontDefault: '系统默认',
  fontHint: '输入本机已安装的字体名称，多个字体用逗号分隔。', textSize: '文字大小', codeSize: '代码字号',
  layout: '布局', width: '对话宽度', narrow: '紧凑', medium: '适中', wide: '宽松',
  applyWidth: '应用预设', widthHint: '应用预设后，仍可拖动调整对话宽度。',
  widthApplyFailed: '预设已保存，但尚未应用。请再次点击应用预设。',
  homeMode: '首页视图', standard: '标准', create: '创造',
  homeModeHint: '切换首页布局，保留当前模型与权限。',
  displayName: '称呼', displayNameHint: '显示在首页的欢迎语中。', namePlaceholder: '希望我们怎么称呼你？',
  saved: '已保存', saving: '正在保存…', automatic: '更改会自动保存。',
  loading: '正在读取偏好…', unavailable: '暂时无法读取偏好，请重新打开设置后重试。',
  readOnly: '当前连接只能查看偏好。', saveFailed: '未能保存，已保留你的选择，请重试。',
  navigationFailed: '未能打开该页面，请从设置左侧导航中选择。',
  choose: '选择', modelHint: '管理模型服务、登录方式和 API Key。',
  openModels: '打开模型设置', sizeInvalid: '请在显示范围内选择整数。',
}
type Key = keyof typeof en
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { claudeUiSettings: Key }
}

type Preferences = { mode: 'standard' | 'create'; displayName: string; conversationWidth: 'narrow' | 'medium' | 'wide' }
type ThemeField = 'preference' | 'fontSize' | 'codeFontSize' | 'textFontFamily' | 'codeFontFamily'
type Field = ThemeField | keyof Preferences
type SharedInjected = {
  hooks: { preferences: ConfigForm<Preferences> }
}
type AppearanceInjected = SharedInjected & {
  hooks: SharedInjected['hooks'] & { appearance: ConfigForm<ThemeSettings> }
  savePreference: (field: keyof Preferences, value: string) => Promise<void>
  saveAppearance: (field: ThemeField, value: string | number) => Promise<void>
  openModels: () => Promise<void>
}
type AppearanceProps = PropsRuntime<'settings.section'> & PropsLocale<'claudeUiSettings'> & InjectFace<AppearanceInjected>

function Choice({ label, value, options, disabled, onChange }: {
  label: string; value: string; options: readonly { value: string; label: string }[]
  disabled: boolean; onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} portal align="end" selectedId={value}
    onClose={() => { setOpen(false) }}
    items={options.map(option => ({ id: option.value, label: option.label }))}
    onSelect={id => { setOpen(false); onChange(id) }}
    anchor={<Button variant="outline" className={css.choice} disabled={disabled}
      aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open) }}>
      {options.find(option => option.value === value)?.label ?? value}<span aria-hidden="true">⌄</span>
    </Button>} />
}

function Appearance({ t, usePreferences, useAppearance, savePreference, saveAppearance, openModels }: AppearanceProps) {
  const preferences = usePreferences(value => value)
  const appearance = useAppearance(value => value)
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({})
  const [pending, setPending] = useState<ReadonlySet<Field>>(() => new Set())
  const [errors, setErrors] = useState<Partial<Record<Field | 'navigation', string>>>({})
  const [saved, setSaved] = useState(false)
  const generations = useRef<Partial<Record<Field, number>>>({})
  const ready = (snapshot: ConfigFormSnapshot<unknown>) => snapshot.status === 'ready' && snapshot.writable
  const canTheme = ready(appearance)
  const canOwn = ready(preferences)
  const theme = appearance.value
  const own = preferences.value

  const edit = (field: Field, value: string) => {
    setDrafts(previous => ({ ...previous, [field]: value }))
    setSaved(false)
  }
  const persist = async (field: Field, value: string, target: 'own' | 'theme') => {
    const generation = (generations.current[field] ?? 0) + 1
    generations.current[field] = generation
    setPending(previous => new Set([...previous, field]))
    setSaved(false)
    setErrors(previous => ({ ...previous, [field]: undefined }))
    try {
      if (field === 'fontSize' || field === 'codeFontSize') {
        const px = Number(value)
        const maximum = field === 'fontSize' ? 22 : 16
        if (!Number.isInteger(px) || px < 10 || px > maximum) throw new Error(t('sizeInvalid'))
        await saveAppearance(field, px)
      } else if (target === 'theme') await saveAppearance(field as ThemeField, value)
      else await savePreference(field as keyof Preferences, value)
      if (generations.current[field] !== generation) return
      setDrafts(previous => {
        if (previous[field] !== value) return previous
        const next = { ...previous }; delete next[field]; return next
      })
      setSaved(true)
    } catch (error) {
      if (generations.current[field] === generation) {
        setErrors(previous => ({ ...previous, [field]: error instanceof Error ? error.message : t('saveFailed') }))
      }
    } finally {
      if (generations.current[field] === generation) setPending(previous => {
        const next = new Set(previous); next.delete(field); return next
      })
    }
  }
  const select = (field: Field, value: string, target: 'own' | 'theme') => {
    edit(field, value); void persist(field, value, target)
  }
  const input = (field: ThemeField | 'displayName', label: string, value: string, target: 'own' | 'theme', numeric = false) => (
    <Input aria-label={label} aria-invalid={errors[field] !== undefined}
      className={numeric ? css.numberInput : css.fontInput}
      type={numeric ? 'number' : 'text'} {...(numeric ? { min: 10, max: field === 'fontSize' ? 22 : 16, step: 1 } : {})}
      placeholder={field === 'displayName' ? t('namePlaceholder') : t('fontDefault')}
      maxLength={field === 'displayName' ? 80 : 256}
      disabled={target === 'theme' ? !canTheme : !canOwn} value={drafts[field] ?? value}
      onChange={event => { edit(field, event.target.value) }}
      onBlur={event => { if (drafts[field] !== undefined) void persist(field, event.target.value, target) }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
  )
  return <section className={css.appearance} data-claude-appearance="">
    <header className={css.pageHeader}><h2>{t('appearance')}</h2><p>{t('appearanceHint')}</p></header>
    {appearance.status !== 'ready' && <p role="status" className={css.notice}>{t(appearance.status === 'loading' ? 'loading' : 'unavailable')}</p>}
    {appearance.status === 'ready' && !appearance.writable && <p className={css.notice}>{t('readOnly')}</p>}
    <div className={css.group}>
      <div className={css.groupTitle}><h3>{t('theme')}</h3><p>{t('themeHint')}</p></div>
      <div className={css.themeChoices} role="group" aria-label={t('theme')}>
        {(['light', 'dark'] as const).map(value => <Button key={value} variant="outline"
          className={css.themeChoice} disabled={!canTheme || pending.has('preference')}
          aria-label={t(value)}
          aria-pressed={(drafts.preference ?? theme?.preference) === value}
          data-theme-choice={value} onClick={() => { select('preference', value, 'theme') }}>
          <span className={css.themePreview} aria-hidden="true">
            <span className={css.previewTitlebar}><span /><span /><span /></span>
            <code className={css.previewCode}>
              <span className={css.previewLine}><span className={css.codeKeyword}>function</span>{' greet() {'}</span>
              <span className={css.deletedLine}>{'−   return "Hello";'}</span>
              <span className={css.addedLine}>{'+   return "Hello, world!";'}</span>
              <span className={css.previewLine}>{'}'}</span>
            </code>
          </span>
          <span className={css.themeCaption}><span>{t(value)}</span><span className={css.themeRadio} aria-hidden="true" /></span>
        </Button>)}
      </div>
      <div className={css.systemRow}><Button variant="ghost" size="sm" aria-label={t('system')}
        aria-pressed={(drafts.preference ?? theme?.preference) === 'system'}
        disabled={!canTheme || pending.has('preference')} onClick={() => { select('preference', 'system', 'theme') }}>
        {t('system')}
      </Button></div>
    </div>
    <div className={css.group}>
      <h3>{t('typography')}</h3>
      <div className={css.row}><div className={css.label}><span>{t('textFont')}</span><p>{t('fontHint')}</p></div>
        {input('textFontFamily', t('textFont'), theme?.textFontFamily ?? '', 'theme')}</div>
      <div className={css.row}><div className={css.label}><span>{t('codeFont')}</span></div>
        {input('codeFontFamily', t('codeFont'), theme?.codeFontFamily ?? '', 'theme')}</div>
      <div className={css.row}><div className={css.label}><span>{t('textSize')}</span></div>
        <div className={css.numberControl}>{input('fontSize', t('textSize'), String(theme?.fontSize ?? 14), 'theme', true)}<span>px</span></div></div>
      <div className={css.row}><div className={css.label}><span>{t('codeSize')}</span></div>
        <div className={css.numberControl}>{input('codeFontSize', t('codeSize'), String(theme?.codeFontSize ?? 11), 'theme', true)}<span>px</span></div></div>
    </div>
    <div className={css.group}>
      <h3>{t('layout')}</h3>
      <div className={css.row}><div className={css.label}><span>{t('width')}</span><p>{t('widthHint')}</p></div>
        <div className={css.widthControl}>
        <Choice label={t('width')} value={drafts.conversationWidth ?? own?.conversationWidth ?? 'medium'}
          options={(['narrow', 'medium', 'wide'] as const).map(value => ({ value, label: t(value) }))}
          disabled={!canOwn || pending.has('conversationWidth')} onChange={value => { select('conversationWidth', value, 'own') }} />
        <Button variant="ghost" disabled={!canOwn || pending.has('conversationWidth')} onClick={() => {
          const value = drafts.conversationWidth ?? own?.conversationWidth ?? 'medium'
          edit('conversationWidth', value); void persist('conversationWidth', value, 'own')
        }}>{t('applyWidth')}</Button></div></div>
      <div className={css.row}><div className={css.label}><span>{t('homeMode')}</span><p>{t('homeModeHint')}</p></div>
        <Choice label={t('homeMode')} value={drafts.mode ?? own?.mode ?? 'standard'}
          options={(['standard', 'create'] as const).map(value => ({ value, label: t(value) }))}
          disabled={!canOwn || pending.has('mode')} onChange={value => { select('mode', value, 'own') }} /></div>
      <div className={css.row}><div className={css.label}><span>{t('displayName')}</span><p>{t('displayNameHint')}</p></div>
        {input('displayName', t('displayName'), own?.displayName ?? '', 'own')}</div>
      {preferences.status !== 'ready' && <p className={css.notice} role="status">{t(preferences.status === 'loading' ? 'loading' : 'unavailable')}</p>}
    </div>
    <div className={css.nativeLink}><p>{t('modelHint')}</p><Button variant="outline" onClick={() => {
      void openModels().catch(() => { setErrors(previous => ({ ...previous, navigation: t('navigationFailed') })) })
    }}>{t('openModels')}</Button></div>
    {Object.entries(errors).filter(([, error]) => error !== undefined).map(([field, error]) => <p key={field} role="alert" className={css.error}>{error}</p>)}
    <p className={css.saveStatus} role="status" aria-live="polite">{pending.size > 0 ? t('saving') : saved ? t('saved') : t('automatic')}</p>
  </section>
}

/** Add scoped settings presentation while leaving every native owner mounted. */
export function installSettings(ctx: Context): void {
  const namespace = 'claudeUiSettings'
  ctx.effect(() => ctx.locale.register(namespace, { en, zh }), 'claude-ui: settings dictionaries')
  const t = ctx.locale.bind(namespace)
  const preferences = ctx.configForms.get<Preferences>('claude-ui')
  const appearance = ctx.configForms.get<ThemeSettings>('ui-theme')
  const check = async (operation: Promise<boolean>) => { if (!await operation) throw new Error(t('saveFailed')) }

  // DSH 0.2.2-alpha.2 presentation adapter, verified against the native
  // ui-conversation/skeleton/ConversationWidthControls.tsx owner. Its public
  // slots expose no width setter: an explicit preset writes that owner's
  // existing preference key and CSS parameter, using its 640px floor and
  // 176px edge budget. No listener or CSS lock competes with later native
  // drags, which continue to update the same preference and parameter.
  const applyNativeWidth = (): void => {
    const contents = [...document.querySelectorAll<HTMLElement>('[data-conversation-content]')]
      .filter(content => content.offsetWidth > 0)
    const reference = contents[0]
    if (reference === undefined) throw new Error(t('widthApplyFailed'))
    const preset = Number.parseFloat(getComputedStyle(reference).getPropertyValue('--claude-content-width'))
    if (!Number.isFinite(preset) || preset <= 0) throw new Error(t('widthApplyFailed'))
    // Persist before touching any live layout so a denied browser-storage
    // write cannot leave a transient success that disappears on reload.
    try { localStorage.setItem('dsh.conversation.contentWidth', String(preset)) }
    catch { throw new Error(t('widthApplyFailed')) }
    for (const content of contents) {
      const maximum = Math.max(640, content.offsetWidth - 176)
      const width = Math.min(Math.max(preset, 640), maximum)
      const target = content.parentElement ?? content
      target.style.setProperty('--dsh-chat-user-width', `${width}px`)
    }
  }

  // The public launcher exposes openSettings, not openSection. Locate the native
  // nav button by the live section label and invoke its existing callback.
  // No owner store, node or callback is replaced; each observation is bounded.
  const pendingNavigation = new Set<() => void>()
  const navigate = (id: string, open: () => void): Promise<void> => {
    open()
    const entry = ctx.slots.entries('settings.section').find(candidate => candidate.options.id === id)
    const label = typeof entry?.options.label === 'function' ? entry.options.label() : entry?.options.label
    if (!label) return Promise.reject(new Error(t('navigationFailed')))
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (success: boolean) => {
        if (settled) return
        settled = true; observer.disconnect(); window.clearTimeout(timeout); pendingNavigation.delete(cancel)
        if (success) resolve(); else reject(new Error(t('navigationFailed')))
      }
      const seek = () => {
        const panel = document.querySelector('[data-shortcut-modal="settings"]')
        const matches = [...panel?.querySelectorAll<HTMLButtonElement>('nav button') ?? []]
          .filter(candidate => candidate.textContent?.trim() === label.trim())
        // Duplicate translated labels do not identify one owner safely.
        if (matches.length !== 1) return
        matches[0]!.click(); finish(true)
      }
      const cancel = () => { finish(false) }
      const observer = new MutationObserver(seek)
      const timeout = window.setTimeout(cancel, 1500)
      pendingNavigation.add(cancel)
      observer.observe(document.body, { childList: true, subtree: true })
      seek()
    })
  }
  ctx.effect(() => () => { for (const cancel of [...pendingNavigation]) cancel() }, 'claude-ui: native settings navigation')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'claude-appearance', order: 5,
    label: () => t('appearance'), locale: namespace,
    inject: (): AppearanceInjected => ({
      hooks: { preferences, appearance },
      savePreference: async (field, value) => {
        await check(preferences.set(field, value))
        if (field === 'conversationWidth') applyNativeWidth()
      },
      saveAppearance: (field, value) => check(appearance.set(field, value)),
      openModels: () => navigate('models', () => {}),
    }),
  }, Appearance))
}
