import type { BrowserWindow } from 'electron'
import type { DataChange, Settings, ShortcutStatus } from '@shared/types'
import type { Repos } from './db'
import type { AppPaths } from './paths'

/** Shared state passed to IPC handlers, windows and services. */
export interface AppContext {
  repos: Repos
  paths: AppPaths
  isDev: boolean
  /** Set when the user really quits (vs. closing/hiding a window). */
  quitting: boolean
  getMainWindow(): BrowserWindow | null
  getQuickAddWindow(): BrowserWindow | null
  /** Sends `dataChanged` to every window. */
  broadcastDataChanged(change: DataChange): void
  /** Sends `settingsChanged` to every window and applies main-process side effects. */
  broadcastSettingsChanged(settings: Settings): void
  broadcastShortcutStatus(status: ShortcutStatus): void
}
