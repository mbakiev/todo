// STUB — owned by the desktop-shell feature.
// Spec §9: "Launch at login" toggle, packaged builds only (app.setLoginItemSettings works on
// macOS and Windows; no-op when !app.isPackaged).
import type { AppContext } from '../context'

/** Called at startup and whenever `settings.launchAtLogin` changes. */
export function applyLaunchAtLogin(_ctx: AppContext, _enabled: boolean): void {}
