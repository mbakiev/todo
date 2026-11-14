// The in-app "New task" dialog (Cmd/Ctrl+N, toolbar button, tray/menu "New Task", calendar
// day click with a prefilled due date), driven by uiStore.newTaskDialog.
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useUiStore } from '@/stores/uiStore'
import { QuickAddForm } from './QuickAddForm'

export function NewTaskDialog() {
  const { open, prefill } = useUiStore((s) => s.newTaskDialog)
  const close = useUiStore((s) => s.closeNewTaskDialog)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        className="top-[16%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[600px]"
        data-testid="new-task-dialog"
      >
        <DialogTitle className="sr-only">New task</DialogTitle>
        <DialogDescription className="sr-only">
          Type a title and press Enter. Inline tokens: #tag, !priority, @date.
        </DialogDescription>
        {open && (
          // Remount per opening so the draft starts from the current prefill.
          <QuickAddForm variant="dialog" prefill={prefill} onCreated={close} onCancel={close} />
        )}
      </DialogContent>
    </Dialog>
  )
}
