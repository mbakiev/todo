// PLACEHOLDER — owned by the desktop-shell/quick-add feature. The in-app "New task" dialog
// (Cmd/Ctrl+N), driven by uiStore.newTaskDialog. Keep the export name; the shell mounts it.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUiStore } from '@/stores/uiStore'
import { QuickAddForm } from './QuickAddForm'

export function NewTaskDialog() {
  const { open, prefill } = useUiStore((s) => s.newTaskDialog)
  const close = useUiStore((s) => s.closeNewTaskDialog)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="top-[20%] translate-y-0 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm">New task</DialogTitle>
          <DialogDescription className="sr-only">Type a title and press Enter.</DialogDescription>
        </DialogHeader>
        {open && (
          <QuickAddForm variant="dialog" prefill={prefill} onCreated={close} onCancel={close} />
        )}
      </DialogContent>
    </Dialog>
  )
}
