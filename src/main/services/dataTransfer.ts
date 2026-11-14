// Export / import core (spec §9), free of Electron so it is unit-tested directly.
//
// Import writes rows with their original ids and timestamps, which the regular repos
// deliberately do not allow; those writes live in db/importRepo.ts (all SQL stays under db/).
// This module validates, decides merge/replace outcomes and runs it all in one transaction.
import { APP_DISPLAY_NAME, EXPORT_APP_ID, EXPORT_FORMAT_VERSION } from '@shared/constants'
import { exportFileSchema } from '@shared/schemas'
import type { ExportFile, ImportResult, Tag, Task } from '@shared/types'
import type { Repos } from '../db'
import { createImportRepo } from '../db/importRepo'
import { takeBackup } from './backup'

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
    // Editors on Windows (Notepad "UTF-8 with BOM") prepend U+FEFF, which JSON.parse rejects.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
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

/**
 * Applies an import in one transaction.
 * - merge: tags matched by id, then case-insensitively by name (see mergeTags); tasks
 *   upserted by id, the
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
  const rows = createImportRepo(db)
  const result = {
    mode,
    tasksAdded: 0,
    tasksUpdated: 0,
    tasksSkipped: 0,
    tagsAdded: 0,
    tagsUpdated: 0,
  }

  db.transaction(() => {
    if (mode === 'replace') rows.deleteAll()

    const tagIdMap = mergeTags(repos, rows, file.tags, result)

    // --- tasks
    for (const t of file.tasks) {
      const tagIds = [
        ...new Set(t.tagIds.map((id) => tagIdMap.get(id) ?? (repos.tags.get(id) ? id : null))),
      ].filter((id): id is string => id !== null)
      const existingUpdatedAt = rows.taskUpdatedAt(t.id)
      if (existingUpdatedAt !== null && t.updatedAt <= existingUpdatedAt) {
        result.tasksSkipped++
        continue
      }
      rows.writeTask(t, existingUpdatedAt !== null)
      rows.replaceTaskTags(t.id, tagIds)
      if (existingUpdatedAt !== null) result.tasksUpdated++
      else result.tasksAdded++
    }
  })
  return result
}

/**
 * Maps every file tag onto a local tag (file id → local id), renaming / recolouring /
 * inserting as needed. Order-independent:
 * 1. every file tag whose id exists locally claims that local tag;
 * 2. the remaining file tags are matched case-insensitively by name, but only against local
 *    tags no id match claimed (so "A renamed to B" plus a brand-new "A" stay two tags);
 * 3. the rest are inserted.
 * A matched-by-id tag takes the file's name unless that name is still held by another tag
 * after the merge (then it keeps its local name). Renames go through temporary names first so
 * swaps (A↔B) never trip the UNIQUE constraint.
 */
function mergeTags(
  repos: Repos,
  rows: ReturnType<typeof createImportRepo>,
  fileTags: readonly ExportFile['tags'][number][],
  result: { tagsAdded: number; tagsUpdated: number },
): Map<string, string> {
  const key = (name: string): string => name.trim().toLowerCase()
  const local = repos.tags.list()
  const localById = new Map(local.map((t) => [t.id, t]))
  const tagIdMap = new Map<string, string>()
  const claimed = new Set<string>()

  // 1. id matches
  const byId = fileTags.filter((t) => localById.has(t.id))
  for (const t of byId) {
    tagIdMap.set(t.id, t.id)
    claimed.add(t.id)
  }
  // 2. name matches against unclaimed local tags
  const unclaimedByName = new Map(
    local.filter((t) => !claimed.has(t.id)).map((t) => [key(t.name), t]),
  )
  const rest: ExportFile['tags'][number][] = []
  for (const t of fileTags) {
    if (tagIdMap.has(t.id)) continue
    const match = unclaimedByName.get(key(t.name))
    if (match && !claimed.has(match.id)) {
      tagIdMap.set(t.id, match.id)
      claimed.add(match.id)
    } else {
      rest.push(t)
    }
  }

  // Final names: every local tag not matched by id keeps its name.
  const taken = new Map<string, string>() // name key → local id holding it after the merge
  for (const t of local) if (!byId.some((f) => f.id === t.id)) taken.set(key(t.name), t.id)
  const finalName = new Map<string, string>()
  for (const t of byId) {
    const current = localById.get(t.id)?.name ?? t.name
    const holder = taken.get(key(t.name))
    const name = holder === undefined || holder === t.id ? t.name.trim() : current
    finalName.set(t.id, name)
    taken.set(key(name), t.id)
  }

  // 3a. renames (via temporary names) and recolours of id matches
  const changed = byId.filter((t) => {
    const cur = localById.get(t.id)
    return cur && (cur.name !== finalName.get(t.id) || cur.color !== t.color)
  })
  for (const t of changed) {
    const cur = localById.get(t.id)
    if (cur && cur.name !== finalName.get(t.id)) {
      rows.setTagNameAndColor(t.id, `~import-tmp-${t.id}`, cur.color)
    }
  }
  for (const t of changed) {
    rows.setTagNameAndColor(t.id, finalName.get(t.id) ?? t.name, t.color)
    result.tagsUpdated++
  }

  // 3b. inserts; a name that is still taken (e.g. by a tag that kept its local name) maps onto
  //     that tag instead of creating a duplicate.
  for (const t of rest) {
    const holder = taken.get(key(t.name))
    if (holder !== undefined) {
      tagIdMap.set(t.id, holder)
      continue
    }
    rows.insertTag(t)
    tagIdMap.set(t.id, t.id)
    taken.set(key(t.name), t.id)
    result.tagsAdded++
  }
  return tagIdMap
}

/**
 * A full import: a `todos-preimport-…` safety copy first (both modes — a merge can overwrite
 * local tasks too), then applyImport. The copy is skipped only when the local DB has no tasks
 * at all (nothing to lose). It is taken outside the transaction: VACUUM INTO cannot run
 * inside one. Returns the counts (+ backup path) and the broadcast for the windows.
 */
export function runImport(
  repos: Repos,
  backupsDir: string,
  file: ExportFile,
  mode: 'merge' | 'replace',
): { result: ImportResult; broadcast: ReturnType<typeof importBroadcast> } {
  const before = {
    taskIds: repos.tasks.list().map((t) => t.id),
    tagIds: repos.tags.list().map((t) => t.id),
  }
  const backupPath =
    repos.tasks.countAll() > 0 ? takeBackup(repos.db, backupsDir, { kind: 'preimport' }) : undefined
  const counts = applyImport(repos, file, mode)
  return {
    result: backupPath ? { ...counts, backupPath } : counts,
    broadcast: importBroadcast(before, repos),
  }
}

/** Everything a window needs to resync after an import. */
export function importBroadcast(
  before: { taskIds: string[]; tagIds: string[] },
  repos: Repos,
): {
  upsertedTasks: Task[]
  removedTaskIds: string[]
  tags: Tag[]
  removedTagIds: string[]
  authoritative: true
} {
  const tasks = repos.tasks.list()
  const tags = repos.tags.list()
  const taskIds = new Set(tasks.map((t) => t.id))
  const tagIds = new Set(tags.map((t) => t.id))
  return {
    upsertedTasks: tasks,
    removedTaskIds: before.taskIds.filter((id) => !taskIds.has(id)),
    tags,
    removedTagIds: before.tagIds.filter((id) => !tagIds.has(id)),
    authoritative: true,
  }
}
