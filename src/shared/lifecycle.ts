// Task lifecycle record: when a task was actually started and completed (epoch ms).
// This is the ONE place the transition rule lives; the main-process repo (create / update /
// move) and the renderer's optimistic store paths both call it so they can never drift.
//
// Vocabulary: `startDate` / `dueDate` are the user's plan (LocalDate). `startedAt` /
// `completedAt` are the record, maintained automatically and never user-edited.

import type { Status, Task } from './types'

export interface StatusTimestamps {
  startedAt: number | null
  completedAt: number | null
}

/**
 * The `startedAt` / `completedAt` a task should have after moving to `next` at instant `ts`.
 * `prev` is the task before the change, or null when the task is being created.
 *
 * - same status: unchanged.
 * - back to `not_started`: both null (a later start records a fresh time).
 * - any started status: `startedAt = ts` if it was null, else kept (a reopen keeps the
 *   original start).
 * - entering `done`: `completedAt = ts` (Not Started → Done gives both the same `ts`).
 * - leaving `done` (reopen): `completedAt = null`.
 * - in_progress ↔ blocked: nothing changes.
 */
export function statusTimestamps(
  prev: { status: Status; startedAt: number | null; completedAt: number | null } | null,
  next: Status,
  ts: number,
): StatusTimestamps {
  if (prev !== null && prev.status === next) {
    return { startedAt: prev.startedAt, completedAt: prev.completedAt }
  }
  if (next === 'not_started') return { startedAt: null, completedAt: null }
  if (prev !== null && prev.status !== 'done' && prev.status !== 'not_started') {
    // in_progress ↔ blocked: literally nothing changes (even a legacy null start stays null,
    // so `effectiveStartedAt` keeps showing the same fallback).
    if (next !== 'done') return { startedAt: prev.startedAt, completedAt: prev.completedAt }
  }
  const startedAt = prev?.startedAt ?? ts
  if (next === 'done') {
    // Clamp so startedAt <= completedAt holds even if the clock went backwards.
    return { startedAt: Math.min(startedAt, ts), completedAt: ts }
  }
  return { startedAt, completedAt: null }
}

/**
 * The start instant views should use. Legacy, imported or test rows may be in a started
 * status with `startedAt === null`; never crash or hide those. Falls back like the 002
 * backfill: `completedAt` (else `updatedAt`) for done, `createdAt` for in_progress / blocked.
 * Null only for `not_started`.
 */
export function effectiveStartedAt(
  task: Pick<Task, 'status' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'>,
): number | null {
  if (task.status === 'not_started') return null
  if (task.status === 'done') {
    const completed = task.completedAt ?? task.updatedAt
    return task.startedAt === null ? completed : Math.min(task.startedAt, completed)
  }
  return task.startedAt ?? task.createdAt
}
