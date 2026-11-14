// Detail panel width: persisted in settings.detailPanelWidth, drag-resizable from the left edge,
// clamped so the main view always keeps usable space.
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { DEFAULT_SETTINGS, DETAIL_PANEL_MAX_WIDTH, DETAIL_PANEL_MIN_WIDTH } from '@shared/constants'
import { useSettings } from '@/stores/selectors'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Space always left for the sidebar (208px) + main view, so the view under an open panel keeps
 * a usable toolbar and content (the panel never goes below its own minimum, though).
 */
const MIN_MAIN_AREA = 640

export function clampPanelWidth(width: number, windowWidth: number): number {
  const max = Math.max(
    DETAIL_PANEL_MIN_WIDTH,
    Math.min(DETAIL_PANEL_MAX_WIDTH, windowWidth - MIN_MAIN_AREA),
  )
  return Math.round(Math.min(max, Math.max(DETAIL_PANEL_MIN_WIDTH, width)))
}

export interface PanelWidth {
  width: number
  resizing: boolean
  onResizeStart(e: ReactPointerEvent<HTMLElement>): void
  reset(): void
}

export function usePanelWidth(): PanelWidth {
  const { detailPanelWidth } = useSettings()
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const width = clampPanelWidth(dragWidth ?? detailPanelWidth, windowWidth)

  const persist = (w: number): void => {
    if (w !== useSettingsStore.getState().settings.detailPanelWidth)
      void useSettingsStore.getState().set({ detailPanelWidth: w })
  }

  const onResizeStart = (e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startWidth = width
    let last = startWidth
    setDragWidth(startWidth)
    const onMove = (ev: PointerEvent): void => {
      last = clampPanelWidth(startWidth + (startX - ev.clientX), window.innerWidth)
      setDragWidth(last)
    }
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      persist(last)
      setDragWidth(null)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  return {
    width,
    resizing: dragWidth !== null,
    onResizeStart,
    reset: () => persist(DEFAULT_SETTINGS.detailPanelWidth),
  }
}
