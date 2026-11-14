import type { Status, Task } from '@shared/types'
import {
  columnDroppableId,
  findContainer,
  isColumnManual,
  moveToContainer,
  nearestDropTarget,
  neighboursOf,
  planDrop,
  reorderWithin,
  statusOfColumnId,
  topOfStatus,
  type ColumnItems,
  type DropContext,
} from './boardDnd'

function task(id: string, status: Status, position: number): Task {
  return {
    id,
    title: id,
    description: '',
    status,
    priority: 2,
    startDate: null,
    dueDate: null,
    position,
    tagIds: [],
    createdAt: 0,
    updatedAt: 0,
    completedAt: status === 'done' ? 1 : null,
  }
}

const items = (partial: Partial<ColumnItems>): ColumnItems => ({
  not_started: [],
  in_progress: [],
  blocked: [],
  done: [],
  ...partial,
})

describe('column ids', () => {
  it('round-trips statuses and rejects task ids', () => {
    expect(statusOfColumnId(columnDroppableId('blocked'))).toBe('blocked')
    expect(statusOfColumnId('column:nope')).toBeNull()
    expect(statusOfColumnId('a1b2')).toBeNull()
  })

  it('finds the container of a task or column id', () => {
    const cols = items({ not_started: ['a'], done: ['b'] })
    expect(findContainer(cols, 'b')).toBe('done')
    expect(findContainer(cols, columnDroppableId('blocked'))).toBe('blocked')
    expect(findContainer(cols, 'zzz')).toBeNull()
  })
})

describe('isColumnManual', () => {
  it('is only manual in Manual sort, and never for Everything › Done', () => {
    expect(isColumnManual('priority', 'today', 'not_started')).toBe(false)
    expect(isColumnManual('manual', 'today', 'done')).toBe(true)
    expect(isColumnManual('manual', 'everything', 'done')).toBe(false)
    expect(isColumnManual('manual', 'everything', 'blocked')).toBe(true)
  })
})

describe('moveToContainer', () => {
  const base = items({ not_started: ['a', 'b'], in_progress: ['x', 'y'] })

  it('inserts above the hovered card', () => {
    const r = moveToContainer(base, 'a', 'not_started', 'in_progress', 'y', false)
    expect(r.not_started).toEqual(['b'])
    expect(r.in_progress).toEqual(['x', 'a', 'y'])
  })

  it('inserts below the hovered card when past its midpoint', () => {
    const r = moveToContainer(base, 'a', 'not_started', 'in_progress', 'y', true)
    expect(r.in_progress).toEqual(['x', 'y', 'a'])
  })

  it('appends when hovering the column itself (incl. empty columns)', () => {
    expect(
      moveToContainer(base, 'a', 'not_started', 'blocked', columnDroppableId('blocked'), false)
        .blocked,
    ).toEqual(['a'])
    expect(
      moveToContainer(base, 'a', 'not_started', 'in_progress', 'column:in_progress', false)
        .in_progress,
    ).toEqual(['x', 'y', 'a'])
  })

  it('is a no-op within the same column', () => {
    expect(moveToContainer(base, 'a', 'not_started', 'not_started', 'b', true)).toBe(base)
  })
})

describe('reorderWithin', () => {
  it('moves down and up like arrayMove', () => {
    expect(reorderWithin(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(reorderWithin(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(reorderWithin(['a', 'b'], 'a', 'zzz')).toEqual(['a', 'b'])
  })
})

describe('neighboursOf', () => {
  it('returns the ids directly above and below', () => {
    expect(neighboursOf(['a', 'b', 'c'], 'b')).toEqual({ beforeId: 'a', afterId: 'c' })
    expect(neighboursOf(['a', 'b'], 'a')).toEqual({ beforeId: null, afterId: 'b' })
    expect(neighboursOf(['a'], 'a')).toEqual({ beforeId: null, afterId: null })
  })

  it('skips invalid (temp) neighbours', () => {
    const valid = (id: string): boolean => !id.startsWith('tmp-')
    expect(neighboursOf(['a', 'tmp-1', 'b', 'tmp-2', 'c'], 'b', valid)).toEqual({
      beforeId: 'a',
      afterId: 'c',
    })
    expect(neighboursOf(['tmp-1', 'b'], 'b', valid)).toEqual({ beforeId: null, afterId: null })
  })
})

describe('topOfStatus', () => {
  it('picks the lowest-position real task in that status', () => {
    const tasks = [
      task('a', 'in_progress', 5),
      task('b', 'in_progress', 2),
      task('tmp-x', 'in_progress', -10),
      task('c', 'blocked', -100),
    ]
    const valid = (id: string): boolean => !id.startsWith('tmp-')
    expect(topOfStatus(tasks, 'in_progress', 'zzz', valid)).toEqual({
      beforeId: null,
      afterId: 'b',
    })
    expect(topOfStatus(tasks, 'in_progress', 'b', valid).afterId).toBe('a')
    expect(topOfStatus(tasks, 'done', 'a')).toEqual({ beforeId: null, afterId: null })
  })
})

describe('planDrop', () => {
  const tasks = [
    task('a', 'not_started', 0),
    task('b', 'not_started', 1),
    task('c', 'not_started', 2),
    task('x', 'in_progress', 0),
    task('y', 'in_progress', 1),
  ]
  const origin = items({ not_started: ['a', 'b', 'c'], in_progress: ['x', 'y'] })
  const ctx = (over: Partial<DropContext>): DropContext => ({
    activeId: 'a',
    originStatus: 'not_started',
    originItems: origin,
    items: origin,
    overStatus: 'not_started',
    overId: 'a',
    sort: 'manual',
    scope: 'today',
    tasks,
    isValid: () => true,
    ...over,
  })

  it('returns null when dropped outside or in the same slot', () => {
    expect(planDrop(ctx({ overStatus: null, overId: null }))).toBeNull()
    expect(planDrop(ctx({}))).toBeNull()
  })

  it('reorders within a column in Manual sort', () => {
    expect(planDrop(ctx({ overId: 'c' }))).toEqual({ beforeId: 'c', afterId: null })
    expect(planDrop(ctx({ activeId: 'c', overId: 'a' }))).toEqual({
      beforeId: null,
      afterId: 'a',
    })
  })

  it('lands at the dropped position in another column in Manual sort', () => {
    const during = moveToContainer(origin, 'a', 'not_started', 'in_progress', 'y', false)
    expect(planDrop(ctx({ items: during, overStatus: 'in_progress', overId: 'a' }))).toEqual({
      status: 'in_progress',
      beforeId: 'x',
      afterId: 'y',
    })
  })

  it('drops into an empty column', () => {
    const during = moveToContainer(origin, 'a', 'not_started', 'blocked', 'column:blocked', false)
    expect(
      planDrop(ctx({ items: during, overStatus: 'blocked', overId: 'column:blocked' })),
    ).toEqual({ status: 'blocked', beforeId: null, afterId: null })
    // …even if the container move never happened (e.g. a very fast drop).
    expect(planDrop(ctx({ overStatus: 'blocked', overId: 'column:blocked' }))).toEqual({
      status: 'blocked',
      beforeId: null,
      afterId: null,
    })
  })

  it('only changes the column in sorted modes, landing at the top of manual order', () => {
    expect(planDrop(ctx({ sort: 'priority', overId: 'c' }))).toBeNull()
    expect(planDrop(ctx({ sort: 'due', overStatus: 'in_progress', overId: 'y' }))).toEqual({
      status: 'in_progress',
      beforeId: null,
      afterId: 'x',
    })
  })

  it('treats Everything › Done as sorted even in Manual', () => {
    expect(
      planDrop(ctx({ scope: 'everything', overStatus: 'done', overId: 'column:done' })),
    ).toEqual({ status: 'done', beforeId: null, afterId: null })
  })
})

describe('nearestDropTarget (drops in the gutters between columns)', () => {
  const col = (status: Status, left: number) => ({
    id: columnDroppableId(status),
    status,
    rect: { left, right: left + 100, top: 0, bottom: 500 },
  })
  const card = (id: string, status: Status, left: number, top: number) => ({
    id,
    status,
    rect: { left: left + 8, right: left + 92, top, bottom: top + 40 },
  })
  const candidates = [
    col('not_started', 0),
    col('in_progress', 112),
    card('a', 'in_progress', 112, 50),
    card('b', 'in_progress', 112, 100),
    col('blocked', 224),
  ]
  const sorted = (): boolean => false
  const manual = (): boolean => true

  it('picks the horizontally nearest column', () => {
    expect(nearestDropTarget({ x: 105, y: 200 }, candidates, sorted)).toBe('column:not_started')
    expect(nearestDropTarget({ x: 107, y: 200 }, candidates, sorted)).toBe('column:in_progress')
    expect(nearestDropTarget({ x: 220, y: 200 }, candidates, sorted)).toBe('column:blocked')
  })

  it('in Manual, the nearest card of that column (else the column itself)', () => {
    expect(nearestDropTarget({ x: 108, y: 60 }, candidates, manual)).toBe('a')
    expect(nearestDropTarget({ x: 108, y: 300 }, candidates, manual)).toBe('b')
    expect(nearestDropTarget({ x: 220, y: 60 }, candidates, manual)).toBe('column:blocked')
  })

  it('no columns: nothing', () => {
    expect(nearestDropTarget({ x: 0, y: 0 }, [], manual)).toBeNull()
  })
})
