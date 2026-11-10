import css from './task-settings.module.css'

interface TaskSettingsCopy {
  trigger: string
  accessibleName: (currentAssistant: string) => string
}

/** Present the native preset selector as Task settings without replacing its owner. */
export function installTaskSettings(
  copy: () => TaskSettingsCopy,
  subscribeLocale: (update: () => void) => () => void,
): () => void {
  interface Entry {
    content: HTMLSpanElement
    label: HTMLSpanElement
    nativeLabel: HTMLElement
    anchor: HTMLElement
    originalAriaLabel: string | null
    lastAriaLabel: string
  }
  const entries = new Map<HTMLButtonElement, Entry>()
  const restore = (button: HTMLButtonElement, entry: Entry): void => {
    entry.content.remove()
    button.classList.remove(css.trigger)
    button.removeAttribute('data-dsh-claude-task-settings')
    entry.anchor.classList.remove(css.anchor)
    if (button.getAttribute('aria-label') === entry.lastAriaLabel) {
      if (entry.originalAriaLabel === null) button.removeAttribute('aria-label')
      else button.setAttribute('aria-label', entry.originalAriaLabel)
    }
  }
  const text = (element: HTMLElement, value: string): void => {
    if (element.textContent !== value) element.textContent = value
  }
  const update = (): void => {
    for (const [button, entry] of entries) {
      if (!button.isConnected || !button.contains(entry.nativeLabel)) {
        restore(button, entry)
        entries.delete(button)
      }
    }
    for (const seat of document.querySelectorAll('[data-slot="conversation.hero.agentPreset"]')) {
      const button = seat.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
      if (button === null) continue
      let entry = entries.get(button)
      if (entry === undefined) {
        const nativeLabel = Array.from(button.children).find(child => child instanceof HTMLElement
          && child.tagName === 'SPAN' && child.textContent !== '')
        const anchor = button.parentElement
        // Adapt the inspected native chip only; a different slot occupant remains untouched.
        if (!(nativeLabel instanceof HTMLElement) || anchor === null
          || button.querySelectorAll(':scope > svg').length !== 2) continue
        const content = document.createElement('span')
        content.className = css.content
        content.setAttribute('data-dsh-claude-task-content', '')
        content.setAttribute('aria-hidden', 'true')
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        for (const [key, value] of Object.entries({
          width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'aria-hidden': 'true', focusable: 'false',
        })) icon.setAttribute(key, value)
        for (const d of ['M4 6h3m4 0h9M4 12h9m4 0h3M4 18h3m4 0h9', 'M7 3h4v6H7zM13 9h4v6h-4zM7 15h4v6H7z']) {
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          path.setAttribute('d', d)
          icon.append(path)
        }
        const label = document.createElement('span')
        content.append(icon, label)
        button.append(content)
        button.classList.add(css.trigger)
        button.setAttribute('data-dsh-claude-task-settings', '')
        anchor.classList.add(css.anchor)
        entry = { content, label, nativeLabel, anchor,
          originalAriaLabel: button.getAttribute('aria-label'), lastAriaLabel: '' }
        entries.set(button, entry)
      }
      const labels = copy()
      text(entry.label, labels.trigger)
      entry.lastAriaLabel = labels.accessibleName(entry.nativeLabel.textContent?.trim() ?? '')
      if (button.getAttribute('aria-label') !== entry.lastAriaLabel) button.setAttribute('aria-label', entry.lastAriaLabel)
      // Native disabled/expanded/title, event handlers, focus target and menu anchor stay intact.
    }
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  const unsubscribe = subscribeLocale(update)
  return () => {
    observer.disconnect()
    unsubscribe()
    for (const [button, entry] of entries) restore(button, entry)
    entries.clear()
  }
}
