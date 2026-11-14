import { openDb, type Db } from './connection'
import { migrate } from './migrate'
import { createSettingsRepo, type SettingsRepo } from './settingsRepo'
import { createTagsRepo, type TagsRepo } from './tagsRepo'
import { createTasksRepo, type TasksRepo } from './tasksRepo'

export interface Repos {
  db: Db
  tasks: TasksRepo
  tags: TagsRepo
  settings: SettingsRepo
}

export interface OpenDatabaseOptions {
  /** File path, or `:memory:` for tests. */
  path: string
  /** Injectable clock for tests. */
  now?: () => number
}

/** Opens the DB, runs migrations, purges expired soft-deletes and builds the repos. */
export function openDatabase({ path, now = Date.now }: OpenDatabaseOptions): Repos {
  const db = openDb({ path })
  try {
    migrate(db)
    const tags = createTagsRepo(db, now)
    const tasks = createTasksRepo(db, tags, now)
    const settings = createSettingsRepo(db)
    tasks.purgeDeleted()
    return { db, tasks, tags, settings }
  } catch (err) {
    db.close()
    throw err
  }
}

export type { Db } from './connection'
export { RepoError } from './errors'
export { SchemaTooNewError } from './migrate'
