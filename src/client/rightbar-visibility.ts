/** Session entry starts collapsed; explicit navigation keeps the native owner. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The public native operations needed to settle a restored Session surface. */
interface RightbarEntryFace {
  readonly mounted: {
    getSnapshot(): SessionId | undefined
    subscribe(listener: () => void): () => void
  }
  commandTarget(element: Element | null): { readonly sessionId: SessionId } | undefined
  isExpanded(): boolean
  toggleExpanded(): void
}

/**
 * Consume each foreground entry once, after its native store has been adopted.
 * This changes only expansion: saved tabs, widths, resources and history remain
 * with DSH. It never wraps or blocks openTab/openResource and never closes a
 * subsequent user navigation in the same foreground visit.
 */
export function observeRightbarEntry(right: RightbarEntryFace): { check: () => void; dispose: () => void } {
  let current = right.mounted.getSnapshot()
  let pending = current
  let disposed = false
  const check = (): void => {
    if (disposed || pending === undefined || right.mounted.getSnapshot() !== pending) return
    // mounted changes before React mints/adopts the arriving Session's store.
    // commandTarget is the owner's public readiness read, including empty tabs.
    if (right.commandTarget(null)?.sessionId !== pending) return
    pending = undefined
    if (right.isExpanded()) right.toggleExpanded()
  }
  const unsubscribe = right.mounted.subscribe(() => {
    const next = right.mounted.getSnapshot()
    if (next === current) return
    current = next
    pending = next
    check()
  })
  check()
  return {
    check,
    dispose: () => { disposed = true; pending = undefined; unsubscribe() },
  }
}

/** Restore visibility through the native sidebar controller on Session entry. */
export function installRightbarVisibility(ctx: Context): void {
  ctx.inject(['sidebarRight'], scope => {
    scope.effect(() => {
      // The layout face exposes its bound action set at runtime; the panel's
      // first-open preference is otherwise 45% of the frame. Start at the
      // contract minimum instead. The call is optional so a changed internal
      // face degrades to the native default rather than failing the plugin.
      const layout = scope.get('layout') as unknown as { panels?: { setRightbar?: (px: number) => void } } | undefined
      try {
        layout?.panels?.setRightbar?.(300)
      } catch (error) {
        if (!(error instanceof TypeError)) throw error
      }
      const policy = observeRightbarEntry(scope.sidebarRight)
      // A restored Session may reopen the panel after the entry check, or the
      // panel may already be open at boot. Collapse it directly until the first
      // real user gesture, then leave every later toggle to the native owner.
      let userActed = false
      const markUser = (): void => { userActed = true }
      const settle = (): void => {
        if (userActed) return
        if (scope.sidebarRight.isExpanded()) scope.sidebarRight.toggleExpanded()
      }
      settle()
      const interval = window.setInterval(settle, 300)
      const deadline = window.setTimeout(() => { window.clearInterval(interval) }, 3000)
      window.addEventListener('pointerdown', markUser, true)
      window.addEventListener('keydown', markUser, true)
      // The native mounted source deliberately does not notify store adoption.
      // DOM commits only wake this readiness check; no node is clicked, hidden,
      // moved or replaced. Once settled the callback is an inexpensive no-op.
      const observer = new MutationObserver(policy.check)
      observer.observe(document.body, { childList: true, subtree: true })
      // Finish a late restore before an actual pointer/keyboard entry runs.
      // The following native handler may then open any tab without interference.
      document.addEventListener('pointerdown', policy.check, true)
      document.addEventListener('click', policy.check, true)
      document.addEventListener('keydown', policy.check, true)
      return () => {
        window.clearInterval(interval)
        window.clearTimeout(deadline)
        window.removeEventListener('pointerdown', markUser, true)
        window.removeEventListener('keydown', markUser, true)
        observer.disconnect()
        document.removeEventListener('pointerdown', policy.check, true)
        document.removeEventListener('click', policy.check, true)
        document.removeEventListener('keydown', policy.check, true)
        policy.dispose()
      }
    }, 'claude-ui: collapse restored rightbar on Session entry')
  })
}
