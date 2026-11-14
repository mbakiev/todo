// Pointer handling for moving / resizing timeline bars. The date math lives in
// `timelineGeometry.applyDrag`; this hook only tracks the pointer, auto-scrolls near the
// edges, previews, commits on release and cancels on Esc.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Task } from '@shared/types'
import { taskSpan } from '@shared/views'
import {
  applyDrag,
  datesPatch,
  pxToDays,
  type DateRange,
  type DragMode,
  type TaskDates,
} from './timelineGeometry'

/** Pixels the pointer must travel before a press becomes a drag (keeps clicks working). */
const DRAG_THRESHOLD = 4
/** Distance from the grid edge where auto-scroll kicks in, and its max speed (px/frame). */
const EDGE_ZONE = 48
const EDGE_SPEED = 14

export interface DragPreview {
  taskId: string
  mode: DragMode
  dates: TaskDates
}

interface Session {
  taskId: string
  mode: DragMode
  original: TaskDates
  startX: number
  startScroll: number
  /** Extra px between the drawn bar and its range position (sticky pre-range stubs). */
  offset: number
  clientX: number
  active: boolean
  delta: number
  /** A preview has been rendered for the current delta. */
  shown: boolean
  frame: number
}

export interface UseBarDragOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>
  range: DateRange
  dayWidth: number
  /** Width of the sticky left pane; auto-scroll starts at the grid's visible left edge. */
  leftPaneWidth: number
  onCommit(taskId: string, patch: Partial<TaskDates>): void
}

export function useBarDrag({
  scrollRef,
  range,
  dayWidth,
  leftPaneWidth,
  onCommit,
}: UseBarDragOptions) {
  const [preview, setPreview] = useState<DragPreview | null>(null)
  const session = useRef<Session | null>(null)
  const suppressClick = useRef(false)
  const teardown = useRef<(() => void) | null>(null)

  // Latest values for the window listeners without re-binding them mid-drag.
  const latest = useRef({ range, dayWidth, leftPaneWidth, onCommit })
  useLayoutEffect(() => {
    latest.current = { range, dayWidth, leftPaneWidth, onCommit }
  })

  useEffect(() => () => teardown.current?.(), [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent, task: Task, mode: DragMode) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return
      const el = scrollRef.current
      if (!el) return
      e.stopPropagation()
      teardown.current?.()
      const span = taskSpan(task)
      const beforeRange = span !== null && span.end < latest.current.range.start

      const s: Session = {
        taskId: task.id,
        mode,
        original: { startDate: task.startDate, dueDate: task.dueDate },
        startX: e.clientX,
        startScroll: el.scrollLeft,
        offset: beforeRange ? el.scrollLeft : 0,
        clientX: e.clientX,
        active: false,
        delta: 0,
        shown: false,
        frame: 0,
      }
      session.current = s

      const recompute = (): void => {
        if (!s.active) {
          if (Math.abs(s.clientX - s.startX) < DRAG_THRESHOLD) return
          s.active = true
          document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize'
          document.body.style.userSelect = 'none'
        }
        const dx = s.clientX - s.startX + (el.scrollLeft - s.startScroll) + s.offset
        const delta = pxToDays(dx, latest.current.dayWidth)
        if (delta === s.delta && s.shown) return
        s.delta = delta
        s.shown = true
        setPreview({
          taskId: s.taskId,
          mode: s.mode,
          dates: applyDrag(s.original, s.mode, delta, latest.current.range),
        })
      }

      const autoScroll = (): void => {
        s.frame = 0
        if (!s.active) return
        const rect = el.getBoundingClientRect()
        const gridLeft = rect.left + latest.current.leftPaneWidth
        let speed = 0
        if (s.clientX < gridLeft + EDGE_ZONE) {
          speed = -EDGE_SPEED * Math.min(1, (gridLeft + EDGE_ZONE - s.clientX) / EDGE_ZONE)
        } else if (s.clientX > rect.right - EDGE_ZONE) {
          speed = EDGE_SPEED * Math.min(1, (s.clientX - (rect.right - EDGE_ZONE)) / EDGE_ZONE)
        }
        if (speed !== 0) {
          const before = el.scrollLeft
          el.scrollLeft += speed
          if (el.scrollLeft !== before) {
            recompute()
            s.frame = requestAnimationFrame(autoScroll)
          }
        }
      }

      const onMove = (ev: PointerEvent): void => {
        s.clientX = ev.clientX
        recompute()
        if (s.active && s.frame === 0) s.frame = requestAnimationFrame(autoScroll)
      }

      /** `buttonDown`: the drag ended (Esc) while the mouse button is still held. */
      const finish = (commit: boolean, buttonDown = false): void => {
        const wasActive = s.active
        cleanup()
        if (wasActive) {
          // The click that follows pointerup must not open the detail panel — also when Esc
          // cancelled the drag and the button is released later.
          suppressClick.current = true
          const release = (): void => {
            setTimeout(() => (suppressClick.current = false), 0)
          }
          if (buttonDown) {
            window.addEventListener('pointerup', release, { once: true, capture: true })
            window.addEventListener('pointercancel', release, { once: true, capture: true })
          } else release()
          if (commit) {
            const next = applyDrag(s.original, s.mode, s.delta, latest.current.range)
            const patch = datesPatch(s.original, next)
            if (patch) latest.current.onCommit(s.taskId, patch)
          }
        }
        setPreview(null)
      }

      const onUp = (): void => finish(true)
      const onCancel = (): void => finish(false)
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== 'Escape') return
        // Own Esc while dragging so the shell does not also close the detail panel.
        ev.preventDefault()
        ev.stopPropagation()
        finish(false, true)
      }

      function cleanup(): void {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        el?.removeEventListener('scroll', recompute)
        if (s.frame) cancelAnimationFrame(s.frame)
        s.frame = 0
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (session.current === s) session.current = null
        teardown.current = null
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
      el.addEventListener('scroll', recompute, { passive: true })
      teardown.current = cleanup
    },
    [scrollRef],
  )

  /** True (once) right after a drag ended — callers skip their click handler. */
  const consumeClick = useCallback((): boolean => {
    if (!suppressClick.current) return false
    suppressClick.current = false
    return true
  }, [])

  return { preview, onPointerDown, consumeClick }
}
