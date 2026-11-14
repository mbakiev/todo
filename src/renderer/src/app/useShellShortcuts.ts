// In-app keyboard shortcuts handled by the shell (spec §9):
// Cmd/Ctrl+1…6 switch view, Cmd/Ctrl+F focus search, Cmd/Ctrl+N new task,
// Cmd/Ctrl+, settings, Esc closes the detail panel (dialogs/popovers handle their own Esc).
import { useEffect } from 'react'
import { VIEW_IDS } from '@shared/constants'
import { isModKey } from '@/lib/platform'
import { useUiStore } from '@/stores/uiStore'

/** True when a Radix dialog / popover / menu is open (they own Esc). */
function overlayOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
    ) !== null
  )
}

export function useShellShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const ui = useUiStore.getState()
      if (isModKey(e) && !e.altKey && !e.shiftKey) {
        const n = Number(e.key)
        if (Number.isInteger(n) && n >= 1 && n <= VIEW_IDS.length) {
          e.preventDefault()
          ui.setActiveView(VIEW_IDS[n - 1] ?? 'today')
          return
        }
        switch (e.key.toLowerCase()) {
          case 'f':
            e.preventDefault()
            ui.requestSearchFocus()
            return
          case 'n':
            e.preventDefault()
            ui.openNewTaskDialog()
            return
          case ',':
            e.preventDefault()
            ui.setSettingsOpen(true)
            return
        }
      }
      if (e.key === 'Escape' && !e.defaultPrevented && !overlayOpen() && ui.selectedTaskId) {
        e.preventDefault()
        ui.selectTask(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
