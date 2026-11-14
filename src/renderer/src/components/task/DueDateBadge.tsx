import { CalendarArrowUp, CalendarDays } from 'lucide-react'
import { formatRelativeDate } from '@shared/dates'
import type { LocalDate, Status, Task } from '@shared/types'
import { dateBadge, isDueToday, isOverdue } from '@shared/views'
import { cn } from '@/lib/utils'
import { useToday } from '@/lib/useToday'

const BADGE_CLASS =
  'inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap tabular-nums'

export interface DueDateBadgeProps {
  dueDate: LocalDate | null
  status: Status
  showIcon?: boolean
  className?: string
}

/** Due date label: red when overdue, amber when due today (open tasks only). Renders nothing without a due date. */
export function DueDateBadge({ dueDate, status, showIcon = true, className }: DueDateBadgeProps) {
  const today = useToday()
  if (!dueDate) return null
  const t = { status, dueDate }
  const tone = isOverdue(t, today)
    ? 'text-overdue'
    : isDueToday(t, today)
      ? 'text-due-today'
      : 'text-muted-foreground'
  return (
    <span className={cn(BADGE_CLASS, tone, className)} title={`Due ${dueDate}`}>
      {showIcon && <CalendarDays className="size-3" />}
      {formatRelativeDate(dueDate, today)}
    </span>
  )
}

export interface StartDateBadgeProps {
  startDate: LocalDate
  className?: string
}

/** "Starts <date>" for a task with a start date and no due date. Always muted (never overdue / today colours). */
export function StartDateBadge({ startDate, className }: StartDateBadgeProps) {
  const today = useToday()
  return (
    <span
      className={cn(BADGE_CLASS, 'text-muted-foreground', className)}
      title={`Starts ${startDate}`}
      data-testid="start-date-badge"
    >
      <CalendarArrowUp className="size-3" />
      Starts {formatRelativeDate(startDate, today)}
    </span>
  )
}

/** The one date badge a compact row shows (see `dateBadge` in shared/views.ts). */
export function TaskDateBadge({
  task,
  className,
}: {
  task: Pick<Task, 'startDate' | 'dueDate' | 'status'>
  className?: string
}) {
  const badge = dateBadge(task)
  if (!badge) return null
  return badge.kind === 'due' ? (
    <DueDateBadge dueDate={badge.date} status={task.status} className={className} />
  ) : (
    <StartDateBadge startDate={badge.date} className={className} />
  )
}
