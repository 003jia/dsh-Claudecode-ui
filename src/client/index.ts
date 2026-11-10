/** Browser assembly: retain native owners and add scoped presentation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installVisual } from './visual.ts'
import { installShell } from './shell.tsx'
import { installSettings } from './settings.tsx'
import { installNavigation } from './navigation.tsx'
import { installAccountMenu } from './account-menu.tsx'
import { installContextWindow } from './context-window.tsx'
import { installTaskRuntime } from './task-runtime.tsx'

/** Native UI owners remain active alongside this plugin. */
export const inject = ['slots', 'configForms', 'theme', 'locale', 'layout', 'uiWorkspace', 'connection', 'sessions', 'remote', 'remote.agentPresets', 'uiSession']

/** Install the Claude design over the native DSH interface.
 * @param ctx - Browser context exposing the native owners.
 */
export function apply(ctx: Context): void {
  installVisual(ctx)
  installAccountMenu(ctx)
  installShell(ctx)
  installSettings(ctx)
  installNavigation(ctx)
  installContextWindow(ctx)
  installTaskRuntime(ctx)
}
