import { makeTask } from '@shared/test/factories'
import type { Tag } from '@shared/types'
import {
  adjacentTaskId,
  buildListRows,
  filterByStatus,
  sortListTasks,
  type ListRow,
} from './listModel'

const ids = (tasks: ReadonlyArray<{ id: string }>): string[] => tasks.map((t) => t.id)
const rowKeys = (rows: ListRow[]): string[] => rows.map((r) => r.key)

describe('sortListTasks', () => {
  const openHigh = makeTask({ id: 'openHigh', priority: 3, dueDate: '2026-11-20' })
  const openHighSooner = makeTask({ id: 'openHighSooner', priority: 3, dueDate: '2026-11-14' })
  const openCrit = makeTask({ id: 'openCrit', priority: 4 })
  const openLowNoDue = makeTask({ id: 'openLowNoDue', priority: 1 })
  const doneOld = makeTask({ id: 'doneOld', status: 'done', priority: 4, completedAt: 100 })
  const doneNew = makeTask({ id: 'doneNew', status: 'done', priority: 1, completedAt: 200 })
  const all = [doneOld, openLowNoDue, openHigh, doneNew, openCrit, openHighSooner]

  it('default: open by priority desc then due asc, done last by completed desc', () => {
    expect(ids(sortListTasks(all, null))).toEqual([
      'openCrit',
      'openHighSooner',
      'openHigh',
      'openLowNoDue',
      'doneNew',
      'doneOld',
    ])
  })

  it('sorts priority numerically in both directions', () => {
    const asc = sortListTasks(all, { id: 'priority', desc: false }).map((t) => t.priority)
    expect(asc).toEqual([...asc].sort((a, b) => a - b))
    const desc = sortListTasks(all, { id: 'priority', desc: true }).map((t) => t.priority)
    expect(desc).toEqual([...desc].sort((a, b) => b - a))
  })

  it('keeps empty dates last in both directions', () => {
    const asc = ids(sortListTasks(all, { id: 'dueDate', desc: false }))
    expect(asc.slice(0, 2)).toEqual(['openHighSooner', 'openHigh'])
    const desc = ids(sortListTasks(all, { id: 'dueDate', desc: true }))
    expect(desc.slice(0, 2)).toEqual(['openHigh', 'openHighSooner'])
    // The undated rest keep the default order in both directions.
    expect(asc.slice(2)).toEqual(['openCrit', 'openLowNoDue', 'doneNew', 'doneOld'])
    expect(desc.slice(2)).toEqual(asc.slice(2))
  })

  it('sorts completed with not-completed last both ways', () => {
    expect(ids(sortListTasks(all, { id: 'completedAt', desc: true })).slice(0, 2)).toEqual([
      'doneNew',
      'doneOld',
    ])
    expect(ids(sortListTasks(all, { id: 'completedAt', desc: false })).slice(0, 2)).toEqual([
      'doneOld',
      'doneNew',
    ])
  })

  it('sorts title case-insensitively and status by workflow order', () => {
    const a = makeTask({ id: 'a', title: 'banana', status: 'blocked' })
    const b = makeTask({ id: 'b', title: 'Apple', status: 'in_progress' })
    const c = makeTask({ id: 'c', title: 'cherry', status: 'not_started' })
    expect(ids(sortListTasks([a, b, c], { id: 'title', desc: false }))).toEqual(['b', 'a', 'c'])
    expect(ids(sortListTasks([a, b, c], { id: 'status', desc: false }))).toEqual(['c', 'b', 'a'])
    expect(ids(sortListTasks([a, b, c], { id: 'status', desc: true }))).toEqual(['a', 'b', 'c'])
  })

  it('sorts tags by tag name, untagged last', () => {
    const tags: Record<string, Tag> = {
      w: { id: 'w', name: 'work', color: 'blue', createdAt: 0 },
      h: { id: 'h', name: 'home', color: 'green', createdAt: 0 },
    }
    const work = makeTask({ id: 'work', tagIds: ['w'] })
    const home = makeTask({ id: 'home', tagIds: ['h'] })
    const none = makeTask({ id: 'none' })
    expect(ids(sortListTasks([none, work, home], { id: 'tags', desc: false }, tags))).toEqual([
      'home',
      'work',
      'none',
    ])
    expect(ids(sortListTasks([none, work, home], { id: 'tags', desc: true }, tags))).toEqual([
      'work',
      'home',
      'none',
    ])
  })

  it('does not mutate its input', () => {
    const input = [openLowNoDue, openCrit]
    sortListTasks(input, null)
    expect(ids(input)).toEqual(['openLowNoDue', 'openCrit'])
  })
})

describe('filterByStatus', () => {
  it('keeps only the chosen statuses', () => {
    const a = makeTask({ id: 'a', status: 'done' })
    const b = makeTask({ id: 'b', status: 'blocked' })
    expect(ids(filterByStatus([a, b], ['blocked']))).toEqual(['b'])
    expect(ids(filterByStatus([a, b], ['not_started', 'in_progress', 'blocked', 'done']))).toEqual([
      'a',
      'b',
    ])
    expect(filterByStatus([a, b], [])).toEqual([])
  })
})

describe('buildListRows', () => {
  const a = makeTask({ id: 'a', status: 'done', priority: 1 })
  const b = makeTask({ id: 'b', status: 'not_started', priority: 4 })
  const c = makeTask({ id: 'c', status: 'not_started', priority: 1 })

  it('is flat without grouping', () => {
    expect(rowKeys(buildListRows([a, b, c], 'none'))).toEqual(['a', 'b', 'c'])
  })

  it('groups by status in workflow order, skipping empty groups, with counts', () => {
    const rows = buildListRows([a, b, c], 'status')
    expect(rowKeys(rows)).toEqual(['status:not_started', 'b', 'c', 'status:done', 'a'])
    expect(rows[0]).toMatchObject({ type: 'group', label: 'Not Started', count: 2 })
  })

  it('groups by priority high → low', () => {
    expect(rowKeys(buildListRows([a, b, c], 'priority'))).toEqual([
      'priority:4',
      'b',
      'priority:1',
      'a',
      'c',
    ])
  })

  it('collapses groups but keeps their header and count', () => {
    const rows = buildListRows([a, b, c], 'status', new Set(['status:not_started']))
    expect(rowKeys(rows)).toEqual(['status:not_started', 'status:done', 'a'])
    expect(rows[0]).toMatchObject({ collapsed: true, count: 2 })
  })
})

describe('adjacentTaskId', () => {
  const rows = buildListRows(
    [makeTask({ id: 'x', status: 'blocked' }), makeTask({ id: 'y' }), makeTask({ id: 'z' })],
    'status',
  )

  it('skips group headers and clamps at the ends', () => {
    expect(adjacentTaskId(rows, null, 1)).toBe('y')
    expect(adjacentTaskId(rows, null, -1)).toBe('x')
    expect(adjacentTaskId(rows, 'z', 1)).toBe('x')
    expect(adjacentTaskId(rows, 'x', 1)).toBe('x')
    expect(adjacentTaskId(rows, 'y', -1)).toBe('y')
    expect(adjacentTaskId([], 'y', 1)).toBeNull()
  })
})
