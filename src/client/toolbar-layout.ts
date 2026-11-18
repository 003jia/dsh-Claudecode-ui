/** Anchor native statistics to the tools, keeping the middle of the bar free. */
export function installToolbarAlignment(doc: Document): () => void {
  const win = doc.defaultView
  if (win === null) return () => {}
  const marker = 'data-claude-toolbar-aligned'
  const properties = ['--claude-tools-end', '--claude-toolbar-left', '--claude-toolbar-top',
    '--claude-toolbar-width', '--claude-toolbar-height'] as const
  const entries = new Map<HTMLElement, {
    dock: HTMLElement; watched: HTMLElement[]; previous: string | null
    styles: { value: string; priority: string }[]
  }>()
  let scheduled: number | undefined
  const restore = (card: HTMLElement): void => {
    const entry = entries.get(card)!
    if (entry.previous === null) card.removeAttribute(marker)
    else card.setAttribute(marker, entry.previous)
    properties.forEach((name, i) => {
      const original = entry.styles[i]!
      if (original.value === '') entry.dock.style.removeProperty(name)
      else entry.dock.style.setProperty(name, original.value, original.priority)
    })
    entry.watched.forEach(node => resize.unobserve(node))
    entries.delete(card)
  }
  const scan = (): void => {
    scheduled = undefined
    const cards = new Set(doc.querySelectorAll<HTMLElement>('[data-content-phase="active"] [data-composer-card]'))
    for (const card of entries.keys()) if (!cards.has(card)) restore(card)
    for (const card of cards) {
      const parent = card.parentElement
      const dock = parent?.querySelector<HTMLElement>(':scope > [data-composer-dock]')
      const row = card.querySelector<HTMLElement>(':scope > [data-input-scroll] + div')
      const tools = row?.firstElementChild
      const trailing = row?.lastElementChild
      if (!parent || !dock || !row || !(tools instanceof win.HTMLElement) || !(trailing instanceof win.HTMLElement)) {
        if (entries.has(card)) restore(card)
        continue
      }
      let entry = entries.get(card)
      if (entry && (entry.dock !== dock || entry.watched[1] !== row
        || entry.watched[2] !== tools || entry.watched[3] !== trailing)) {
        restore(card); entry = undefined
      }
      if (!entry) {
        entry = { dock, watched: [card, row, tools, trailing, parent], previous: card.getAttribute(marker),
          styles: properties.map(name => ({ value: dock.style.getPropertyValue(name), priority: dock.style.getPropertyPriority(name) })) }
        entries.set(card, entry)
        entry.watched.forEach(node => resize.observe(node))
      }
      const toolBox = tools.getBoundingClientRect()
      const trailingBox = trailing.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      const cardBox = card.getBoundingClientRect()
      const model = trailing.querySelector('[data-slot="conversation.input.model"] button')
      const modelBox = model?.getBoundingClientRect()
      const slot = dock.querySelector(':scope > [data-slot="conversation.composer.dock"]')
      const participants = [...dock.children].flatMap(child => child === slot ? [...child.children] : [child])
        .filter(child => child.getClientRects().length > 0)
      const statCount = participants.filter(child => child.hasAttribute('data-composer-stat')).length
      const hasExtraControl = participants.some(child => !child.matches(
        '[data-composer-stat], [data-dsh-claude-context-meter]'))
      const hasContext = participants.some(child => child.hasAttribute('data-dsh-claude-context-meter'))
      // Each stat needs a 28px hit target, with 12px before the first,
      // 4px between the pair, and 8px before the trailing controls.
      const statsWidth = statCount > 0 ? 16 + 32 * statCount : 0
      const merged = card.hasAttribute('data-claude-composer-v2') && hasContext && !hasExtraControl
        && rowBox.height <= 48 && trailingBox.left - toolBox.right >= statsWidth - 0.5
        // The 28px context circle is inset 8px from the right edge.
        && modelBox !== undefined && modelBox.width > 0 && cardBox.right - modelBox.right >= 40
        && Math.abs(toolBox.top + toolBox.height / 2 - trailingBox.top - trailingBox.height / 2) <= 1
      if (merged) {
        // The dock is a sibling of the card. Match its actual left edge so the
        // asymmetric gutter beside the collapsed account avatar stays clear.
        const parentBox = parent.getBoundingClientRect()
        dock.style.setProperty('--claude-tools-end', `${toolBox.right - cardBox.left}px`)
        dock.style.setProperty('--claude-toolbar-left', `${cardBox.left - parentBox.left - parent.clientLeft}px`)
        dock.style.setProperty('--claude-toolbar-top', `${rowBox.top - parentBox.top - parent.clientTop}px`)
        dock.style.setProperty('--claude-toolbar-width', `${cardBox.width}px`)
        dock.style.setProperty('--claude-toolbar-height', `${rowBox.height}px`)
      }
      card.toggleAttribute(marker, merged)
    }
  }
  const schedule = (): void => {
    if (scheduled === undefined) scheduled = win.requestAnimationFrame(scan)
  }
  const resize = new win.ResizeObserver(schedule)
  const mutation = new win.MutationObserver(schedule)
  mutation.observe(doc.body, { childList: true, characterData: true, subtree: true,
    attributes: true, attributeFilter: ['hidden', 'data-content-phase', 'data-claude-composer-v2'] })
  win.addEventListener('resize', schedule)
  scan()
  return () => {
    mutation.disconnect(); resize.disconnect()
    win.removeEventListener('resize', schedule)
    if (scheduled !== undefined) win.cancelAnimationFrame(scheduled)
    for (const card of entries.keys()) restore(card)
  }
}
