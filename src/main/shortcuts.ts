// STUB — owned by the desktop-shell feature.
// Spec §9: global shortcuts (toggle main window, quick add) from settings.shortcuts.
// Registration failures must be surfaced: keep `status` current and call
// `ctx.broadcastShortcutStatus(status)` after (re)registering.
import type { Settings, ShortcutStatus } from '@shared/types'
import type { AppContext } from './context'

let status: ShortcutStatus = {
  toggleApp: { accelerator: '', registered: false, error: 'Not implemented' },
  quickAdd: { accelerator: '', registered: false, error: 'Not implemented' },
}

/** Called at startup and whenever `settings.shortcuts` changes. */
export function registerGlobalShortcuts(
  _ctx: AppContext,
  shortcuts: Settings['shortcuts'],
): ShortcutStatus {
  status = {
    toggleApp: { accelerator: shortcuts.toggleApp, registered: false, error: 'Not implemented' },
    quickAdd: { accelerator: shortcuts.quickAdd, registered: false, error: 'Not implemented' },
  }
  return status
}

export function getShortcutStatus(): ShortcutStatus {
  return status
}

/** Called on will-quit. */
export function unregisterGlobalShortcuts(): void {}
