import { AlertTriangle } from 'lucide-react'
import type { SVGProps } from 'react'
import { PRIORITY_LABELS } from '@shared/constants'
import type { Priority } from '@shared/types'
import { cn } from '@/lib/utils'
import { PRIORITY_TEXT_CLASS } from './priorityClasses'

export interface PriorityIconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  priority: Priority
}

// Three rising bars of equal footprint for low / medium / high: the level is the number of
// solid bars, the rest stay as faint tracks so every level has the same size and shape and
// low never shrinks to a speck. Critical is the warning triangle.
const BARS = [
  { x: 2, y: 9, h: 5 },
  { x: 6.5, y: 5.5, h: 8.5 },
  { x: 11, y: 2, h: 12 },
] as const

/** Priority glyph in the priority colour (spec §10: low slate, medium blue, high amber, critical red). */
export function PriorityIcon({ priority, className, ...props }: PriorityIconProps) {
  const label = `${PRIORITY_LABELS[priority]} priority`
  if (priority === 4) {
    return (
      <AlertTriangle
        aria-label={label}
        role="img"
        strokeWidth={2.25}
        className={cn('size-3.5 shrink-0', PRIORITY_TEXT_CLASS[priority], className)}
        {...props}
      />
    )
  }
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      data-priority={priority}
      className={cn('size-3.5 shrink-0', PRIORITY_TEXT_CLASS[priority], className)}
      {...props}
    >
      {BARS.map((b, i) => (
        <rect
          key={b.x}
          x={b.x}
          y={b.y}
          width={3}
          height={b.h}
          rx={1}
          fill="currentColor"
          opacity={i < priority ? 1 : 0.22}
        />
      ))}
    </svg>
  )
}
