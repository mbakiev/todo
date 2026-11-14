// Clicking empty space in the active view closes the detail panel (spec §7), through the same
// `selectTask(null)` path as Esc and the panel's close button, so the leave guard applies.
//
// A real click only: the press (pointerdown) and the click must both land on empty space
// (`emptySpace.ts`), with a plain primary button and no meaningful pointer travel in between —
// so the end of a drag, a text selection, a resize or a scrollbar press never closes the panel.
// While it closes the panel the click is stopped, so a view's own empty-space action (a calendar
// day opening the new-task dialog) does not also run; with no task open nothing here runs at all.
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { useUiStore } from '@/stores/uiStore'
import {
  isEmptySpace,
  isPlainPrimary,
  overlayOpen,
  shouldDeselect,
  travel,
  type PressRecord,
} from './emptySpace'

export interface EmptySpaceDeselect {
  /** Attach to the element hosting the active view. */
  viewRef: RefObject<HTMLDivElement | null>
  /** Capture phase, so it runs before (and can stop) the view's own click handlers. */
  onViewClickCapture(e: ReactMouseEvent<HTMLDivElement>): void
}

export function useEmptySpaceDeselect(): EmptySpaceDeselect {
  const viewRef = useRef<HTMLDivElement | null>(null)
  const press = useRef<PressRecord | null>(null)

  useEffect(() => {
    // Window capture: sees every press first, including ones a widget stops or captures, and
    // before Radix dismisses an open overlay on the same press.
    const onDown = (e: PointerEvent): void => {
      const container = viewRef.current
      if (!container || !e.isPrimary || !useUiStore.getState().selectedTaskId) {
        press.current = null
        return
      }
      press.current = {
        empty:
          isPlainPrimary(e) &&
          !overlayOpen() &&
          isEmptySpace(e.target, container, e.clientX, e.clientY),
        x: e.clientX,
        y: e.clientY,
        maxTravel: 0,
      }
    }
    const onMove = (e: PointerEvent): void => {
      const p = press.current
      if (!p || !e.isPrimary) return
      p.maxTravel = Math.max(p.maxTravel, travel(p.x, p.y, e.clientX, e.clientY))
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', onMove, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', onMove, true)
    }
  }, [])

  const onViewClickCapture = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const p = press.current
    press.current = null
    const ui = useUiStore.getState()
    if (!p || !ui.selectedTaskId) return
    const empty = isEmptySpace(e.target, e.currentTarget, e.clientX, e.clientY)
    const click = {
      button: e.button,
      altKey: e.altKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      x: e.clientX,
      y: e.clientY,
      detail: e.detail,
      empty,
    }
    if (!shouldDeselect(p, click, true)) return
    // Only closes the panel: the view's own action for this click does not run as well.
    e.stopPropagation()
    ui.selectTask(null)
  }

  return { viewRef, onViewClickCapture }
}
