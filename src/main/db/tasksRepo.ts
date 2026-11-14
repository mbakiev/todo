import { randomUUID } from 'node:crypto'
import { DEFAULT_PRIORITY, SOFT_DELETE_RETENTION_MS } from '@shared/constants'
import { isLocalDate } from '@shared/dates'
import { compareByPosition, needsRenumber, positionBetween, topPosition } from '@shared/ordering'
import type { LocalDate, Priority, Status, Tag, Task } from '@shared/types'
import type { Db } from './connection'
import { RepoError, notFound } from './errors'
import type { TagsRepo } from './tagsRepo'

interface TaskRow {
  id: string
  title: string
  description: string
  status: Status
  priority: number
  start_date: string | null
  due_date: string | null
  position: number
  created_at: number
  updated_at: number
  completed_at: number | null
  deleted_at: number | null
}

/** Already zod-validated create input (see shared/schemas.ts). */
export interface CreateTaskParams {
  title: string
  description?: string
  status?: Status
  priority?: Priority
  startDate?: LocalDate | null
  dueDate?: LocalDate | null
  tagIds?: string[]
  newTagNames?: string[]
}

export interface UpdateTaskParams {
  title?: string
  description?: string
  status?: Status
  priority?: Priority
  startDate?: LocalDate | null
  dueDate?: LocalDate | null
  position?: number
  tagIds?: string[]
}

export interface MoveTaskParams {
  status?: Status
  beforeId: string | null
  afterId: string | null
}

export interface TasksRepo {
  /** All non-deleted tasks. */
  list(): Task[]
  /** A non-deleted task. */
  get(id: string): Task | undefined
  create(input: CreateTaskParams): { task: Task; createdTags: Tag[] }
  update(id: string, patch: UpdateTaskParams): Task
  /** Returns the moved task plus any siblings whose position changed due to renumbering. */
  move(id: string, input: MoveTaskParams): { task: Task; renumbered: Task[] }
  softDelete(id: string): void
  restore(id: string): Task
  /** Hard-deletes tasks soft-deleted more than 30 days ago. Returns count. */
  purgeDeleted(): number
  /** Number of task rows, soft-deleted ones included. */
  countAll(): number
}

function toPriority(n: number): Priority {
  return (n >= 1 && n <= 4 ? n : DEFAULT_PRIORITY) as Priority
}

function assertDates(start: LocalDate | null, due: LocalDate | null): void {
  if (start !== null && !isLocalDate(start))
    throw new RepoError('validation', `Invalid start date: ${start}`)
  if (due !== null && !isLocalDate(due))
    throw new RepoError('validation', `Invalid due date: ${due}`)
  if (start !== null && due !== null && start > due) {
    throw new RepoError('validation', 'Start date must not be after due date')
  }
}

export function createTasksRepo(db: Db, tags: TagsRepo, now: () => number = Date.now): TasksRepo {
  function tagIdsFor(taskIds: readonly string[]): Map<string, string[]> {
    const map = new Map<string, string[]>()
    if (taskIds.length === 0) return map
    const rows =
      taskIds.length === 1
        ? db.all<{ task_id: string; tag_id: string }>(
            'SELECT task_id, tag_id FROM task_tags WHERE task_id = ?',
            [taskIds[0] as string],
          )
        : db.all<{ task_id: string; tag_id: string }>(
            `SELECT tt.task_id, tt.tag_id FROM task_tags tt
             JOIN tasks t ON t.id = tt.task_id WHERE t.deleted_at IS NULL`,
          )
    const wanted = new Set(taskIds)
    for (const r of rows) {
      if (!wanted.has(r.task_id)) continue
      const list = map.get(r.task_id)
      if (list) list.push(r.tag_id)
      else map.set(r.task_id, [r.tag_id])
    }
    return map
  }

  function toTask(r: TaskRow, tagIds: string[]): Task {
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: toPriority(r.priority),
      startDate: r.start_date,
      dueDate: r.due_date,
      position: r.position,
      tagIds: tagIds.slice().sort(),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at,
    }
  }

  function row(id: string): TaskRow | undefined {
    return db.get<TaskRow>('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', [id])
  }

  function mustGet(id: string): Task {
    const t = repo.get(id)
    if (!t) throw notFound('Task', id)
    return t
  }

  function columnTop(status: Status, excludeId?: string): number {
    const r = db.get<{ p: number | null }>(
      'SELECT MIN(position) AS p FROM tasks WHERE status = ? AND deleted_at IS NULL AND id IS NOT ?',
      [status, excludeId ?? null],
    )
    return r?.p === null || r?.p === undefined ? 0 : topPosition([r.p])
  }

  function setTags(taskId: string, tagIds: readonly string[]): void {
    const unique = [...new Set(tagIds)]
    for (const tagId of unique) {
      if (!tags.get(tagId)) throw new RepoError('validation', `Unknown tag: ${tagId}`)
    }
    db.run('DELETE FROM task_tags WHERE task_id = ?', [taskId])
    for (const tagId of unique) {
      db.run('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)', [taskId, tagId])
    }
  }

  /** Renumbers a status column to 0,1,2… in current display order. Returns changed tasks' ids. */
  function renumberColumn(status: Status, excludeId: string): string[] {
    const rows = db.all<Pick<TaskRow, 'id' | 'position' | 'created_at'>>(
      'SELECT id, position, created_at FROM tasks WHERE status = ? AND deleted_at IS NULL AND id != ?',
      [status, excludeId],
    )
    const sorted = rows
      .map((r) => ({ id: r.id, position: r.position, createdAt: r.created_at }))
      .sort(compareByPosition)
    const ts = now()
    const changed: string[] = []
    sorted.forEach((t, i) => {
      if (t.position !== i) {
        db.run('UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?', [i, ts, t.id])
        changed.push(t.id)
      }
    })
    return changed
  }

  const repo: TasksRepo = {
    list() {
      const rows = db.all<TaskRow>('SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY position')
      const tagMap = tagIdsFor(rows.map((r) => r.id))
      return rows.map((r) => toTask(r, tagMap.get(r.id) ?? []))
    },

    get(id) {
      const r = row(id)
      if (!r) return undefined
      return toTask(r, tagIdsFor([id]).get(id) ?? [])
    },

    create(input) {
      return db.transaction(() => {
        const title = input.title.trim()
        if (title === '') throw new RepoError('validation', 'Title is required')
        const startDate = input.startDate ?? null
        const dueDate = input.dueDate ?? null
        assertDates(startDate, dueDate)
        const status = input.status ?? 'not_started'
        const ts = now()
        const id = randomUUID()
        db.run(
          `INSERT INTO tasks (id, title, description, status, priority, start_date, due_date,
             position, created_at, updated_at, completed_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            id,
            title,
            input.description ?? '',
            status,
            input.priority ?? DEFAULT_PRIORITY,
            startDate,
            dueDate,
            columnTop(status),
            ts,
            ts,
            status === 'done' ? ts : null,
          ],
        )
        const createdTags: Tag[] = []
        const tagIds = [...(input.tagIds ?? [])]
        for (const name of input.newTagNames ?? []) {
          const { tag, created } = tags.ensureByName(name)
          if (created) createdTags.push(tag)
          tagIds.push(tag.id)
        }
        setTags(id, tagIds)
        return { task: mustGet(id), createdTags }
      })
    },

    update(id, patch) {
      return db.transaction(() => {
        const existing = mustGet(id)
        const next: Task = { ...existing }
        if (patch.title !== undefined) {
          const title = patch.title.trim()
          if (title === '') throw new RepoError('validation', 'Title is required')
          next.title = title
        }
        if (patch.description !== undefined) next.description = patch.description
        if (patch.priority !== undefined) next.priority = patch.priority
        if (patch.startDate !== undefined) next.startDate = patch.startDate
        if (patch.dueDate !== undefined) next.dueDate = patch.dueDate
        assertDates(next.startDate, next.dueDate)

        const ts = now()
        if (patch.status !== undefined && patch.status !== existing.status) {
          next.status = patch.status
          next.completedAt = patch.status === 'done' ? ts : null
          // Changing column without an explicit position lands at the top of the new column.
          if (patch.position === undefined) next.position = columnTop(patch.status, id)
        }
        if (patch.position !== undefined) {
          if (!Number.isFinite(patch.position))
            throw new RepoError('validation', 'Invalid position')
          next.position = patch.position
        }

        db.run(
          `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, start_date = ?,
             due_date = ?, position = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
          [
            next.title,
            next.description,
            next.status,
            next.priority,
            next.startDate,
            next.dueDate,
            next.position,
            ts,
            next.completedAt,
            id,
          ],
        )
        if (patch.tagIds !== undefined) setTags(id, patch.tagIds)
        return mustGet(id)
      })
    },

    move(id, input) {
      return db.transaction(() => {
        const existing = mustGet(id)
        const status = input.status ?? existing.status
        const neighbour = (nid: string | null): number | null => {
          if (nid === null) return null
          if (nid === id) throw new RepoError('validation', 'A task cannot be its own neighbour')
          const r = row(nid)
          if (!r) throw notFound('Task', nid)
          if (r.status !== status) {
            throw new RepoError('validation', `Neighbour ${nid} is not in column ${status}`)
          }
          return r.position
        }
        let before = neighbour(input.beforeId)
        let after = neighbour(input.afterId)
        let renumberedIds: string[] = []
        if (before !== null && after !== null && needsRenumber(before, after)) {
          renumberedIds = renumberColumn(status, id)
          before = neighbour(input.beforeId)
          after = neighbour(input.afterId)
        }
        const position = positionBetween(before, after)
        const ts = now()
        const completedAt =
          status === existing.status ? existing.completedAt : status === 'done' ? ts : null
        db.run(
          'UPDATE tasks SET status = ?, position = ?, completed_at = ?, updated_at = ? WHERE id = ?',
          [status, position, completedAt, ts, id],
        )
        const renumbered = renumberedIds.map(mustGet)
        return { task: mustGet(id), renumbered }
      })
    },

    softDelete(id) {
      const ts = now()
      const { changes } = db.run(
        'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        [ts, ts, id],
      )
      if (changes === 0) throw notFound('Task', id)
    },

    restore(id) {
      const { changes } = db.run(
        'UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL',
        [now(), id],
      )
      if (changes === 0) {
        // Restoring a task that is not deleted is a no-op if it exists.
        const t = repo.get(id)
        if (t) return t
        throw notFound('Task', id)
      }
      return mustGet(id)
    },

    purgeDeleted() {
      const cutoff = now() - SOFT_DELETE_RETENTION_MS
      return db.run('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff])
        .changes
    },

    countAll() {
      return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tasks')?.n ?? 0
    },
  }
  return repo
}
