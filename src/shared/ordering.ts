// Manual-order position math. Lower position = higher in the column.
// The repository layer uses these to place new tasks and to apply moves; the renderer
// can use them for optimistic placement.

import { POSITION_EPSILON } from './constants'

/** Position that puts a new item above every existing one. */
export function topPosition(existing: readonly number[]): number {
  if (existing.length === 0) return 0
  return Math.min(...existing) - 1
}

/** Position that puts a new item below every existing one. */
export function bottomPosition(existing: readonly number[]): number {
  if (existing.length === 0) return 0
  return Math.max(...existing) + 1
}

/**
 * Position between two neighbours. `before` is the item that will sit directly above,
 * `after` directly below; either may be null at the column edges.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0
  if (before === null) return (after as number) - 1
  if (after === null) return before + 1
  return (before + after) / 2
}

/**
 * True when the gap between neighbours is too small to bisect safely, meaning the column
 * must be renumbered before inserting.
 */
export function needsRenumber(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false
  return after - before < POSITION_EPSILON
}

/**
 * Integer positions (0, 1, 2…) for items already sorted in display order.
 * Returns `[id, position]` pairs in the same order.
 */
export function renumber<T extends { id: string }>(sorted: readonly T[]): Array<[string, number]> {
  return sorted.map((item, i) => [item.id, i])
}

/** Ascending by position, then by createdAt desc (newest first) as a stable tie-break. */
export function compareByPosition(
  a: { position: number; createdAt: number; id: string },
  b: { position: number; createdAt: number; id: string },
): number {
  if (a.position !== b.position) return a.position - b.position
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Given a column in display order (excluding the moved item) and a target index, returns
 * the ids of the neighbours the moved item will sit between.
 */
export function neighboursAt<T extends { id: string }>(
  column: readonly T[],
  index: number,
): { beforeId: string | null; afterId: string | null } {
  const i = Math.max(0, Math.min(index, column.length))
  return {
    beforeId: i > 0 ? (column[i - 1]?.id ?? null) : null,
    afterId: i < column.length ? (column[i]?.id ?? null) : null,
  }
}
