// Root of the quick-add popup window (mounted by src/renderer/src/quick-add.tsx).
// The native window is frameless with rounded corners and a shadow; its height follows the
// content (and any open popover) via `app.resizeQuickAdd`.
import { useEffect, useRef, type RefObject } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useApplyTheme } from '@/lib/theme'
import { QuickAddForm } from './QuickAddForm'

const POPOVER_GAP = 12

/**
 * Height the window needs: the form, or — while a picker popover is open — enough room
 * below the trigger for the popover's full content (Radix would otherwise squeeze or flip
 * it inside the small window).
 */
function requiredHeight(root: HTMLElement): number {
  let needed = root.getBoundingClientRect().height
  const wrappers = document.querySelectorAll<HTMLElement>('[data-radix-popper-content-wrapper]')
  if (wrappers.length > 0) {
    const anchors = root.querySelectorAll<HTMLElement>('[aria-expanded="true"]')
    const anchorBottom = Array.from(anchors).reduce(
      (max, el) => Math.max(max, el.getBoundingClientRect().bottom),
      0,
    )
    for (const w of wrappers) {
      const content = w.firstElementChild as HTMLElement | null
      const h = content ? content.scrollHeight : w.getBoundingClientRect().height
      needed = Math.max(needed, anchorBottom + h + POPOVER_GAP)
    }
  }
  return Math.ceil(needed)
}

function useFitWindowToContent(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    let last = 0
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const h = requiredHeight(root)
        if (h !== last) {
          last = h
          void api().app.resizeQuickAdd(h)
        }
      })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    // Popovers are portalled to <body>; watch for them opening, closing and resizing.
    const mo = new MutationObserver(measure)
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'data-state'],
    })
    measure()
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref])
}

export function QuickAddWindow() {
  useApplyTheme()
  const rootRef = useRef<HTMLDivElement>(null)
  useFitWindowToContent(rootRef)

  useEffect(() => {
    document.body.classList.add('bg-popover')
    document.documentElement.dataset.window = 'quick-add'
  }, [])

  const hide = (): void =>
    void api()
      .app.hideQuickAdd()
      .catch(() => window.close())

  return (
    <TooltipProvider delayDuration={400}>
      <div
        ref={rootRef}
        className="bg-popover text-popover-foreground"
        data-testid="quick-add-window"
      >
        <QuickAddForm variant="window" onCreated={hide} onCancel={hide} />
      </div>
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}
