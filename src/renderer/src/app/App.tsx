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
import { ViewSwitch } from './ViewSwitch'

/**
 * Main-window shell: sidebar · (toolbar + active view) · detail panel slot.
 * Feature folders render inside; they should not need to touch this file.
 */
export function App() {
  useApplyTheme()
  useShellShortcuts()
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const selectedTaskId = useUiStore((s) => s.selectedTaskId)

  return (
    <TooltipProvider delayDuration={400}>
      <ToolbarSlotContext.Provider value={toolbarSlot}>
        <div className="flex h-full w-full overflow-hidden">
          <Sidebar />
          <main className="flex min-w-0 flex-1 flex-col">
            <Toolbar slotRef={setToolbarSlot} />
            <div className="relative min-h-0 flex-1" data-slot="view">
              <ViewSwitch />
            </div>
          </main>
          {selectedTaskId && (
            // The panel owns its width, border, resize handle and animation.
            <aside className="flex min-h-0 shrink-0" data-slot="detail-panel">
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
