/** Reversible presentation markers for the native, fully mounted composer. */
import type { Context } from '@deepseek-ai/cordis'

const MARKER = 'data-claude-composer-v2'

/**
 * Mark only the native compactable shape; attachments and activity retain the
 * owner's layout. Measuring the actual card is necessary because side panes
 * can leave a narrow composer inside a wide desktop window.
 * @param doc - Browser document containing the native conversation.
 * @returns Remove markers and all layout observers.
 */
export function installComposerLayout(doc: Document): () => void {
  const win = doc.defaultView
  if (win === null) return () => {}
  const originals = new Map<HTMLElement, string | null>()
  let scheduled: number | undefined

  const restore = (card: HTMLElement): void => {
    const previous = originals.get(card)
    if (previous == null) card.removeAttribute(MARKER)
    else card.setAttribute(MARKER, previous)
  }
  const canCompact = (card: HTMLElement): boolean => {
    if (card.getBoundingClientRect().width < 600) return false
    const scroll = card.querySelector(':scope > [data-input-scroll]')
    if (!(scroll instanceof win.HTMLElement) || scroll.querySelector('[data-composer-input]') === null) return false
    const row = scroll.nextElementSibling
    if (!(row instanceof win.HTMLElement) || row.tagName !== 'DIV' || row.children.length !== 2) return false
    const [tools, trailing] = Array.from(row.children)
    if (!(tools instanceof win.HTMLElement) || !(trailing instanceof win.HTMLElement)
      || tools.hidden || tools.tagName !== 'DIV' || trailing.tagName !== 'DIV') return false
    if (tools.querySelector(':scope > button[aria-haspopup="listbox"]') === null
      || tools.querySelector(':scope > input[type="file"][multiple][hidden]') === null) return false
    const controls = trailing.firstElementChild
    if (!(controls instanceof win.HTMLElement) || controls.tagName !== 'DIV' || controls.hidden) return false
    // A running draft can expose both Send and Stop. Keep both in the native row.
    if (trailing.querySelectorAll(':scope > button').length !== 1) return false
    return Array.from(card.children).every(child => {
      if (child === scroll || child === row || child.hasAttribute('data-composer-overlay')) return true
      if (child.getAttribute('data-slot') !== 'conversation.input.attachments') return false
      // Includes previews, upload failures, drop overlays, and custom occupants.
      return child.children.length === 0 && child.textContent?.trim() === ''
    })
  }
  const scan = (): void => {
    scheduled = undefined
    const cards = new Set(doc.querySelectorAll<HTMLElement>('[data-content-phase="active"] [data-composer-card]'))
    for (const card of originals.keys()) {
      if (cards.has(card)) continue
      resize.unobserve(card)
      restore(card)
      originals.delete(card)
    }
    for (const card of cards) {
      if (!originals.has(card)) {
        originals.set(card, card.getAttribute(MARKER))
        resize.observe(card)
      }
      card.toggleAttribute(MARKER, canCompact(card))
    }
  }
  const schedule = (): void => {
    if (scheduled === undefined) scheduled = win.requestAnimationFrame(scan)
  }
  const resize = new win.ResizeObserver(schedule)
  const mutation = new win.MutationObserver(schedule)
  mutation.observe(doc.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['hidden', 'data-content-phase'],
  })
  win.addEventListener('resize', schedule)
  scan()
  return () => {
    mutation.disconnect()
    resize.disconnect()
    win.removeEventListener('resize', schedule)
    if (scheduled !== undefined) win.cancelAnimationFrame(scheduled)
    for (const card of originals.keys()) restore(card)
    originals.clear()
  }
}

/** Add layout markers without replacing the native editor or any input slots. */
export function installComposerV2(ctx: Context): void {
  ctx.effect(() => installComposerLayout(document), 'claude-ui: native composer presentation')
}
