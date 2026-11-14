import { PRIORITY_LABELS } from '@shared/constants'
import type { Priority } from '@shared/types'
import { cn } from '@/lib/utils'
import { PriorityIcon } from './PriorityIcon'

export interface PriorityBadgeProps {
  priority: Priority
  /** Show the text label next to the icon (default true). */
  showLabel?: boolean
  className?: string
}

export function PriorityBadge({ priority, showLabel = true, className }: PriorityBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
      title={`${PRIORITY_LABELS[priority]} priority`}
    >
      <PriorityIcon priority={priority} />
      {showLabel && <span>{PRIORITY_LABELS[priority]}</span>}
    </span>
  )
}
