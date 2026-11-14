// Export / import core (spec §9), free of Electron so it is unit-tested directly.
//
// Import writes rows with their original ids and timestamps, which the repos deliberately
// do not allow, so this module issues its own SQL against `repos.db` inside one
// transaction and reads results back through the repos.
import { APP_DISPLAY_NAME, EXPORT_APP_ID, EXPORT_FORMAT_VERSION } from '@shared/constants'
import { exportFileSchema } from '@shared/schemas'
import type { ExportFile, ImportResult, Tag, Task } from '@shared/types'
import type { Repos } from '../db'

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export function buildExport(repos: Repos, now: number = Date.now()): ExportFile {
  return {
    app: EXPORT_APP_ID,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: now,
    tasks: repos.tasks.list(),
    tags: repos.tags.list(),
  }
}

/** Parses + validates an export file. Throws ImportError with a user-facing message. */
export function parseExportFile(text: string): ExportFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ImportError('This file is not valid JSON.')
  }
  if (typeof raw !== 'object' || raw === null || (raw as { app?: unknown }).app !== EXPORT_APP_ID) {
    throw new ImportError(`This is not a ${APP_DISPLAY_NAME} export file.`)
  }
  const version = (raw as { formatVersion?: unknown }).formatVersion
  if (typeof version === 'number' && version > EXPORT_FORMAT_VERSION) {
    throw new ImportError(
      `This file was exported by a newer version of ${APP_DISPLAY_NAME} (format ${version}; this version reads format ${EXPORT_FORMAT_VERSION}). Update the app to import it.`,
    )
  }
  const parsed = exportFileSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : ''
    throw new ImportError(
      `The file is damaged or incomplete${where}: ${issue?.message ?? 'invalid'}`,
    )
  }
  const file = parsed.data as ExportFile
  const dupe = firstDuplicate(file.tasks.map((t) => t.id))
  if (dupe) throw new ImportError(`The file lists task ${dupe} more than once.`)
  const dupeTag = firstDuplicate(file.tags.map((t) => t.id))
  if (dupeTag) throw new ImportError(`The file lists tag ${dupeTag} more than once.`)
  return file
}

function firstDuplicate(ids: string[]): string | null {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return null
}

interface ExistingTaskRow {
  id: string
  updated_at: number
}

/**
 * Applies an import in one transaction.
 * - merge: tags matched by id, then case-insensitively by name (matched-by-id tags take the
 *   file's name/colour unless that name belongs to another tag); tasks upserted by id, the
 *   record with the newer `updatedAt` wins (ties keep the local copy). A local soft-deleted
 *   task is revived only if the file's copy is newer.
 * - replace: everything (including soft-deleted tasks) is removed first. The caller must
 *   take a backup beforehand (VACUUM INTO cannot run inside a transaction).
 */
export function applyImport(
  repos: Repos,
  file: ExportFile,
  mode: 'merge' | 'replace',
): Omit<ImportResult, 'backupPath'> {
  const { db } = repos
  const result = {
    mode,
    tasksAdded: 0,
    tasksUpdated: 0,
    tasksSkipped: 0,
    tagsAdded: 0,
    tagsUpdated: 0,
  }

  db.transaction(() => {
    if (mode === 'replace') {
      db.exec('DELETE FROM task_tags; DELETE FROM tasks; DELETE FROM tags;')
    }

    // --- tags: file id → local id
    const tagIdMap = new Map<string, string>()
    for (const t of file.tags) {
      const byId = repos.tags.get(t.id)
      if (byId) {
        tagIdMap.set(t.id, byId.id)
        const clash = repos.tags.findByName(t.name)
        const name = clash && clash.id !== byId.id ? byId.name : t.name
        if (name !== byId.name || t.color !== byId.color) {
          db.run('UPDATE tags SET name = ?, color = ? WHERE id = ?', [name, t.color, byId.id])
          result.tagsUpdated++
        }
        continue
      }
      const byName = repos.tags.findByName(t.name)
      if (byName) {
        tagIdMap.set(t.id, byName.id)
        continue
      }
      db.run('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)', [
        t.id,
        t.name.trim(),
        t.color,
        t.createdAt,
      ])
      tagIdMap.set(t.id, t.id)
      result.tagsAdded++
    }

    // --- tasks
    for (const t of file.tasks) {
      const tagIds = [
        ...new Set(t.tagIds.map((id) => tagIdMap.get(id) ?? (repos.tags.get(id) ? id : null))),
      ].filter((id): id is string => id !== null)
      const existing = db.get<ExistingTaskRow>('SELECT id, updated_at FROM tasks WHERE id = ?', [
        t.id,
      ])
      if (existing && t.updatedAt <= existing.updated_at) {
        result.tasksSkipped++
        continue
      }
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
        t.status === 'done' ? (t.completedAt ?? t.updatedAt) : null,
      ]
      if (existing) {
        db.run(
          `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, start_date = ?,
             due_date = ?, position = ?, created_at = ?, updated_at = ?, completed_at = ?,
             deleted_at = NULL WHERE id = ?`,
          [...values, t.id],
        )
        db.run('DELETE FROM task_tags WHERE task_id = ?', [t.id])
        result.tasksUpdated++
      } else {
        db.run(
          `INSERT INTO tasks (title, description, status, priority, start_date, due_date, position,
             created_at, updated_at, completed_at, deleted_at, id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          [...values, t.id],
        )
        result.tasksAdded++
      }
      for (const tagId of tagIds) {
        db.run('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)', [t.id, tagId])
      }
    }
  })
  return result
}

/** Everything a window needs to resync after an import. */
export function importBroadcast(
  before: { taskIds: string[]; tagIds: string[] },
  repos: Repos,
): { upsertedTasks: Task[]; removedTaskIds: string[]; tags: Tag[]; removedTagIds: string[] } {
  const tasks = repos.tasks.list()
  const tags = repos.tags.list()
  const taskIds = new Set(tasks.map((t) => t.id))
  const tagIds = new Set(tags.map((t) => t.id))
  return {
    upsertedTasks: tasks,
    removedTaskIds: before.taskIds.filter((id) => !taskIds.has(id)),
    tags,
    removedTagIds: before.tagIds.filter((id) => !tagIds.has(id)),
  }
}
