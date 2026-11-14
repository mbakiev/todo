import { makeTask } from '@shared/test/factories'
import {
  applyDrag,
  barRect,
  buildTimelineRange,
  DAY_WIDTH,
  dateToX,
  datesPatch,
  formatSpan,
  headerTiers,
  MIN_BAR_WIDTH,
  monthStarts,
  pxToDays,
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

  it('never moves the start for ancient tasks', () => {
    const r = buildTimelineRange([makeTask({ dueDate: '2020-01-01' })], TODAY)
    expect(r.start).toBe('2026-11-06')
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
    const r = barRect({ startDate: null, dueDate: '2026-11-13' }, RANGE, 40)
    expect(r).toMatchObject({ start: '2026-11-13', end: '2026-11-13', clampedStart: false })
    expect(r?.left).toBe(283)
    expect(r?.width).toBe(34)
    const s = barRect({ startDate: '2026-11-13', dueDate: null }, RANGE, 40)
    expect(s?.left).toBe(283)
  })

  it('spans start → due inclusive', () => {
    const r = barRect({ startDate: '2026-11-10', dueDate: '2026-11-12' }, RANGE, 40)
    expect(r?.left).toBe(4 * 40 + 3)
    expect(r?.width).toBe(3 * 40 - 6)
  })

  it('returns null for undated tasks', () => {
    expect(barRect({ startDate: null, dueDate: null }, RANGE, 40)).toBeNull()
  })

  it('clamps a task entirely before the range to a stub at the left edge', () => {
    const r = barRect({ startDate: '2026-09-01', dueDate: '2026-10-02' }, RANGE, 40)
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
    const r = barRect({ startDate: '2026-11-01', dueDate: '2026-11-08' }, RANGE, 40)
    expect(r?.left).toBe(0)
    expect(r?.width).toBe(3 * 40 - 3)
  })

  it('enforces a minimum width at Month zoom', () => {
    const r = barRect({ startDate: null, dueDate: '2026-11-13' }, RANGE, DAY_WIDTH.month)
    expect(r?.width).toBe(MIN_BAR_WIDTH)
    // Centred on its column.
    expect(r?.left).toBe(7 * 6 - 1)
  })

  it('pins the right edge when a preview runs past the range end', () => {
    const r = barRect({ startDate: '2027-01-07', dueDate: '2027-01-20' }, RANGE, 10)
    expect(r?.clampedEnd).toBe(true)
    expect((r?.left ?? 0) + (r?.width ?? 0)).toBe(64 * 10)
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
