// IPC channel names and the `Api` interface exposed on `window.api` by the preload.
// All calls are ipcRenderer.invoke → ipcMain.handle; every handler validates with zod.

import type {
  SettingsPatch,
  TagCreateInput,
  TagUpdatePatch,
  TaskCreateInput,
  TaskMoveInput,
  TaskUpdatePatch,
} from './schemas'
import type {
  AppInfo,
  DataChange,
  ImportResult,
  Settings,
  ShortcutStatus,
  Tag,
  Task,
} from './types'

export const IPC = {
  tasks: {
    list: 'tasks:list',
    create: 'tasks:create',
    update: 'tasks:update',
    move: 'tasks:move',
    delete: 'tasks:delete',
    restore: 'tasks:restore',
  },
  tags: {
    list: 'tags:list',
    create: 'tags:create',
    update: 'tags:update',
    delete: 'tags:delete',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
  },
  data: {
    exportToFile: 'data:exportToFile',
    importFromFile: 'data:importFromFile',
    backupNow: 'data:backupNow',
    revealDataFolder: 'data:revealDataFolder',
  },
  app: {
    getInfo: 'app:getInfo',
    showMainWindow: 'app:showMainWindow',
    hideQuickAdd: 'app:hideQuickAdd',
    resizeQuickAdd: 'app:resizeQuickAdd',
    getShortcutStatus: 'app:getShortcutStatus',
    openSettings: 'app:openSettings',
  },
  /** main → renderer events */
  events: {
    dataChanged: 'event:dataChanged',
    settingsChanged: 'event:settingsChanged',
    openTask: 'event:openTask',
    quickAddShown: 'event:quickAddShown',
    newTaskRequested: 'event:newTaskRequested',
    settingsRequested: 'event:settingsRequested',
    shortcutStatusChanged: 'event:shortcutStatusChanged',
  },
} as const

export type Unsubscribe = () => void

/** Inputs accept the zod *input* shapes (before defaults/transforms). */
export type CreateTaskInput = TaskCreateInput
export type UpdateTaskPatch = TaskUpdatePatch
export type MoveTaskInput = TaskMoveInput

export interface Api {
  tasks: {
    /** All non-deleted tasks. */
    list(): Promise<Task[]>
    /** New tasks land at the top of their status column. `newTagNames` are created (or matched case-insensitively). */
    create(input: CreateTaskInput): Promise<Task>
    update(id: string, patch: UpdateTaskPatch): Promise<Task>
    /**
     * Moves a task between neighbours (and optionally to another status). The repo computes
     * the midpoint position and renumbers the column if needed; renumbered siblings are
     * broadcast via `dataChanged`. Returns the moved task.
     */
    move(id: string, input: MoveTaskInput): Promise<Task>
    /** Soft delete. */
    delete(id: string): Promise<void>
    /** Undo a soft delete. */
    restore(id: string): Promise<Task>
  }
  tags: {
    list(): Promise<Tag[]>
    /** Colour is auto-assigned from the palette when omitted. Names are unique (case-insensitive). */
    create(input: TagCreateInput): Promise<Tag>
    update(id: string, patch: TagUpdatePatch): Promise<Tag>
    /** Hard delete; removes the tag from all tasks (affected tasks are broadcast). */
    delete(id: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    /** Shallow-merges top-level keys; `shortcuts` and `boardSort` are merged one level deep. */
    set(patch: SettingsPatch): Promise<Settings>
  }
  data: {
    /** Shows a save dialog; null if cancelled. */
    exportToFile(): Promise<{ path: string } | null>
    /** Shows an open dialog; null if cancelled. */
    importFromFile(mode: 'merge' | 'replace'): Promise<ImportResult | null>
    backupNow(): Promise<{ path: string }>
    revealDataFolder(): Promise<void>
  }
  app: {
    getInfo(): Promise<AppInfo>
    /** Shows + focuses the main window, optionally opening a task's detail panel. */
    showMainWindow(taskId?: string): Promise<void>
    hideQuickAdd(): Promise<void>
    /** Resize the quick-add window to fit its content (CSS px). */
    resizeQuickAdd(height: number): Promise<void>
    /** Current global-shortcut registration state, so Settings can surface failures. */
    getShortcutStatus(): Promise<ShortcutStatus>
    /** Shows the main window and asks it to open the Settings dialog. */
    openSettings(): Promise<void>
  }
  on: {
    dataChanged(cb: (e: DataChange) => void): Unsubscribe
    settingsChanged(cb: (s: Settings) => void): Unsubscribe
    openTask(cb: (taskId: string) => void): Unsubscribe
    quickAddShown(cb: () => void): Unsubscribe
    /** Tray/menu "New Task" inside the main window. */
    newTaskRequested(cb: () => void): Unsubscribe
    /** Tray/menu "Settings…". */
    settingsRequested(cb: () => void): Unsubscribe
    shortcutStatusChanged(cb: (s: ShortcutStatus) => void): Unsubscribe
  }
}

/** Error-message prefix for stubbed handlers not yet implemented. */
export const NOT_IMPLEMENTED = 'Not implemented'
