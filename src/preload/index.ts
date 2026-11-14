// Exposes the typed `window.api` (shared/ipc.ts) via contextBridge. Sandboxed: only
// `electron` may be required here; everything else is bundled.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type Api, type Unsubscribe } from '@shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: Api = {
  tasks: {
    list: () => invoke(IPC.tasks.list),
    create: (input) => invoke(IPC.tasks.create, input),
    update: (id, patch) => invoke(IPC.tasks.update, id, patch),
    move: (id, input) => invoke(IPC.tasks.move, id, input),
    delete: (id) => invoke(IPC.tasks.delete, id),
    restore: (id) => invoke(IPC.tasks.restore, id),
  },
  tags: {
    list: () => invoke(IPC.tags.list),
    create: (input) => invoke(IPC.tags.create, input),
    update: (id, patch) => invoke(IPC.tags.update, id, patch),
    delete: (id) => invoke(IPC.tags.delete, id),
  },
  settings: {
    get: () => invoke(IPC.settings.get),
    set: (patch) => invoke(IPC.settings.set, patch),
  },
  data: {
    exportToFile: () => invoke(IPC.data.exportToFile),
    importFromFile: (mode) => invoke(IPC.data.importFromFile, mode),
    backupNow: () => invoke(IPC.data.backupNow),
    revealDataFolder: () => invoke(IPC.data.revealDataFolder),
    getBackupInfo: () => invoke(IPC.data.getBackupInfo),
  },
  app: {
    getInfo: () => invoke(IPC.app.getInfo),
    showMainWindow: (taskId) => invoke(IPC.app.showMainWindow, taskId),
    hideQuickAdd: () => invoke(IPC.app.hideQuickAdd),
    resizeQuickAdd: (height) => invoke(IPC.app.resizeQuickAdd, height),
    getShortcutStatus: () => invoke(IPC.app.getShortcutStatus),
    openSettings: () => invoke(IPC.app.openSettings),
    setGlobalShortcutsSuspended: (suspended) =>
      invoke(IPC.app.setGlobalShortcutsSuspended, suspended),
  },
  on: {
    dataChanged: (cb) => subscribe(IPC.events.dataChanged, cb),
    settingsChanged: (cb) => subscribe(IPC.events.settingsChanged, cb),
    openTask: (cb) => subscribe(IPC.events.openTask, cb),
    quickAddShown: (cb) => subscribe(IPC.events.quickAddShown, () => cb()),
    newTaskRequested: (cb) => subscribe(IPC.events.newTaskRequested, () => cb()),
    settingsRequested: (cb) => subscribe(IPC.events.settingsRequested, () => cb()),
    shortcutStatusChanged: (cb) => subscribe(IPC.events.shortcutStatusChanged, cb),
  },
}

contextBridge.exposeInMainWorld('api', api)
