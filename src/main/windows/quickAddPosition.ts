export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Top-left position for the popup: horizontally centred on the work area, top edge in the
 * upper third. Pure so it can be unit-tested.
 */
export function quickAddPosition(
  workArea: Rect,
  size: { width: number; height: number },
): { x: number; y: number } {
  const x = Math.round(workArea.x + (workArea.width - size.width) / 2)
  const y = Math.round(workArea.y + workArea.height * 0.2)
  // Keep it fully on screen on very short displays.
  const maxY = workArea.y + Math.max(0, workArea.height - size.height)
  return { x, y: Math.min(y, maxY) }
}
