// Who suspended the global shortcuts (the Settings recorder, while it listens for a new
// combo), so main can resume them when that page goes away without saying so: its
// webContents is destroyed, its renderer crashes, or it reloads / navigates. Electron-free
// (structural types), so it is unit-tested with a plain EventEmitter.

/** The part of Electron's WebContents this needs. */
export interface SuspenderContents {
  on(event: string, listener: (...args: never[]) => void): unknown
  removeListener(event: string, listener: (...args: never[]) => void): unknown
}

interface NavigationDetails {
  isMainFrame?: boolean
  isSameDocument?: boolean
}

export interface SuspensionGuard {
  /** `contents` suspended the shortcuts: resume them if it goes away without resuming. */
  suspendedBy(contents: SuspenderContents): void
  /** Shortcuts were resumed normally: stop watching. */
  resumed(): void
}

export function createSuspensionGuard(release: () => void): SuspensionGuard {
  let detach: (() => void) | null = null

  const stop = (): void => {
    detach?.()
    detach = null
  }

  return {
    suspendedBy(contents) {
      stop()
      const gone = (): void => {
        stop()
        release()
      }
      const navigated = (details: NavigationDetails): void => {
        // A reload or a new page (not an in-page hash change, not a subframe).
        if (details?.isMainFrame !== false && details?.isSameDocument !== true) gone()
      }
      contents.on('destroyed', gone)
      contents.on('render-process-gone', gone)
      contents.on('did-start-navigation', navigated)
      detach = () => {
        contents.removeListener('destroyed', gone)
        contents.removeListener('render-process-gone', gone)
        contents.removeListener('did-start-navigation', navigated)
      }
    },
    resumed: stop,
  }
}
