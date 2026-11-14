import { BoardView } from '@/features/board/BoardView'
import { CalendarView } from '@/features/calendar/CalendarView'
import { ListView } from '@/features/list/ListView'
import { TimelineView } from '@/features/timeline/TimelineView'
import { useUiStore } from '@/stores/uiStore'

/** Renders the active view. Each view owns its feature folder. */
export function ViewSwitch() {
  const view = useUiStore((s) => s.activeView)
  switch (view) {
    case 'today':
    case 'week':
    case 'everything':
      return <BoardView key={view} scope={view} />
    case 'list':
      return <ListView />
    case 'timeline':
      return <TimelineView />
    case 'calendar':
      return <CalendarView />
  }
}
