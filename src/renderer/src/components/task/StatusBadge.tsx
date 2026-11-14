import { STATUS_LABELS } from '@shared/constants'
import type { Status } from '@shared/types'
import { cn } from '@/lib/utils'
import { StatusIcon } from './StatusIcon'

export interface StatusBadgeProps {
  status: Status
  showLabel?: boolean
  className?: string
}

export function StatusBadge({ status, showLabel = true, className }: StatusBadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs', className)}
      title={STATUS_LABELS[status]}
    >
      <StatusIcon status={status} />
      {showLabel && <span>{STATUS_LABELS[status]}</span>}
    </span>
  )
}
