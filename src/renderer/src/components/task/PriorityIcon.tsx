import { AlertTriangle, SignalHigh, SignalLow, SignalMedium, type LucideProps } from 'lucide-react'
import { PRIORITY_LABELS } from '@shared/constants'
import type { Priority } from '@shared/types'
import { cn } from '@/lib/utils'
import { PRIORITY_TEXT_CLASS } from './priorityClasses'

const ICONS = { 1: SignalLow, 2: SignalMedium, 3: SignalHigh, 4: AlertTriangle } as const

export interface PriorityIconProps extends Omit<LucideProps, 'ref'> {
  priority: Priority
}

/** Signal-bars icon for low/medium/high, warning triangle for critical, in the priority colour. */
export function PriorityIcon({ priority, className, ...props }: PriorityIconProps) {
  const Icon = ICONS[priority]
  return (
    <Icon
      aria-label={`${PRIORITY_LABELS[priority]} priority`}
      strokeWidth={priority === 4 ? 2.25 : 2.5}
      className={cn('size-3.5 shrink-0', PRIORITY_TEXT_CLASS[priority], className)}
      {...props}
    />
  )
}
