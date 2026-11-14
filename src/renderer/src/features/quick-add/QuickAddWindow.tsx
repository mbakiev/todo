// PLACEHOLDER — owned by the desktop-shell/quick-add feature. Root component of the
// quick-add popup window (mounted by src/renderer/src/quick-add.tsx).
import { Toaster } from '@/components/ui/sonner'
import { api } from '@/lib/api'
import { useApplyTheme } from '@/lib/theme'
import { QuickAddForm } from './QuickAddForm'

export function QuickAddWindow() {
  useApplyTheme()
  const hide = (): void =>
    void api()
      .app.hideQuickAdd()
      .catch(() => window.close())
  return (
    <div className="h-full p-3">
      <QuickAddForm variant="window" onCreated={hide} onCancel={hide} />
      <Toaster position="bottom-center" />
    </div>
  )
}
