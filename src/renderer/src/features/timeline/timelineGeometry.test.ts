import { localMs, makeTask } from '@shared/test/factories'
import type { Task } from '@shared/types'
import {
  applyDrag,
  barRect,
  buildTimelineRange,
  DAY_WIDTH,
  dragModes,
  dateToX,
  datesPatch,
  formatSpan,
  headerTiers,
  MIN_BAR_WIDTH,
  monthStarts,
  pxToDays,
  rebaseScrollLeft,
  scrollLeftFor,
  visualSpan,
  weekendOffsetDays,
  weekStartOffsetDays,
  xToDate,
  type DateRange,
} from './timelineGeometry'

const TODAY = '2026-11-13' // a Friday
const RANGE: DateRange = { start: '2026-11-06', end: '2027-01-08' }
/** A range containing both 2026 fall-back (Nov 1) and 2027 spring-forward (Mar 14). */
const DST_RANGE: DateRange = { start: '2026-10-20', end: '2027-04-01' }

/** A not_started task with just this plan. */
function plan(dates: Pick<Task, 'startDate' | 'dueDate'>): Task {
  return makeTask(dates)
}

describe('buildTimelineRange', () => {
  it('starts a week before today and spans at least 6 weeks + padding', () => {
    const r = buildTimelineRange([], TODAY)
    expect(r.start).toBe('2026-11-06')
    expect(r.end).toBe('2027-01-08') // today + 42 + 14
  })

  it('extends to the latest task date plus padding', () => {
    const r = buildTimelineRange([makeTask({ dueDate: '2027-03-01' })], TODAY, { padDays: 7 })
    expect(r.end).toBe('2027-03-08')
  })

  it('never moves the start for ancient planned tasks', () => {
    const r = buildTimelineRange([makeTask({ dueDate: '2020-01-01' })], TODAY)
    expect(r.start).toBe('2026-11-06')
  })

  it('reaches back to where started work actually began', () => {
    const t = makeTask({ status: 'blocked', startedAt: localMs(2026, 10, 30) })
    expect(buildTimelineRange([t], TODAY).start).toBe('2026-10-30')
  })

  it('fills a minimum number of columns', () => {
    const r = buildTimelineRange([], TODAY, { padDays: 0, minDays: 200 })
    expect(r.end).toBe('2027-05-24')
  })
})

describe('date ↔ x', () => {
  it('maps dates to column offsets and back', () => {
    expect(dateToX('2026-11-06', RANGE.start, 40)).toBe(0)
    expect(dateToX('2026-11-13', RANGE.start, 40)).toBe(280)
    expect(dateToX('2026-11-01', RANGE.start, 40)).toBe(-200)
    expect(xToDate(0, RANGE.start, 40)).toBe('2026-11-06')
    expect(xToDate(279, RANGE.start, 40)).toBe('2026-11-12')
    expect(xToDate(280, RANGE.start, 40)).toBe('2026-11-13')
  })

  it('is exact across the DST change (America/New_York, Nov 1 2026 / Mar 14 2027)', () => {
    expect(dateToX('2026-11-02', '2026-10-30', 10)).toBe(30)
    expect(xToDate(30, '2026-10-30', 10)).toBe('2026-11-02')
    expect(dateToX('2027-03-16', '2027-03-12', 10)).toBe(40)
  })

  it('rounds pixel deltas to whole days without -0', () => {
    expect(pxToDays(19, 40)).toBe(0)
    expect(Object.is(pxToDays(-5, 40), 0)).toBe(true)
    expect(pxToDays(21, 40)).toBe(1)
    expect(pxToDays(-61, 40)).toBe(-2)
  })
})

describe('visualSpan / barRect', () => {
  it('draws a single-date task as a one-day bar', () => {
    const r = barRect(plan({ startDate: null, dueDate: '2026-11-13' }), RANGE, 40, TODAY)
    expect(r).toMatchObject({ start: '2026-11-13', end: '2026-11-13', clampedStart: false })
    expect(r?.left).toBe(283)
    expect(r?.width).toBe(34)
    const s = barRect(plan({ startDate: '2026-11-13', dueDate: null }), RANGE, 40, TODAY)
    expect(s?.left).toBe(283)
  })

  it('spans start → due inclusive', () => {
    const r = barRect(plan({ startDate: '2026-11-10', dueDate: '2026-11-12' }), RANGE, 40, TODAY)
    expect(r?.left).toBe(4 * 40 + 3)
    expect(r?.width).toBe(3 * 40 - 6)
  })

  it('returns null for undated tasks', () => {
    expect(barRect(plan({ startDate: null, dueDate: null }), RANGE, 40, TODAY)).toBeNull()
  })

  it('clamps a task entirely before the range to a stub at the left edge', () => {
    const r = barRect(plan({ startDate: '2026-09-01', dueDate: '2026-10-02' }), RANGE, 40, TODAY)
    expect(r).toMatchObject({ beforeRange: true, clampedStart: true, left: 0 })
    expect(r?.width).toBe(37)
    expect(r?.span).toEqual({ start: '2026-09-01', end: '2026-10-02' })
  })

  it('pins a task that starts before the range to the left edge but keeps its end', () => {
    const v = visualSpan({ start: '2026-11-01', end: '2026-11-08' }, RANGE)
    expect(v).toMatchObject({
      start: '2026-11-06',
      end: '2026-11-08',
      clampedStart: true,
      beforeRange: false,
    })
    const r = barRect(plan({ startDate: '2026-11-01', dueDate: '2026-11-08' }), RANGE, 40, TODAY)
    expect(r?.left).toBe(0)
    expect(r?.width).toBe(3 * 40 - 3)
  })

  it('enforces a minimum width at Month zoom', () => {
    const r = barRect(
      plan({ startDate: null, dueDate: '2026-11-13' }),
      RANGE,
      DAY_WIDTH.month,
      TODAY,
    )
    expect(r?.width).toBe(MIN_BAR_WIDTH)
    // Centred on its column.
    expect(r?.left).toBe(7 * 6 - 1)
  })

  it('pins the right edge when a preview runs past the range end', () => {
    const r = barRect(plan({ startDate: '2027-01-07', dueDate: '2027-01-20' }), RANGE, 10, TODAY)
    expect(r?.clampedEnd).toBe(true)
    expect((r?.left ?? 0) + (r?.width ?? 0)).toBe(64 * 10)
  })
})

describe('barRect — display span per status', () => {
  const started = (d: number, h = 9): number => localMs(2026, 11, d, h)

  it('draws an undated in-progress task from its start to today, open-ended', () => {
    const t = makeTask({ status: 'in_progress', startedAt: started(10) })
    const r = barRect(t, RANGE, 40, TODAY)
    expect(r).toMatchObject({
      start: '2026-11-10',
      end: '2026-11-13',
      span: { start: '2026-11-10', end: '2026-11-13' },
      source: 'actual',
      ongoing: true,
      openEnded: true,
      clampedEnd: false,
    })
    // Flush to the end of today's column ("still going"), not inset.
    expect(r?.left).toBe(4 * 40 + 3)
    expect((r?.left ?? 0) + (r?.width ?? 0)).toBe(8 * 40)
    expect(r?.elapsedWidth).toBe(r?.width)
  })

  it('ignores the planned start once a task has really started', () => {
    const t = makeTask({ status: 'in_progress', startDate: '2026-11-01', startedAt: started(10) })
    expect(barRect(t, RANGE, 40, TODAY)?.span.start).toBe('2026-11-10')
  })

  it('continues to a future due date; the elapsed part ends with today', () => {
    const t = makeTask({ status: 'in_progress', dueDate: '2026-11-16', startedAt: started(10) })
    const r = barRect(t, RANGE, 40, TODAY)
    expect(r).toMatchObject({ end: '2026-11-16', ongoing: true, openEnded: false })
    expect(r?.left).toBe(163)
    expect(r?.width).toBe(11 * 40 - 3 - 163)
    expect(r?.elapsedWidth).toBe(8 * 40 - 163)
  })

  it('treats an overdue in-progress task as still going (ends today, flat edge)', () => {
    const t = makeTask({ status: 'in_progress', dueDate: '2026-11-11', startedAt: started(10) })
    const r = barRect(t, RANGE, 40, TODAY)
    expect(r).toMatchObject({ end: '2026-11-13', openEnded: true })
    expect(r?.elapsedWidth).toBe(r?.width)
  })

  it('a task due today ends today with a normal (inset) edge, fully elapsed', () => {
    const t = makeTask({ status: 'in_progress', dueDate: TODAY, startedAt: started(10) })
    const r = barRect(t, RANGE, 40, TODAY)
    expect(r).toMatchObject({ end: TODAY, openEnded: false })
    expect((r?.left ?? 0) + (r?.width ?? 0)).toBe(8 * 40 - 3)
    expect(r?.elapsedWidth).toBe(r?.width)
  })

  it('draws blocked exactly like in progress', () => {
    const base = { dueDate: '2026-11-16', startedAt: started(10) }
    const ip = barRect(makeTask({ ...base, status: 'in_progress' }), RANGE, 40, TODAY)
    const bl = barRect(makeTask({ ...base, status: 'blocked' }), RANGE, 40, TODAY)
    expect(bl).toEqual(ip)
  })

  it('pins an ongoing bar that started before the range; elapsed runs from the edge', () => {
    const t = makeTask({ status: 'blocked', dueDate: '2026-11-16', startedAt: localMs(2026, 9, 1) })
    const r = barRect(t, RANGE, 40, TODAY)
    expect(r).toMatchObject({ clampedStart: true, beforeRange: false, start: RANGE.start })
    expect(r?.span.start).toBe('2026-09-01')
    expect(r?.left).toBe(0)
    expect(r?.elapsedWidth).toBe(8 * 40)
  })

  it('keeps the elapsed part whole when Month zoom widens a one-day bar', () => {
    const t = makeTask({ status: 'in_progress', startedAt: localMs(2026, 11, 13, 8) })
    const r = barRect(t, RANGE, DAY_WIDTH.month, TODAY)
    expect(r?.width).toBe(MIN_BAR_WIDTH)
    expect(r?.elapsedWidth).toBe(MIN_BAR_WIDTH)
  })

  it('draws a done task from when it started to when it was completed', () => {
    const t = makeTask({
      status: 'done',
      dueDate: '2026-11-30',
      startedAt: started(8),
      completedAt: started(10, 17),
    })
    const r = barRect(t, RANGE, 40, TODAY)
    expect(r).toMatchObject({
      start: '2026-11-08',
      end: '2026-11-10',
      source: 'actual',
      ongoing: false,
      openEnded: false,
      elapsedWidth: null,
    })
    expect(r?.left).toBe(2 * 40 + 3)
    expect(r?.width).toBe(3 * 40 - 6)
  })

  it('draws a same-instant done task as one day', () => {
    const t = makeTask({ status: 'done', startedAt: started(12), completedAt: started(12) })
    expect(barRect(t, RANGE, 40, TODAY)).toMatchObject({ start: '2026-11-12', end: '2026-11-12' })
  })

  it('falls back for a legacy started task without startedAt (creation time)', () => {
    const t = makeTask({ status: 'in_progress', startedAt: null, createdAt: started(9) })
    expect(barRect(t, RANGE, 40, TODAY)?.span).toEqual({ start: '2026-11-09', end: TODAY })
  })

  it('a planned bar has no elapsed part', () => {
    const r = barRect(plan({ startDate: '2026-11-10', dueDate: '2026-11-20' }), RANGE, 40, TODAY)
    expect(r).toMatchObject({ source: 'planned', ongoing: false, openEnded: false })
    expect(r?.elapsedWidth).toBeNull()
  })

  it('follows previewed dates: the plan for not_started, the due date for started', () => {
    const p = plan({ startDate: '2026-11-10', dueDate: '2026-11-12' })
    expect(
      barRect({ ...p, startDate: '2026-11-14', dueDate: '2026-11-16' }, RANGE, 40, TODAY)?.span,
    ).toEqual({ start: '2026-11-14', end: '2026-11-16' })
    const t = makeTask({ status: 'in_progress', startedAt: started(10) })
    const r = barRect({ ...t, dueDate: '2026-11-20' }, RANGE, 40, TODAY)
    expect(r?.span).toEqual({ start: '2026-11-10', end: '2026-11-20' })
    expect(r?.elapsedWidth).toBe(8 * 40 - 163)
  })
})

describe('applyDrag — move', () => {
  it('shifts both dates, preserving duration', () => {
    expect(applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-12' }, 'move', 3, RANGE)).toEqual(
      { startDate: '2026-11-13', dueDate: '2026-11-15' },
    )
    expect(
      applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-12' }, 'move', -2, RANGE),
    ).toEqual({ startDate: '2026-11-08', dueDate: '2026-11-10' })
  })

  it('moves the single date of a single-date task', () => {
    expect(applyDrag({ startDate: null, dueDate: '2026-11-13' }, 'move', 2, RANGE)).toEqual({
      startDate: null,
      dueDate: '2026-11-15',
    })
    expect(applyDrag({ startDate: '2026-11-13', dueDate: null }, 'move', -1, RANGE)).toEqual({
      startDate: '2026-11-12',
      dueDate: null,
    })
  })

  it('returns the same object for a zero delta', () => {
    const d = { startDate: '2026-09-01', dueDate: '2026-10-02' }
    expect(applyDrag(d, 'move', 0, RANGE)).toBe(d)
  })

  it('crosses DST without drifting', () => {
    expect(
      applyDrag({ startDate: '2026-10-30', dueDate: '2026-11-02' }, 'move', 7, DST_RANGE),
    ).toEqual({ startDate: '2026-11-06', dueDate: '2026-11-09' })
    expect(applyDrag({ startDate: null, dueDate: '2027-03-13' }, 'move', 1, DST_RANGE)).toEqual({
      startDate: null,
      dueDate: '2027-03-14',
    })
  })

  it('moves a pre-range task relative to its drawn stub, bringing it into range', () => {
    // Stub sits on 2026-11-06; dropping it 4 days right puts the due date on 2026-11-10.
    expect(applyDrag({ startDate: null, dueDate: '2026-10-02' }, 'move', 4, RANGE)).toEqual({
      startDate: null,
      dueDate: '2026-11-10',
    })
    // Duration preserved (3 days).
    expect(applyDrag({ startDate: '2026-09-30', dueDate: '2026-10-02' }, 'move', 4, RANGE)).toEqual(
      { startDate: '2026-11-08', dueDate: '2026-11-10' },
    )
  })

  it('treats a pre-range move that stays before the range as a no-op', () => {
    const d = { startDate: null, dueDate: '2026-10-02' }
    expect(applyDrag(d, 'move', -3, RANGE)).toBe(d)
  })

  it('moves a partially clamped task by its real dates', () => {
    expect(applyDrag({ startDate: '2026-11-01', dueDate: '2026-11-08' }, 'move', 2, RANGE)).toEqual(
      { startDate: '2026-11-03', dueDate: '2026-11-10' },
    )
  })
})

describe('applyDrag — resize', () => {
  it('moves the due date with the right edge', () => {
    expect(applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-12' }, 'end', 2, RANGE)).toEqual({
      startDate: '2026-11-10',
      dueDate: '2026-11-14',
    })
  })

  it('moves the start date with the left edge', () => {
    expect(
      applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-12' }, 'start', -3, RANGE),
    ).toEqual({ startDate: '2026-11-07', dueDate: '2026-11-12' })
  })

  it('never lets start pass due (or due pass start)', () => {
    expect(applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-12' }, 'end', -9, RANGE)).toEqual(
      { startDate: '2026-11-10', dueDate: '2026-11-10' },
    )
    expect(
      applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-12' }, 'start', 9, RANGE),
    ).toEqual({ startDate: '2026-11-12', dueDate: '2026-11-12' })
  })

  it('turns a due-only task into a range; the existing date stays as the other end', () => {
    expect(applyDrag({ startDate: null, dueDate: '2026-11-13' }, 'end', 3, RANGE)).toEqual({
      startDate: '2026-11-13',
      dueDate: '2026-11-16',
    })
    expect(applyDrag({ startDate: null, dueDate: '2026-11-13' }, 'start', -2, RANGE)).toEqual({
      startDate: '2026-11-11',
      dueDate: '2026-11-13',
    })
  })

  it('turns a start-only task into a range', () => {
    expect(applyDrag({ startDate: '2026-11-13', dueDate: null }, 'end', 1, RANGE)).toEqual({
      startDate: '2026-11-13',
      dueDate: '2026-11-14',
    })
    expect(applyDrag({ startDate: '2026-11-13', dueDate: null }, 'start', -1, RANGE)).toEqual({
      startDate: '2026-11-12',
      dueDate: '2026-11-13',
    })
  })

  it('leaves a single-date task untouched when resized against itself', () => {
    const d = { startDate: null, dueDate: '2026-11-13' }
    expect(applyDrag(d, 'end', -4, RANGE)).toBe(d)
    expect(applyDrag(d, 'start', 4, RANGE)).toBe(d)
  })

  it('resizes across DST in whole days', () => {
    expect(
      applyDrag({ startDate: '2026-10-29', dueDate: '2026-10-31' }, 'end', 3, DST_RANGE),
    ).toEqual({ startDate: '2026-10-29', dueDate: '2026-11-03' })
    expect(
      applyDrag({ startDate: '2027-03-12', dueDate: '2027-03-16' }, 'start', 3, DST_RANGE),
    ).toEqual({ startDate: '2027-03-15', dueDate: '2027-03-16' })
  })

  it('extends a pre-range task from its stub, keeping the real start', () => {
    expect(applyDrag({ startDate: null, dueDate: '2026-10-02' }, 'end', 5, RANGE)).toEqual({
      startDate: '2026-10-02',
      dueDate: '2026-11-11',
    })
    const d = { startDate: null, dueDate: '2026-10-02' }
    expect(applyDrag(d, 'end', -2, RANGE)).toBe(d)
    expect(applyDrag(d, 'start', 2, RANGE)).toBe(d)
  })

  it('resizes the clamped left edge of a partially clamped task from the drawn edge', () => {
    expect(
      applyDrag({ startDate: '2026-11-01', dueDate: '2026-11-12' }, 'start', 2, RANGE),
    ).toEqual({ startDate: '2026-11-08', dueDate: '2026-11-12' })
  })
})

describe('dragModes', () => {
  it('lets planned bars move and resize, started bars resize their end, done bars nothing', () => {
    expect(dragModes('not_started')).toEqual(['move', 'start', 'end'])
    expect(dragModes('in_progress')).toEqual(['end'])
    expect(dragModes('blocked')).toEqual(['end'])
    expect(dragModes('done')).toEqual([])
  })
})

describe('applyDrag — started and done tasks', () => {
  const STARTED = '2026-11-09'
  const IP = { status: 'in_progress', today: TODAY, startedOn: STARTED } as const
  const BL = { status: 'blocked', today: TODAY, startedOn: STARTED } as const

  it('sets the due date to the new drawn end', () => {
    expect(applyDrag({ startDate: null, dueDate: '2026-11-16' }, 'end', 2, RANGE, IP)).toEqual({
      startDate: null,
      dueDate: '2026-11-18',
    })
    expect(applyDrag({ startDate: null, dueDate: '2026-11-16' }, 'end', -2, RANGE, BL)).toEqual({
      startDate: null,
      dueDate: '2026-11-14',
    })
  })

  it('gives an undated (open-ended) task a due date from today onwards', () => {
    expect(applyDrag({ startDate: null, dueDate: null }, 'end', 3, RANGE, IP)).toEqual({
      startDate: null,
      dueDate: '2026-11-16',
    })
  })

  it('never ends before today', () => {
    expect(applyDrag({ startDate: null, dueDate: '2026-11-16' }, 'end', -9, RANGE, IP)).toEqual({
      startDate: null,
      dueDate: TODAY,
    })
  })

  describe('a planned start in the future (started early)', () => {
    // Today Nov 13, planned to start Nov 15, really started Nov 9.
    it('dragging the end to before it moves the planned start to the actual start', () => {
      expect(applyDrag({ startDate: '2026-11-15', dueDate: null }, 'end', 1, RANGE, IP)).toEqual({
        startDate: STARTED,
        dueDate: '2026-11-14',
      })
      const d = { startDate: '2026-11-15', dueDate: '2026-11-20' }
      expect(applyDrag(d, 'end', -9, RANGE, IP)).toEqual({ startDate: STARTED, dueDate: TODAY })
      expect(datesPatch(d, applyDrag(d, 'end', -9, RANGE, IP))).toEqual({
        startDate: STARTED,
        dueDate: TODAY,
      })
    })

    it('dragging the end past it only sets the due date', () => {
      const d = { startDate: '2026-11-15', dueDate: null }
      const next = applyDrag(d, 'end', 4, RANGE, IP)
      expect(next).toEqual({ startDate: '2026-11-15', dueDate: '2026-11-17' })
      expect(datesPatch(d, next)).toEqual({ dueDate: '2026-11-17' })
      // Exactly onto the planned start: still valid (start <= due), start kept.
      expect(applyDrag(d, 'end', 2, RANGE, IP)).toEqual({
        startDate: '2026-11-15',
        dueDate: '2026-11-15',
      })
    })

    it('a zero-change drag is a no-op', () => {
      const d = { startDate: '2026-11-15', dueDate: '2026-11-20' }
      expect(applyDrag(d, 'end', 0, RANGE, IP)).toBe(d)
    })

    it('clamps the moved start to the new due date', () => {
      // A clock / time-zone oddity: startedOn after today.
      const ctx = { ...IP, startedOn: '2026-11-16' }
      expect(applyDrag({ startDate: '2026-11-20', dueDate: null }, 'end', 1, RANGE, ctx)).toEqual({
        startDate: '2026-11-14',
        dueDate: '2026-11-14',
      })
    })
  })

  it('without a planned start, only the due date changes', () => {
    const d = { startDate: null, dueDate: '2026-11-20' }
    expect(datesPatch(d, applyDrag(d, 'end', -3, RANGE, BL))).toEqual({ dueDate: '2026-11-17' })
  })

  it('keeps a planned start that is already in the past', () => {
    expect(
      applyDrag({ startDate: '2026-11-10', dueDate: '2026-11-20' }, 'end', -9, RANGE, IP),
    ).toEqual({ startDate: '2026-11-10', dueDate: TODAY })
  })

  it('is a no-op when the clamped drawn end does not change', () => {
    const open = { startDate: null, dueDate: null }
    expect(applyDrag(open, 'end', -3, RANGE, IP)).toBe(open)
    // Overdue: drawn to today; pulling left does not rewrite the overdue due date.
    const overdue = { startDate: null, dueDate: '2026-11-10' }
    expect(applyDrag(overdue, 'end', -1, RANGE, BL)).toBe(overdue)
    expect(applyDrag(overdue, 'end', 2, RANGE, BL)).toEqual({
      startDate: null,
      dueDate: '2026-11-15',
    })
    const d = { startDate: null, dueDate: '2026-11-16' }
    expect(applyDrag(d, 'end', 0, RANGE, IP)).toBe(d)
  })

  it('does not move or resize the start of a started bar', () => {
    const d = { startDate: '2026-11-10', dueDate: '2026-11-16' }
    expect(applyDrag(d, 'move', 3, RANGE, IP)).toBe(d)
    expect(applyDrag(d, 'start', -2, RANGE, BL)).toBe(d)
  })

  it('never changes a done task', () => {
    const d = { startDate: '2026-11-10', dueDate: '2026-11-16' }
    const ctx = { status: 'done', today: TODAY, startedOn: STARTED } as const
    for (const mode of ['move', 'start', 'end'] as const) {
      expect(applyDrag(d, mode, 2, RANGE, ctx)).toBe(d)
    }
  })

  it('treats a not_started context like no context', () => {
    const d = { startDate: '2026-11-10', dueDate: '2026-11-12' }
    const ctx = { status: 'not_started', today: TODAY, startedOn: null } as const
    expect(applyDrag(d, 'move', 3, RANGE, ctx)).toEqual(applyDrag(d, 'move', 3, RANGE))
    expect(applyDrag(d, 'start', -1, RANGE, ctx)).toEqual(applyDrag(d, 'start', -1, RANGE))
  })
})

describe('rebaseScrollLeft', () => {
  it('keeps the left-edge date when the range start moves back or forward', () => {
    // 10.5 days into a range from Nov 6 = Nov 16 (+ half a day) at the left edge.
    const from = { start: '2026-11-06', dayWidth: 40 }
    expect(rebaseScrollLeft(420, from, { start: '2026-10-27', dayWidth: 40 })).toBe(820)
    expect(rebaseScrollLeft(820, { start: '2026-10-27', dayWidth: 40 }, from)).toBe(420)
    expect(rebaseScrollLeft(420, from, from)).toBe(420)
  })

  it('keeps the left-edge date across a zoom change and a start move together', () => {
    // Day (40) → Week (16) while the start moves back 10 days: (10.5 + 10) * 16.
    expect(
      rebaseScrollLeft(
        420,
        { start: '2026-11-06', dayWidth: 40 },
        { start: '2026-10-27', dayWidth: 16 },
      ),
    ).toBe(328)
  })

  it('counts calendar days across DST changes', () => {
    expect(
      rebaseScrollLeft(
        0,
        { start: '2026-11-02', dayWidth: 40 },
        { start: '2026-10-26', dayWidth: 40 },
      ),
    ).toBe(7 * 40)
    expect(
      rebaseScrollLeft(
        0,
        { start: '2027-03-15', dayWidth: 40 },
        { start: '2027-03-08', dayWidth: 40 },
      ),
    ).toBe(7 * 40)
  })
})

describe('datesPatch', () => {
  it('only includes changed fields', () => {
    expect(
      datesPatch(
        { startDate: null, dueDate: '2026-11-13' },
        { startDate: null, dueDate: '2026-11-14' },
      ),
    ).toEqual({ dueDate: '2026-11-14' })
    expect(
      datesPatch(
        { startDate: null, dueDate: '2026-11-13' },
        { startDate: '2026-11-13', dueDate: '2026-11-16' },
      ),
    ).toEqual({ startDate: '2026-11-13', dueDate: '2026-11-16' })
    expect(
      datesPatch(
        { startDate: null, dueDate: '2026-11-13' },
        { startDate: null, dueDate: '2026-11-13' },
      ),
    ).toBeNull()
  })
})

describe('header + grid', () => {
  it('builds month / day tiers at Day zoom', () => {
    const { top, bottom } = headerTiers({ start: '2026-11-28', end: '2026-12-02' }, 'day', TODAY, 1)
    expect(top.map((c) => c.label)).toEqual(['Nov 2026', 'Dec 2026'])
    expect(top.map((c) => c.width)).toEqual([3 * 40, 2 * 40])
    expect(bottom.map((c) => `${c.sub ?? ''} ${c.label}`)).toEqual([
      'Sa 28',
      'Su 29',
      'Mo 30',
      'Tu 1',
      'We 2',
    ])
    expect(bottom.filter((c) => c.weekend).map((c) => c.label)).toEqual(['28', '29'])
  })

  it('labels full calendar weeks at Week zoom even when the range cuts them', () => {
    const { bottom } = headerTiers({ start: '2026-11-06', end: '2026-11-20' }, 'week', TODAY, 1)
    expect(bottom.map((c) => c.label)).toEqual(['2 – 8', '9 – 15', '16 – 22'])
    expect(bottom.map((c) => c.width)).toEqual([3 * 18, 7 * 18, 5 * 18])
    expect(bottom.find((c) => c.today)?.label).toBe('9 – 15')
    const sun = headerTiers({ start: '2026-11-06', end: '2026-11-20' }, 'week', TODAY, 0)
    expect(sun.bottom.map((c) => c.label)).toEqual(['1 – 7', '8 – 14', '15 – 21'])
  })

  it('builds year / month tiers at Month zoom', () => {
    const { top, bottom } = headerTiers(
      { start: '2026-11-06', end: '2027-02-10' },
      'month',
      TODAY,
      1,
    )
    expect(top.map((c) => c.label)).toEqual(['2026', '2027'])
    expect(bottom.map((c) => c.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb'])
    expect(bottom[0]?.width).toBe(25 * 6)
    expect(bottom[1]?.left).toBe(25 * 6)
  })

  it('lists month boundaries and grid phases', () => {
    expect(monthStarts({ start: '2026-11-06', end: '2027-01-08' })).toEqual([
      '2026-12-01',
      '2027-01-01',
    ])
    expect(weekendOffsetDays('2026-11-06')).toBe(1) // Fri → Sat
    expect(weekendOffsetDays('2026-11-07')).toBe(0)
    expect(weekStartOffsetDays('2026-11-06', 1)).toBe(3) // Fri → Mon
    expect(weekStartOffsetDays('2026-11-06', 0)).toBe(2) // Fri → Sun
  })

  it('scrolls today near the left edge', () => {
    expect(scrollLeftFor(TODAY, RANGE, 'day')).toBe(0)
    expect(scrollLeftFor('2026-11-20', RANGE, 'day')).toBe(7 * 40)
    expect(scrollLeftFor('2026-11-06', RANGE, 'month')).toBe(0)
  })

  it('formats spans', () => {
    expect(formatSpan({ start: '2026-11-13', end: '2026-11-13' }, TODAY)).toBe('Nov 13')
    expect(formatSpan({ start: '2026-12-30', end: '2027-01-02' }, TODAY)).toBe(
      'Dec 30 – Jan 2, 2027',
    )
  })
})
