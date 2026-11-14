// Tells the user when a global shortcut could not be registered (taken by another app, or
// invalid): one non-blocking toast when the main window is on screen, with "Change…" opening
// Settings → Shortcuts. Once per app run per failing shortcut + combo; never for a shortcut
// that is turned off; re-evaluated whenever the shortcut status changes.
import { useEffect } from 'react'
import { toast } from 'sonner'
import type { ShortcutStatus } from '@shared/types'
import { api } from '@/lib/api'
import {
  failureKey,
  failureMessage,
  failuresToAnnounce,
  loadAnnounced,
  saveAnnounced,
} from '@/lib/shortcutFailures'
import { formatShortcut } from '@/lib/shortcuts'
import { useUiStore } from '@/stores/uiStore'

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

export function useShortcutFailureToast(): void {
  useEffect(() => {
    let status: ShortcutStatus | null = null
    let alive = true

    const evaluate = (): void => {
      if (!status || document.visibilityState !== 'visible') return
      const storage = sessionStore()
      const announced = loadAnnounced(storage)
      const failures = failuresToAnnounce(status, announced)
      if (failures.length === 0) return
      for (const f of failures) announced.add(failureKey(f))
      saveAnnounced(storage, announced)
      const ui = useUiStore.getState()
      // Settings → Shortcuts already shows the problem inline right where it is being fixed.
      if (ui.settingsOpen && ui.settingsSection === 'shortcuts') return
      const { title, description } = failureMessage(failures, formatShortcut)
      toast.warning(title, {
        id: 'shortcut-failure',
        description,
        duration: 15_000,
        action: {
          label: 'Change…',
          onClick: () => useUiStore.getState().setSettingsOpen(true, 'shortcuts'),
        },
      })
    }
    const update = (next: ShortcutStatus): void => {
      status = next
      evaluate()
    }

    void api()
      .app.getShortcutStatus()
      .then((s) => alive && update(s))
    const off = api().on.shortcutStatusChanged(update)
    document.addEventListener('visibilitychange', evaluate)
    window.addEventListener('focus', evaluate)
    return () => {
      alive = false
      off()
      document.removeEventListener('visibilitychange', evaluate)
      window.removeEventListener('focus', evaluate)
    }
  }, [])
}
