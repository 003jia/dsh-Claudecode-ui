/** Host-owned presentation preferences; existing DSH services own all business data. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import schema from '@deepseek-ai/schemastery'

/** Stable entry id used by the native configuration projection. */
export const name = 'claude-ui'
/** Native settings own persistence and validation. */
export const inject = ['settings']

/** Preferences change presentation only, never model or execution policy. */
export interface Config {
  mode: Volatile<'standard' | 'create'>
  displayName: Volatile<string>
  conversationWidth: Volatile<'narrow' | 'medium' | 'wide'>
}

/** Live, validated preferences exposed through configForms('claude-ui'). */
export const Config = schema.object({
  mode: schema.union(['standard', 'create']).default('standard').volatile(),
  displayName: schema.string().default('').volatile(),
  conversationWidth: schema.union(['narrow', 'medium', 'wide']).default('medium').volatile(),
})

/** Install custom presentation of this entry's native preferences.
 * @param ctx - Host plugin context with the settings owner.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.settings.configure({ auto: false }, ctx.fiber), 'claude-ui: settings presentation')
}
