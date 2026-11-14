import { CalendarDays } from 'lucide-react'
import { formatRelativeDate } from '@shared/dates'
import type { LocalDate, Status } from '@shared/types'
import { isDueToday, isOverdue } from '@shared/views'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/useToday'

export interface DueDateBadgeProps {
  dueDate: LocalDate | null
  status: Status
  /** Optional start date; shown as a range "Nov 10 – Nov 20" when both are set. */
  startDate?: LocalDate | null
  showIcon?: boolean
  className?: string
}

/** Due date label: red when overdue, amber when due today (open tasks only). Renders nothing when undated. */
export function DueDateBadge({
  dueDate,
  status,
  startDate,
  showIcon = true,
  className,
}: DueDateBadgeProps) {
  const today = useToday()
  if (!dueDate && !startDate) return null
  const t = { status, dueDate }
  const tone = isOverdue(t, today)
    ? 'text-overdue'
    : isDueToday(t, today)
      ? 'text-due-today'
      : 'text-muted-foreground'
  const label =
    startDate && dueDate && startDate !== dueDate
      ? `${formatRelativeDate(startDate, today)} – ${formatRelativeDate(dueDate, today)}`
      : formatRelativeDate((dueDate ?? startDate) as LocalDate, today)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap tabular-nums',
        tone,
        className,
      )}
      title={dueDate ? `Due ${dueDate}` : `Starts ${startDate}`}
    >
      {showIcon && <CalendarDays className="size-3" />}
      {label}
    </span>
  )
}
