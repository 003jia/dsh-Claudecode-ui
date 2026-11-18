import css from './task-settings.module.css'

/** An owned portal beside the native preset anchor, leaving its seat mounted. */
export interface HomeModeMount { id: number; node: HTMLDivElement }

/** Decorate only inspected native anchors; an empty portal keeps the native cold-start picker visible. */
export function mountHomeModes(onChange: (mounts: HomeModeMount[]) => void): () => void {
  let sequence = 0
  const anchors = new Map<HTMLButtonElement, HomeModeMount & { anchor: HTMLElement }>()
  const update = (): void => {
    let changed = false
    for (const [button, { anchor, node }] of anchors) {
      if (!button.isConnected || button.parentElement !== anchor) {
        anchor.classList.remove(css.nativeAnchor)
        node.remove()
        anchors.delete(button)
        changed = true
      }
    }
    for (const seat of document.querySelectorAll('[data-slot="conversation.hero.agentPreset"]')) {
      const button = seat.querySelector<HTMLButtonElement>(':scope > span > button[aria-haspopup="menu"]')
      if (button === null || anchors.has(button)) continue
      const anchor = button.parentElement
      // Match the native chip only. Keep its slot mounted so roster loading
      // and refusal feedback survive; other slot occupants remain untouched.
      if (anchor === null || anchor === seat || anchor.tagName !== 'SPAN'
        || button.querySelectorAll(':scope > svg').length !== 2
        || !Array.from(button.children).some(child => child.tagName === 'SPAN')) continue
      const node = document.createElement('div')
      node.className = css.homeMount
      node.setAttribute('data-dsh-claude-home-modes', '')
      anchor.insertAdjacentElement('afterend', node)
      anchor.classList.add(css.nativeAnchor)
      anchors.set(button, { id: ++sequence, node, anchor })
      changed = true
    }
    if (changed) onChange(Array.from(anchors.values(), ({ id, node }) => ({ id, node })))
  }
  update()
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const { anchor, node } of anchors.values()) {
      anchor.classList.remove(css.nativeAnchor)
      node.remove()
    }
    anchors.clear()
  }
}
