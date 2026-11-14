import type { AppInfo } from '@shared/types'

let info: AppInfo = { version: '0.0.0', platform: 'darwin', isDev: false }

/** Set once at startup from `window.api.app.getInfo()` (see lib/bootstrap.ts). */
export function setAppInfo(next: AppInfo): void {
  info = next
  document.documentElement.dataset.platform = next.platform
}

export function appInfo(): AppInfo {
  return info
}

export const isMac = (): boolean => info.platform === 'darwin'

/** Label for the platform's primary modifier: ⌘ on macOS, Ctrl elsewhere. */
export const modKeyLabel = (): string => (isMac() ? '⌘' : 'Ctrl+')

/** True when the platform's primary modifier (Cmd on macOS, Ctrl elsewhere) is held. */
export function isModKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
}
