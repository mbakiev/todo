// Cheap text-width measurement (canvas) used to decide whether a bar label fits inside.
let ctx: CanvasRenderingContext2D | null | undefined
const cache = new Map<string, number>()

/** Width in px of `text` in the bar label font; a rough estimate when canvas is unavailable. */
export function measureLabel(text: string): number {
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  if (ctx === undefined) {
    try {
      ctx = document.createElement('canvas').getContext('2d')
      if (ctx) {
        const family = getComputedStyle(document.body).fontFamily || 'system-ui'
        ctx.font = `500 12px ${family}`
      }
    } catch {
      ctx = null
    }
  }
  const width = ctx ? ctx.measureText(text).width : text.length * 6.6
  if (cache.size > 2000) cache.clear()
  cache.set(text, width)
  return width
}
