import { useState } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { NewTaskDialog } from '@/features/quick-add/NewTaskDialog'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { TaskDetailPanel } from '@/features/task-detail/TaskDetailPanel'
import { useApplyTheme } from '@/lib/theme'
import { useUiStore } from '@/stores/uiStore'
import { Sidebar } from './Sidebar'
import { Toolbar } from './Toolbar'
import { ToolbarSlotContext } from './toolbarSlotContext'
import { useShellShortcuts } from './useShellShortcuts'
import { useEmptySpaceDeselect } from './useEmptySpaceDeselect'
import { useShortcutFailureToast } from './useShortcutFailureToast'
import { ViewSwitch } from './ViewSwitch'

/**
 * Main-window shell: sidebar · (toolbar + active view) · detail panel slot.
 * Feature folders render inside; they should not need to touch this file.
 */
export function App() {
  useApplyTheme()
  useShellShortcuts()
  useShortcutFailureToast()
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)
  // Clicking empty space in the view closes the detail panel (spec §7).
  const { viewRef, onViewClickCapture } = useEmptySpaceDeselect()

  return (
    <TooltipProvider delayDuration={400}>
      <ToolbarSlotContext.Provider value={toolbarSlot}>
        <div className="relative flex h-full w-full overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Toolbar slotRef={setToolbarSlot} />
            <div
              ref={viewRef}
              className="relative min-h-0 flex-1"
              data-slot="view"
              onClickCapture={onViewClickCapture}
            >
              <ViewSwitch />
            </div>
          </main>
          {selectedTaskId && (
            // The panel owns its width, border, resize handle and animation.
            // Too narrow to dock it beside a usable view (sidebar 208 + panel min 360 + view
            // 320), the panel floats over the view instead of squeezing it.
            <aside
              className="flex min-h-0 shrink-0 max-[887px]:absolute max-[887px]:inset-y-0 max-[887px]:right-0 max-[887px]:z-30 max-[887px]:shadow-xl"
              data-slot="detail-panel"
            >
              <TaskDetailPanel taskId={selectedTaskId} />
            </aside>
          )}
        </div>
        <NewTaskDialog />
        <SettingsDialog />
        <Toaster position="bottom-center" />
      </ToolbarSlotContext.Provider>
    </TooltipProvider>
  )
}
