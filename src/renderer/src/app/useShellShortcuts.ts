// In-app keyboard shortcuts handled by the shell (spec §9):
// Cmd/Ctrl+1…6 switch view, Cmd/Ctrl+F focus search, Cmd/Ctrl+N new task,
// Cmd/Ctrl+, settings, Esc closes the detail panel (dialogs/popovers handle their own Esc).
//
// The renderer is the single owner of Cmd/Ctrl+N and Cmd/Ctrl+, while the main window has
// focus: the app menu shows the same accelerators but ignores them when they come from the
// focused main window (menu.ts), so a key press never opens the dialog twice.
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
    // Capture phase: widgets that stop propagation (editor, comboboxes) cannot swallow these.
    const onModKey = (e: KeyboardEvent): void => {
      if (!isModKey(e) || e.altKey || e.shiftKey || e.isComposing) return
      const ui = useUiStore.getState()
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
          if (!e.repeat) ui.openNewTaskDialog()
          return
        case ',':
          e.preventDefault()
          ui.setSettingsOpen(true)
          return
      }
    }
    // Bubble phase: drags, editors and overlays consume their own Esc first.
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlayOpen()) return
      const ui = useUiStore.getState()
      if (!ui.selectedTaskId) return
      e.preventDefault()
      ui.selectTask(null)
    }
    window.addEventListener('keydown', onModKey, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('keydown', onModKey, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])
}
