import { Ban, CircleCheck, CircleDashed, CircleDot, type LucideProps } from 'lucide-react'
import { STATUS_LABELS } from '@shared/constants'
import type { Status } from '@shared/types'
import { cn } from '@/lib/utils'
import { STATUS_TEXT_CLASS } from './statusClasses'

const ICONS = {
  not_started: CircleDashed,
  in_progress: CircleDot,
  blocked: Ban,
  done: CircleCheck,
} as const

export interface StatusIconProps extends Omit<LucideProps, 'ref'> {
  status: Status
}

export function StatusIcon({ status, className, ...props }: StatusIconProps) {
  const Icon = ICONS[status]
  return (
    <Icon
      aria-label={STATUS_LABELS[status]}
      strokeWidth={2.25}
      className={cn('size-3.5 shrink-0', STATUS_TEXT_CLASS[status], className)}
      {...props}
    />
  )
}
