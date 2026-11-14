// PLACEHOLDER — owned by the list+calendar feature. Replace this file's contents (keep the
// export name). Spec §6 "Calendar": month grid, spanning bars, drag to reschedule.
import { useMemo } from 'react'
import { formatShortDate } from '@shared/dates'
import { anchor, filterCalendar } from '@shared/views'
import { StatusIcon, TaskContextMenu } from '@/components/task'
import { useToday } from '@/lib/useToday'
import { cn } from '@/lib/utils'
import { useFilteredTasks } from '@/stores/selectors'
import { useUiStore } from '@/stores/uiStore'

export function CalendarView() {
  const tasks = useFilteredTasks()
  const today = useToday()
  const rows = useMemo(() => filterCalendar(tasks), [tasks])
  return (
    <div className="h-full overflow-auto p-4" data-testid="calendar-view">
      <ul className="flex flex-col gap-1">
        {rows.map((t) => (
          <TaskContextMenu key={t.id} task={t}>
            <li
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-muted/50',
                t.status === 'done' && 'text-muted-foreground line-through opacity-70',
              )}
              onClick={() => useUiStore.getState().selectTask(t.id)}
              data-task-id={t.id}
            >
              <StatusIcon status={t.status} />
              <span className="w-24 text-xs text-muted-foreground tabular-nums">
                {formatShortDate(anchor(t) ?? today, today)}
              </span>
              <span className="flex-1 truncate">{t.title}</span>
            </li>
          </TaskContextMenu>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">No dated tasks.</p>}
    </div>
  )
}
