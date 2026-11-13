/** Open a visible native running Bash disclosure once, without owning its state. */
import type { Context } from '@deepseek-ai/cordis'

/**
 * Adapt only the verified BashRow toggle in DSH 0.2.2-alpha.2. The native
 * click handler changes local disclosure state; this adapter never obtains
 * a tool, approval, stop, or group action. User changes remain authoritative.
 * @param doc - Document containing native conversation occurrences.
 * @returns Disconnect observers/listeners; already opened native state remains.
 */
export function installRunningTerminalDisclosure(doc: Document): () => void {
  const win = doc.defaultView
  if (win === null || typeof win.IntersectionObserver !== 'function') return () => {}
  const handled = new Set<string>()
  const observed = new Map<HTMLElement, boolean>()
  let scheduled: number | undefined
  let disposed = false

  const identity = (row: HTMLElement): string | undefined => {
    if (row.tagName !== 'DIV' || !row.matches('[data-sample="bash"][data-variant="bash"][role="button"][tabindex="0"][data-expandable="true"]')) return undefined
    const card = row.parentElement
    if (card === null || card.firstElementChild !== row
      || !Array.from(card.classList).some(name => name.endsWith('_card'))
      || !Array.from(row.classList).some(name => name.endsWith('_root'))
      || row.querySelector(':scope > span[class$="_leading"] svg') === null
      || row.querySelector(':scope > span[data-shimmer]') === null
      || row.querySelector('button, input, a, [role="button"]') !== null) return undefined
    const slot = card.closest('[data-slot="tool.call.toolview"]')
    const call = row.closest('[data-chat-call-id]')
    const flow = row.closest('[data-chat-flow-kind="tool-call"][data-chat-flow-key]')
    const session = row.closest('[data-conversation-session]')
    const sessionId = session?.getAttribute('data-conversation-session')
    const callId = call?.getAttribute('data-chat-call-id')
    const flowKey = flow?.getAttribute('data-chat-flow-key')
    if (slot === null || call === null || flow === null || session === null
      || !sessionId || !callId || !flowKey || !call.contains(slot) || !flow.contains(call)) return undefined
    return JSON.stringify([sessionId, flowKey, callId])
  }
  const visible = (row: HTMLElement): boolean => {
    if (!row.isConnected || doc.hidden || row.getClientRects().length === 0
      || row.closest('[hidden], [inert], [aria-hidden="true"]') !== null) return false
    if (typeof row.checkVisibility === 'function'
      && !row.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
    const style = win.getComputedStyle(row)
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse'
  }
  const consider = (row: HTMLElement): void => {
    if (disposed || !observed.get(row) || row.dataset.state !== 'running' || !visible(row)) return
    const key = identity(row)
    if (key === undefined || handled.has(key)) return
    const expanded = row.getAttribute('aria-expanded')
    if (expanded !== 'true' && expanded !== 'false') return
    // Record before dispatch: React and the mutation observer may publish
    // synchronously. Also remember an already-open row before the user closes it.
    handled.add(key)
    if (expanded === 'false') row.click()
  }
  const intersection = new win.IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!(entry.target instanceof win.HTMLElement) || !observed.has(entry.target)) continue
      observed.set(entry.target, entry.isIntersecting
        && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0)
      consider(entry.target)
    }
  })
  const scan = (): void => {
    scheduled = undefined
    if (disposed) return
    const current = new Set(doc.querySelectorAll<HTMLElement>('[data-conversation-session] [data-sample="bash"]'))
    for (const row of observed.keys()) {
      if (current.has(row) && identity(row) !== undefined) continue
      intersection.unobserve(row)
      observed.delete(row)
    }
    for (const row of current) {
      if (identity(row) === undefined) continue
      if (!observed.has(row)) {
        observed.set(row, false)
        intersection.observe(row)
      }
      consider(row)
    }
  }
  const schedule = (): void => {
    if (!disposed && scheduled === undefined) scheduled = win.requestAnimationFrame(scan)
  }
  const respectInteraction = (event: Event): void => {
    if (event instanceof win.KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return
    if (!(event.target instanceof win.Element)) return
    const row = event.target.closest<HTMLElement>('[data-sample="bash"]')
    if (row === null) return
    const key = identity(row)
    if (key !== undefined) handled.add(key)
  }
  const mutation = new win.MutationObserver(schedule)
  mutation.observe(doc.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-state', 'data-expandable', 'aria-expanded', 'hidden', 'inert',
      'aria-hidden', 'class', 'style', 'data-conversation-session', 'data-chat-call-id', 'data-chat-flow-key'],
  })
  doc.addEventListener('click', respectInteraction, true)
  doc.addEventListener('keydown', respectInteraction, true)
  doc.addEventListener('visibilitychange', schedule)
  scan()
  return () => {
    disposed = true
    mutation.disconnect()
    intersection.disconnect()
    if (scheduled !== undefined) win.cancelAnimationFrame(scheduled)
    doc.removeEventListener('click', respectInteraction, true)
    doc.removeEventListener('keydown', respectInteraction, true)
    doc.removeEventListener('visibilitychange', schedule)
    observed.clear()
    handled.clear()
  }
}

/** Install the presentation adapter under the plugin lifecycle. */
export function installTerminalDisclosure(ctx: Context): void {
  ctx.effect(() => installRunningTerminalDisclosure(document), 'claude-ui: visible running terminal disclosure')
}
