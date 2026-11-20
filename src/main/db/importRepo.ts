// Raw writes used only by data import (services/dataTransfer.ts). Import keeps records' original
// ids and timestamps, which tasksRepo / tagsRepo deliberately never allow, so it gets its own
// small repo. Callers own the transaction.
import { effectiveStartedAt } from '@shared/lifecycle'
import type { ExportFile } from '@shared/types'
import type { Db } from './connection'

type ImportTask = ExportFile['tasks'][number]
type ImportTag = ExportFile['tags'][number]

export interface ImportRepo {
  /** Removes every task (including soft-deleted ones), tag and link. */
  deleteAll(): void
  setTagNameAndColor(id: string, name: string, color: string): void
  insertTag(tag: ImportTag): void
  /** `updatedAt` of a task row (deleted or not), or null if the id is unknown. */
  taskUpdatedAt(id: string): number | null
  /** Inserts the task, or overwrites (and un-deletes) the row with the same id. */
  writeTask(task: ImportTask, exists: boolean): void
  replaceTaskTags(taskId: string, tagIds: readonly string[]): void
}

export function createImportRepo(db: Db): ImportRepo {
  return {
    deleteAll() {
      db.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM tags;')
    },
    setTagNameAndColor(id, name, color) {
      db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, color, id])
    },
    insertTag(t) {
      db.run('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)', [
        t.id,
        t.name.trim(),
        t.color,
        t.createdAt,
      ])
    },
    taskUpdatedAt(id) {
      const row = db.get<{ updated_at: number }>('SELECT updated_at FROM tasks WHERE id = ?', [id])
      return row ? row.updated_at : null
    },
    writeTask(t, exists) {
      // Restore the record invariants (spec §4): completedAt only for done; startedAt only
      // once started, falling back like migration 002 when missing and never after completion.
      const completedAt = t.status === 'done' ? (t.completedAt ?? t.updatedAt) : null
      const startedAt = effectiveStartedAt({ ...t, completedAt })
      const values = [
        t.title.trim() || 'Untitled',
        t.description,
        t.status,
        t.priority,
        t.startDate,
        t.dueDate,
        t.position,
        t.createdAt,
        t.updatedAt,
        startedAt,
        completedAt,
        t.id,
      ]
      if (exists) {
        db.run(
          `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, start_date = ?,
             due_date = ?, position = ?, created_at = ?, updated_at = ?, started_at = ?,
             completed_at = ?, deleted_at = NULL WHERE id = ?`,
          values,
        )
      } else {
        db.run(
          `INSERT INTO tasks (title, description, status, priority, start_date, due_date, position,
             created_at, updated_at, started_at, completed_at, deleted_at, id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          values,
        )
      }
    },
    replaceTaskTags(taskId, tagIds) {
      db.run('DELETE FROM task_tags WHERE task_id = ?', [taskId])
      for (const tagId of tagIds) {
        db.run('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)', [taskId, tagId])
      }
    },
  }
}
