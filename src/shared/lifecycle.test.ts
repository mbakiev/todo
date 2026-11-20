import { effectiveStartedAt, statusTimestamps } from './lifecycle'
import { makeTask } from './test/factories'
import type { Status } from './types'

const T0 = 1_000
const TS = 5_000

const prev = (status: Status, startedAt: number | null, completedAt: number | null = null) => ({
  status,
  startedAt,
  completedAt,
})

describe('statusTimestamps', () => {
  it('create: not started has no record; started statuses start at ts', () => {
    expect(statusTimestamps(null, 'not_started', TS)).toEqual({
      startedAt: null,
      completedAt: null,
    })
    expect(statusTimestamps(null, 'in_progress', TS)).toEqual({ startedAt: TS, completedAt: null })
    expect(statusTimestamps(null, 'blocked', TS)).toEqual({ startedAt: TS, completedAt: null })
  })
  it('create done: identical start and completion', () => {
    expect(statusTimestamps(null, 'done', TS)).toEqual({ startedAt: TS, completedAt: TS })
  })
  it('leaving not_started records the start', () => {
    expect(statusTimestamps(prev('not_started', null), 'in_progress', TS)).toEqual({
      startedAt: TS,
      completedAt: null,
    })
    expect(statusTimestamps(prev('not_started', null), 'blocked', TS)).toEqual({
      startedAt: TS,
      completedAt: null,
    })
  })
  it('not_started → done: both equal ts (not 1 s apart)', () => {
    const r = statusTimestamps(prev('not_started', null), 'done', TS)
    expect(r.startedAt).toBe(TS)
    expect(r.completedAt).toBe(TS)
  })
  it('entering done from a started status keeps the start', () => {
    expect(statusTimestamps(prev('in_progress', T0), 'done', TS)).toEqual({
      startedAt: T0,
      completedAt: TS,
    })
    expect(statusTimestamps(prev('blocked', T0), 'done', TS)).toEqual({
      startedAt: T0,
      completedAt: TS,
    })
  })
  it('reopen (done → in_progress / blocked) clears completion and keeps the original start', () => {
    for (const next of ['in_progress', 'blocked'] as const) {
      expect(statusTimestamps(prev('done', T0, 3_000), next, TS)).toEqual({
        startedAt: T0,
        completedAt: null,
      })
    }
  })
  it('in_progress ↔ blocked changes nothing', () => {
    expect(statusTimestamps(prev('in_progress', T0), 'blocked', TS)).toEqual({
      startedAt: T0,
      completedAt: null,
    })
    expect(statusTimestamps(prev('blocked', T0), 'in_progress', TS)).toEqual({
      startedAt: T0,
      completedAt: null,
    })
    // Even a legacy row without a start keeps its (null) start, so views' fallback is stable.
    expect(statusTimestamps(prev('blocked', null), 'in_progress', TS)).toEqual({
      startedAt: null,
      completedAt: null,
    })
  })
  it('back to not_started clears both; a later start records a fresh time', () => {
    for (const from of ['in_progress', 'blocked', 'done'] as const) {
      expect(
        statusTimestamps(prev(from, T0, from === 'done' ? 3_000 : null), 'not_started', TS),
      ).toEqual({ startedAt: null, completedAt: null })
    }
    const cleared = statusTimestamps(prev('done', T0, 3_000), 'not_started', TS)
    expect(statusTimestamps({ status: 'not_started', ...cleared }, 'in_progress', 9_000)).toEqual({
      startedAt: 9_000,
      completedAt: null,
    })
  })
  it('same status: unchanged (even if inconsistent)', () => {
    expect(statusTimestamps(prev('done', T0, 3_000), 'done', TS)).toEqual({
      startedAt: T0,
      completedAt: 3_000,
    })
    expect(statusTimestamps(prev('in_progress', T0), 'in_progress', TS)).toEqual({
      startedAt: T0,
      completedAt: null,
    })
    expect(statusTimestamps(prev('not_started', null), 'not_started', TS)).toEqual({
      startedAt: null,
      completedAt: null,
    })
  })
  it('legacy started row without a start: entering done starts at ts', () => {
    expect(statusTimestamps(prev('in_progress', null), 'done', TS)).toEqual({
      startedAt: TS,
      completedAt: TS,
    })
    // A reopened legacy done row gets a start so the invariant holds again.
    expect(statusTimestamps(prev('done', null, 3_000), 'in_progress', TS)).toEqual({
      startedAt: TS,
      completedAt: null,
    })
  })
  it('never lets startedAt exceed completedAt (clock went backwards)', () => {
    expect(statusTimestamps(prev('in_progress', 9_000), 'done', TS)).toEqual({
      startedAt: TS,
      completedAt: TS,
    })
  })
})

describe('effectiveStartedAt', () => {
  it('uses startedAt when present', () => {
    expect(effectiveStartedAt(makeTask({ status: 'in_progress', startedAt: 42 }))).toBe(42)
    expect(effectiveStartedAt(makeTask({ status: 'done', startedAt: 42, completedAt: 100 }))).toBe(
      42,
    )
  })
  it('not_started is always null', () => {
    expect(effectiveStartedAt(makeTask({ status: 'not_started' }))).toBeNull()
    expect(effectiveStartedAt(makeTask({ status: 'not_started', startedAt: 42 }))).toBeNull()
  })
  it('legacy rows fall back like the migration backfill', () => {
    expect(
      effectiveStartedAt(makeTask({ status: 'in_progress', startedAt: null, createdAt: 7 })),
    ).toBe(7)
    expect(effectiveStartedAt(makeTask({ status: 'blocked', startedAt: null, createdAt: 7 }))).toBe(
      7,
    )
    expect(
      effectiveStartedAt(makeTask({ status: 'done', startedAt: null, completedAt: 100 })),
    ).toBe(100)
    expect(
      effectiveStartedAt(
        makeTask({ status: 'done', startedAt: null, completedAt: null, updatedAt: 55 }),
      ),
    ).toBe(55)
  })
  it('done: clamped to the completion', () => {
    expect(effectiveStartedAt(makeTask({ status: 'done', startedAt: 500, completedAt: 100 }))).toBe(
      100,
    )
  })
})
