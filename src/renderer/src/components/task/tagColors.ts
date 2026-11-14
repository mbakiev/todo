import type { TagColor } from '@shared/types'

/** Soft chip classes per palette colour (background + foreground). */
export const TAG_CHIP_CLASS: Record<TagColor, string> = {
  slate: 'bg-tag-slate text-tag-slate-fg',
  red: 'bg-tag-red text-tag-red-fg',
  orange: 'bg-tag-orange text-tag-orange-fg',
  amber: 'bg-tag-amber text-tag-amber-fg',
  green: 'bg-tag-green text-tag-green-fg',
  teal: 'bg-tag-teal text-tag-teal-fg',
  blue: 'bg-tag-blue text-tag-blue-fg',
  violet: 'bg-tag-violet text-tag-violet-fg',
}

/** Solid dot classes per palette colour (sidebar, pickers). */
export const TAG_DOT_CLASS: Record<TagColor, string> = {
  slate: 'bg-tag-slate-dot',
  red: 'bg-tag-red-dot',
  orange: 'bg-tag-orange-dot',
  amber: 'bg-tag-amber-dot',
  green: 'bg-tag-green-dot',
  teal: 'bg-tag-teal-dot',
  blue: 'bg-tag-blue-dot',
  violet: 'bg-tag-violet-dot',
}
