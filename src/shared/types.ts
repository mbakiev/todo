// Domain types shared by main, preload and renderer. Pure TS only.

export type Status = 'not_started' | 'in_progress' | 'blocked' | 'done'
export type Priority = 1 | 2 | 3 | 4

/** A local calendar date formatted as `YYYY-MM-DD`. Never a timestamp. */
export type LocalDate = string

export interface Task {
  id: string
  title: string
  /** Markdown (GFM). */
  description: string
  status: Status
  priority: Priority
  startDate: LocalDate | null
  dueDate: LocalDate | null
  /** Manual order within a status column; lower = higher up. */
  position: number
  tagIds: string[]
  /** Epoch ms. */
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface Tag {
  id: string
  name: string
  /** Key into TAG_COLORS in shared/constants.ts. */
  color: TagColor
  createdAt: number
}

export type TagColor = 'slate' | 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'blue' | 'violet'

export type ThemeSetting = 'system' | 'light' | 'dark'
export type WeekStartsOn = 0 | 1
export type BoardSort = 'priority' | 'due' | 'manual'
export type ViewId = 'today' | 'week' | 'everything' | 'list' | 'timeline' | 'calendar'
export type BoardScope = 'today' | 'week' | 'everything'

export interface Settings {
  theme: ThemeSetting
  weekStartsOn: WeekStartsOn
  shortcuts: {
    /** Electron accelerator string, e.g. `Alt+Shift+T`. Empty string = disabled. */
    toggleApp: string
    quickAdd: string
  }
  launchAtLogin: boolean
  /** Board sort, persisted per board scope. */
  boardSort: Record<BoardScope, BoardSort>
  detailPanelWidth: number
  lastView: ViewId
  /** Persisted main window bounds (main process only; renderer can ignore). */
  windowBounds: WindowBounds | null
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
}

export interface DataChange {
  upsertedTasks?: Task[]
  removedTaskIds?: string[]
  /** Upserted tags. */
  tags?: Tag[]
  removedTagIds?: string[]
  /**
   * The records are authoritative even if older than what a window holds (an import can
   * write older versions). Otherwise a task broadcast older than the local copy is stale.
   */
  authoritative?: boolean
}

export interface ImportResult {
  mode: 'merge' | 'replace'
  tasksAdded: number
  tasksUpdated: number
  tasksSkipped: number
  tagsAdded: number
  tagsUpdated: number
  /** Safety copy taken before the import (absent when the local DB had no tasks). */
  backupPath?: string
}

export interface BackupInfo {
  /** Folder holding the `todos-YYYYMMDD-HHmmss.db` snapshots. */
  dir: string
  latest: { path: string; createdAt: number } | null
  count: number
}

export interface ExportFile {
  app: 'martin-todos'
  formatVersion: 1
  /** Epoch ms. */
  exportedAt: number
  tasks: Task[]
  tags: Tag[]
}

export interface AppInfo {
  version: string
  platform: Platform
  isDev: boolean
}

/** Mirror of NodeJS.Platform without depending on @types/node in shared code. */
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export interface ShortcutStatus {
  toggleApp: { accelerator: string; registered: boolean; error?: string }
  quickAdd: { accelerator: string; registered: boolean; error?: string }
}
