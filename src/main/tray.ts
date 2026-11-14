// STUB — owned by the desktop-shell feature.
// Spec §9: tray icon + menu (Open, New Task, Settings, Quit). Left-click toggles the main
// window on Windows; opens the menu on macOS. macOS uses a template image (resources/).
import type { AppContext } from './context'

export function createTray(_ctx: AppContext): void {}

export function destroyTray(): void {}
