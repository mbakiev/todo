// Root of the quick-add popup window (mounted by src/renderer/src/quick-add.tsx).
// The native window is frameless with rounded corners and a shadow; its height follows the
// content (and any open popover) via `app.resizeQuickAdd`. The hint bar stays at the window's
// bottom edge; a picker popover only becomes visible once the window has room for it below
// its trigger, so it never flashes squeezed or flipped upward first.
import { useEffect, useRef, type RefObject } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { useApplyTheme } from '@/lib/theme'
import { QuickAddForm } from './QuickAddForm'

const POPOVER_GAP = 12
/** Set on <html> while the window is growing for a popover: popovers stay invisible. */
const SIZING_ATTR = 'data-quick-add-sizing'
/** Give up waiting for the window to grow after this many frames (display too small). */
const MAX_WAIT_FRAMES = 30

const popoverWrappers = (): NodeListOf<HTMLElement> =>
  document.querySelectorAll<HTMLElement>('[data-radix-popper-content-wrapper]')

/**
 * Height the window needs: the form without its flexible spacer, or — while a picker popover
 * is open — enough room below the trigger for the popover's full content plus the hint bar
 * (Radix would otherwise squeeze or flip it inside the small window).
 */
function requiredHeight(root: HTMLElement): number {
  const spacer = root.querySelector<HTMLElement>('[data-quick-add-spacer]')
  let needed = root.getBoundingClientRect().height - (spacer?.getBoundingClientRect().height ?? 0)
  const wrappers = popoverWrappers()
  if (wrappers.length > 0) {
    const anchors = root.querySelectorAll<HTMLElement>('[aria-expanded="true"]')
    const anchorBottom = Array.from(anchors).reduce(
      (max, el) => Math.max(max, el.getBoundingClientRect().bottom),
      0,
    )
    const hints = root.querySelector<HTMLElement>('[data-quick-add-hints]')
    const hintsHeight = hints?.getBoundingClientRect().height ?? 0
    for (const w of wrappers) {
      const content = w.firstElementChild as HTMLElement | null
      const h = content ? content.scrollHeight : w.getBoundingClientRect().height
      needed = Math.max(needed, anchorBottom + h + POPOVER_GAP + hintsHeight)
    }
  }
  return Math.ceil(needed)
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

function useFitWindowToContent(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const html = document.documentElement
    let last = 0
    let frame = 0
    let generation = 0
    const reveal = (): void => html.removeAttribute(SIZING_ATTR)

    const measure = (): void => {
      // A popover that needs a taller window stays hidden from its first frame until the
      // window has grown and Radix has re-placed it below the trigger.
      if (popoverWrappers().length > 0 && requiredHeight(root) > window.innerHeight) {
        html.setAttribute(SIZING_ATTR, '')
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const h = requiredHeight(root)
        const popoverOpen = popoverWrappers().length > 0
        if (h !== last) {
          last = h
          const mine = ++generation
          void api()
            .app.resizeQuickAdd(h)
            .then(async () => {
              for (let i = 0; i < MAX_WAIT_FRAMES && window.innerHeight < h; i++) await nextFrame()
              // One more frame for floating-ui to reposition after the resize.
              await nextFrame()
              await nextFrame()
              if (mine === generation) reveal()
            })
            .catch(reveal)
        } else if (!popoverOpen || window.innerHeight >= h) {
          reveal()
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
      reveal()
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
        className="flex min-h-screen flex-col bg-popover text-popover-foreground"
        data-testid="quick-add-window"
      >
        <QuickAddForm variant="window" onCreated={hide} onCancel={hide} />
      </div>
      <Toaster position="top-center" />
    </TooltipProvider>
  )
}
