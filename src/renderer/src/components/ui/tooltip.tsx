import * as React from 'react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/utils'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

// App-wide tooltip rules (every tooltip goes through this wrapper):
//
// 1. A tooltip opens on hover, or on focus only when the focus came from keyboard
//    navigation (Tab / arrow keys). Programmatic focus — a menu or popover handing focus
//    back to its trigger after Esc or a selection — never opens it.
// 2. An open tooltip never consumes Esc. Radix registers tooltip content as the topmost
//    "dismissable layer", so Esc would only close the tooltip and the panel / dialog /
//    popover underneath would need a second Esc. A window capture listener (it runs before
//    Radix's document listener) closes open tooltips first and lets the same Esc go on to
//    whatever it would have closed without a tooltip.

/** Keys that move focus as keyboard navigation (focus arriving after them may open a tip). */
const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
])

/** Radix's internal event that makes every dismissable layer re-check whether it is on top. */
const LAYER_UPDATE_EVENT = 'dismissableLayer.update'

let lastInteractionWasNavigation = false
/** Close functions of the tooltips that are open right now. */
const openTooltips = new Set<() => void>()
let listenersInstalled = false

function installListeners(): void {
  if (listenersInstalled || typeof window === 'undefined') return
  listenersInstalled = true
  window.addEventListener(
    'keydown',
    (e) => {
      lastInteractionWasNavigation = NAVIGATION_KEYS.has(e.key)
      if (e.key !== 'Escape' || openTooltips.size === 0) return
      const closers = [...openTooltips]
      // Unmount the tooltip layers synchronously, then let the layer below take over as the
      // topmost one before this keydown reaches Radix's document listener.
      flushSync(() => closers.forEach((close) => close()))
      flushSync(() => document.dispatchEvent(new CustomEvent(LAYER_UPDATE_EVENT)))
    },
    true,
  )
  window.addEventListener(
    'pointerdown',
    () => {
      lastInteractionWasNavigation = false
    },
    true,
  )
}

/** Test helper: forget the last interaction (each test starts like a fresh window). */
export function resetTooltipInteractionForTests(): void {
  lastInteractionWasNavigation = false
}

/** True while the content must not render at all (closed by Esc: no exit animation). */
const SuppressedContext = React.createContext(false)

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  installListeners()
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  installListeners()
  const [localOpen, setLocalOpen] = React.useState(defaultOpen)
  const [suppressed, setSuppressed] = React.useState(false)
  const controlled = openProp !== undefined
  const open = controlled ? openProp : localOpen

  const onOpenChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (next) setSuppressed(false)
      if (!controlled) setLocalOpen(next)
      onOpenChangeRef.current?.(next)
    },
    [controlled],
  )

  const visible = open && !suppressed
  React.useEffect(() => {
    if (!visible) return
    const close = (): void => {
      setSuppressed(true)
      setOpen(false)
    }
    openTooltips.add(close)
    return () => {
      openTooltips.delete(close)
    }
  }, [visible, setOpen])

  return (
    <SuppressedContext.Provider value={suppressed}>
      <TooltipPrimitive.Root data-slot="tooltip" open={visible} onOpenChange={setOpen} {...props} />
    </SuppressedContext.Provider>
  )
}

function TooltipTrigger({
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onFocus={(e) => {
        onFocus?.(e)
        // Radix skips its own open-on-focus when the event is default-prevented.
        if (!lastInteractionWasNavigation) e.preventDefault()
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const suppressed = React.useContext(SuppressedContext)
  if (suppressed) return null
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
