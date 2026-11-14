// Unsaved title / description text that could not be saved (the write failed), kept in
// localStorage so it survives a window hide, quit or crash. When the task is opened again the
// detail panel offers it back as an unsaved draft ("Recovered unsaved text · Keep / Discard");
// it is never applied silently. Pure functions over an injectable Storage (unit-tested).
import { SOFT_DELETE_RETENTION_MS } from '@shared/constants'

export type DraftFieldName = 'title' | 'description'

export interface UnsavedDraft {
  taskId: string
  field: DraftFieldName
  text: string
  /** The task's `updatedAt` when the draft was stored (tells whether it changed since). */
  taskUpdatedAt: number
  storedAt: number
}

const PREFIX = 'martin-todos.unsavedDraft.'
const key = (taskId: string, field: DraftFieldName): string => `${PREFIX}${taskId}.${field}`

/** The browser's localStorage, or null where it is unavailable (tests without DOM, blocked). */
export function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function storeUnsavedDraft(storage: Storage | null, draft: UnsavedDraft): void {
  try {
    storage?.setItem(key(draft.taskId, draft.field), JSON.stringify(draft))
  } catch (err) {
    // Quota / private mode: nothing more we can do; the field still shows "Not saved".
    console.error('Could not keep the unsaved draft', err)
  }
}

function parse(raw: string | null): UnsavedDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<UnsavedDraft>
    if (
      typeof v.taskId === 'string' &&
      (v.field === 'title' || v.field === 'description') &&
      typeof v.text === 'string' &&
      typeof v.taskUpdatedAt === 'number' &&
      typeof v.storedAt === 'number'
    ) {
      return v as UnsavedDraft
    }
  } catch {
    // fall through: unreadable entries are treated as absent
  }
  return null
}

export function loadUnsavedDraft(
  storage: Storage | null,
  taskId: string,
  field: DraftFieldName,
): UnsavedDraft | null {
  try {
    return parse(storage?.getItem(key(taskId, field)) ?? null)
  } catch {
    return null
  }
}

export function clearUnsavedDraft(
  storage: Storage | null,
  taskId: string,
  field: DraftFieldName,
): void {
  try {
    storage?.removeItem(key(taskId, field))
  } catch {
    // ignore
  }
}

/**
 * Drops stored drafts that cannot be read, and drafts whose task no longer exists *and* that
 * are older than 30 days (the window after which deleted tasks are purged). A younger draft of
 * a missing task is kept: the task may be deleted now and restored with Undo later.
 */
export function pruneUnsavedDrafts(
  storage: Storage | null,
  existingTaskIds: ReadonlySet<string>,
  now: number = Date.now(),
) {
  if (!storage) return
  try {
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (!k?.startsWith(PREFIX)) continue
      const d = parse(storage.getItem(k))
      const expired = (x: UnsavedDraft): boolean => now - x.storedAt > SOFT_DELETE_RETENTION_MS
      if (!d || (!existingTaskIds.has(d.taskId) && expired(d))) stale.push(k)
    }
    for (const k of stale) storage.removeItem(k)
  } catch {
    // ignore
  }
}

/**
 * What to offer when the task is opened: the stored text, unless it equals what is saved now
 * (then the draft is obsolete and is cleared). `changedSince`: the task was saved after the
 * draft was stored (e.g. edited in another window), worth saying in the notice.
 */
export function recoverableDraft(
  storage: Storage | null,
  task: { id: string; updatedAt: number },
  field: DraftFieldName,
  currentValue: string,
): { text: string; changedSince: boolean } | null {
  const d = loadUnsavedDraft(storage, task.id, field)
  if (!d) return null
  if (d.text === currentValue) {
    clearUnsavedDraft(storage, task.id, field)
    return null
  }
  return { text: d.text, changedSince: task.updatedAt > d.taskUpdatedAt }
}
