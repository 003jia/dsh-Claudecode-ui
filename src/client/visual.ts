import type { Context } from '@deepseek-ai/cordis'
import designCss from './design.css?inline'
import replyV2Css from './reply-v2.css?inline'
import terminalV2Css from './terminal-v2.css?inline'
import composerV2Css from './composer-v2.css?inline'

const ROOT_ATTRIBUTE = 'data-dsh-claude-ui'

/** Install the opt-in palette without replacing any native UI or service. */
export function installVisual(ctx: Context): void {
  ctx.effect(() => {
    const root = document.documentElement
    const previousAttribute = root.getAttribute(ROOT_ATTRIBUTE)
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-claude-ui'
    style.dataset.pluginCss = 'dsh-claude-ui/design.css'
    style.textContent = `${designCss}\n${replyV2Css}\n${terminalV2Css}\n${composerV2Css}`
    document.head.append(style)
    root.setAttribute(ROOT_ATTRIBUTE, '')

    return () => {
      style.remove()
      if (previousAttribute === null) root.removeAttribute(ROOT_ATTRIBUTE)
      else root.setAttribute(ROOT_ATTRIBUTE, previousAttribute)
    }
  }, 'dsh-claude-ui: visual theme')
}
