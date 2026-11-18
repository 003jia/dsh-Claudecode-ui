/** Console diagnostics for native DOM and copy contracts this presentation layer extends. @module */
const PREFIX = '[claude-ui]'
const missing = new Set<string>()

/**
 * Record one native-contract observation. A missing contract logs once per name
 * so an upstream DOM or translated-copy change is visible without spamming on
 * every mutation batch. Successful observations leave an earlier report intact:
 * this is a startup compatibility signal, not a live health check.
 * @param name - stable contract name.
 * @param ok - whether the expected native anchor or shape was found.
 * @param detail - optional selector or label that failed.
 */
export function reportContract(name: string, ok: boolean, detail?: string): void {
  if (ok || missing.has(name)) return
  missing.add(name)
  console.warn(`${PREFIX} native contract missing: ${name}${detail === undefined ? '' : ` (${detail})`}`)
}

/** @returns the native contract names reported missing in this page lifetime. */
export function missingContracts(): readonly string[] {
  return [...missing]
}
