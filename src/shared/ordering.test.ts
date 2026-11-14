import { POSITION_EPSILON } from './constants'
import {
  bottomPosition,
  compareByPosition,
  neighboursAt,
  needsRenumber,
  positionBetween,
  renumber,
  topPosition,
} from './ordering'

describe('ordering', () => {
  it('top/bottom positions', () => {
    expect(topPosition([])).toBe(0)
    expect(topPosition([3, -2, 5])).toBe(-3)
    expect(bottomPosition([3, -2, 5])).toBe(6)
  })
  it('positionBetween handles edges', () => {
    expect(positionBetween(null, null)).toBe(0)
    expect(positionBetween(null, 4)).toBe(3)
    expect(positionBetween(4, null)).toBe(5)
    expect(positionBetween(1, 2)).toBe(1.5)
  })
  it('detects gaps too small to bisect', () => {
    expect(needsRenumber(1, 2)).toBe(false)
    expect(needsRenumber(1, 1 + POSITION_EPSILON / 2)).toBe(true)
    expect(needsRenumber(null, 1)).toBe(false)
    // Repeated bisection eventually needs renumbering.
    let lo = 0
    const hi = 1
    let n = 0
    while (!needsRenumber(lo, hi)) {
      lo = positionBetween(lo, hi)
      n++
    }
    expect(n).toBeGreaterThan(10)
    expect(n).toBeLessThan(40)
  })
  it('renumbers in order', () => {
    expect(renumber([{ id: 'a' }, { id: 'b' }])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })
  it('compareByPosition tie-breaks newest first', () => {
    const items = [
      { id: 'a', position: 1, createdAt: 1 },
      { id: 'b', position: 1, createdAt: 2 },
      { id: 'c', position: 0, createdAt: 0 },
    ]
    expect(items.sort(compareByPosition).map((i) => i.id)).toEqual(['c', 'b', 'a'])
  })
  it('neighboursAt clamps index', () => {
    const col = [{ id: 'a' }, { id: 'b' }]
    expect(neighboursAt(col, 0)).toEqual({ beforeId: null, afterId: 'a' })
    expect(neighboursAt(col, 1)).toEqual({ beforeId: 'a', afterId: 'b' })
    expect(neighboursAt(col, 99)).toEqual({ beforeId: 'b', afterId: null })
    expect(neighboursAt([], 0)).toEqual({ beforeId: null, afterId: null })
  })
})
