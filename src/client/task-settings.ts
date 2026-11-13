import css from './task-settings.module.css'

/** Hide the redundant home preset trigger; the sidebar owns mode selection. */
export function hideHomeTaskSettings(): () => void {
  const anchors = new Map<HTMLButtonElement, HTMLElement>()
  const update = (): void => {
    for (const [button, anchor] of anchors) {
      if (!button.isConnected || button.parentElement !== anchor) {
        anchor.classList.remove(css.hiddenAnchor)
        anchors.delete(button)
      }
    }
    for (const seat of document.querySelectorAll('[data-slot="conversation.hero.agentPreset"]')) {
      const button = seat.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
      if (button === null || anchors.has(button)) continue
      const anchor = button.parentElement
      // Match the native chip only. Keep its slot mounted so roster loading
      // and refusal feedback survive; other slot occupants remain untouched.
      if (anchor === null || anchor === seat || anchor.tagName !== 'SPAN'
        || button.querySelectorAll(':scope > svg').length !== 2
        || !Array.from(button.children).some(child => child.tagName === 'SPAN')) continue
      anchor.classList.add(css.hiddenAnchor)
      anchors.set(button, anchor)
    }
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const anchor of anchors.values()) anchor.classList.remove(css.hiddenAnchor)
    anchors.clear()
  }
}
