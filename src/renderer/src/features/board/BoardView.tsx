// Kanban board for the Today / This Week / Everything views (spec §6 "Board (Kanban)").
import { DndContext, DragOverlay, MeasuringStrategy, type DropAnimation } from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { STATUSES } from '@shared/constants'
import type { BoardScope, Status, Task } from '@shared/types'
import { boardColumns } from '@shared/views'
import { ToolbarControls } from '@/app/ToolbarControls'
import { useToday } from '@/lib/useToday'
import { useFilteredTasks, useIsFilterActive, useSettings } from '@/stores/selectors'
import { useUiStore } from '@/stores/uiStore'
import { CardBody } from './BoardCard'
import { BoardColumn } from './BoardColumn'
import { BoardSortControl } from './BoardSortControl'
import { DONE_PAGE_SIZE, isColumnManual } from './boardDnd'
import { InlineAddTask } from './InlineAddTask'
import { useBoardDnd } from './useBoardDnd'

export interface BoardViewProps {
  scope: BoardScope
}

const DONE_EMPTY: Record<BoardScope, string> = {
  today: 'Nothing finished today yet',
  week: 'Nothing finished this week yet',
  everything: 'Nothing finished yet',
}

function emptyText(status: Status, scope: BoardScope, filtered: boolean): string {
  if (filtered) return 'No matching tasks'
  switch (status) {
    case 'not_started':
      return scope === 'today' ? 'Nothing left for today' : 'Nothing waiting to start'
    case 'in_progress':
      return 'Nothing in progress'
    case 'blocked':
      return 'Nothing blocked'
    case 'done':
      return DONE_EMPTY[scope]
  }
}

const dropAnimation: DropAnimation = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }

// Columns change size while a card hops between them; keep droppable rects fresh.
const measuring = { droppable: { strategy: MeasuringStrategy.Always } }

export function BoardView({ scope }: BoardViewProps) {
  const tasks = useFilteredTasks()
  const today = useToday()
  const settings = useSettings()
  const filtered = useIsFilterActive()
  const sort = settings.boardSort[scope]
  const columns = useMemo(
    () => boardColumns(scope, tasks, today, settings, sort),
    [scope, tasks, today, settings, sort],
  )

  // Done pages in 50 at a time (no virtualization on boards).
  const [doneLimit, setDoneLimit] = useState(DONE_PAGE_SIZE)
  const visible = useMemo<Record<Status, Task[]>>(
    () => ({ ...columns, done: columns.done.slice(0, doneLimit) }),
    [columns, doneLimit],
  )

  const dnd = useBoardDnd(scope, sort, visible)
  const selectedId = useUiStore((s) => s.selectedTaskId)
  const dragging = dnd.activeTask !== null
  const hiddenDone = columns.done.length - visible.done.length
  const filteredAway = filtered && STATUSES.every((s) => columns[s].length === 0)

  return (
    <DndContext {...dnd.dndContextProps} measuring={measuring}>
      <ToolbarControls>
        <BoardSortControl scope={scope} sort={sort} />
      </ToolbarControls>

      <div
        className="flex h-full scrollbar-thin gap-3 overflow-x-auto p-4"
        data-testid={`board-${scope}`}
        data-sort={sort}
      >
        {STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={dnd.columns[status]}
            total={status === 'done' ? columns.done.length : columns[status].length}
            manual={isColumnManual(sort, scope, status)}
            dropTarget={dragging && dnd.overStatus === status && dnd.originStatus !== status}
            dragging={dragging}
            emptyText={
              filteredAway && status === 'not_started'
                ? 'Nothing on this board matches the filter'
                : emptyText(status, scope, filtered)
            }
            header={status === 'not_started' ? <InlineAddTask scope={scope} /> : undefined}
            footer={
              status === 'not_started' && filteredAway ? (
                <button
                  type="button"
                  onClick={() => useUiStore.getState().clearFilter()}
                  className="self-start rounded-sm px-1 text-xs text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Clear filters
                </button>
              ) : status === 'done' && hiddenDone > 0 ? (
                <button
                  type="button"
                  onClick={() => setDoneLimit((n) => n + DONE_PAGE_SIZE)}
                  className="mt-0.5 h-8 shrink-0 rounded-md text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Show {Math.min(DONE_PAGE_SIZE, hiddenDone)} more
                  <span className="text-muted-foreground/70"> · {hiddenDone} older</span>
                </button>
              ) : undefined
            }
          />
        ))}
      </div>

      <DragOverlay dropAnimation={dropAnimation} className="board-drag-overlay">
        {dnd.activeTask && (
          <CardBody task={dnd.activeTask} selected={dnd.activeTask.id === selectedId} overlay />
        )}
      </DragOverlay>
    </DndContext>
  )
}
