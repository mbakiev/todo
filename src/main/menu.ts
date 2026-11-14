// Application menu (spec §9). macOS gets the conventional app menu; the Edit menu's roles
// are what make copy/paste/undo work in text inputs on macOS. On Windows the menu bar is
// hidden (mainWindow.ts) but the menu stays installed so its accelerators keep working.
import { app, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { APP_DISPLAY_NAME } from '@shared/constants'
import type { AppContext } from './context'
import { appVersion } from './paths'
import { openSettingsInMainWindow, requestNewTaskInMainWindow } from './windows/mainWindow'

function showAbout(): void {
  if (process.platform === 'darwin') {
    app.showAboutPanel()
    return
  }
  void dialog.showMessageBox({
    type: 'info',
    title: `About ${APP_DISPLAY_NAME}`,
    message: APP_DISPLAY_NAME,
    detail: `Version ${appVersion()}`,
    buttons: ['OK'],
  })
}

export function buildAppMenu(ctx: AppContext): Menu {
  const mac = process.platform === 'darwin'
  const newTask: MenuItemConstructorOptions = {
    label: 'New Task',
    accelerator: 'CmdOrCtrl+N',
    click: () => requestNewTaskInMainWindow(ctx),
  }
  const settings: MenuItemConstructorOptions = {
    label: mac ? 'Settings…' : 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: () => void openSettingsInMainWindow(ctx),
  }

  const template: MenuItemConstructorOptions[] = []
  if (mac) {
    template.push({
      label: APP_DISPLAY_NAME,
      submenu: [
        { label: `About ${APP_DISPLAY_NAME}`, click: showAbout },
        { type: 'separator' },
        settings,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${APP_DISPLAY_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${APP_DISPLAY_NAME}` },
      ],
    })
  }
  template.push({
    label: 'File',
    submenu: mac
      ? [newTask, { type: 'separator' }, { role: 'close' }]
      : [
          newTask,
          { type: 'separator' },
          settings,
          { type: 'separator' },
          { role: 'quit', label: 'Exit' },
        ],
  })
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(mac ? [{ role: 'pasteAndMatchStyle' } as const] : []),
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' },
    ],
  })
  template.push({
    label: 'View',
    submenu: [
      ...(ctx.isDev
        ? ([
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
          ] as const)
        : []),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  })
  template.push({
    role: 'windowMenu',
    submenu: mac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  })
  if (!mac) {
    template.push({
      role: 'help',
      submenu: [{ label: `About ${APP_DISPLAY_NAME}`, click: showAbout }],
    })
  }
  return Menu.buildFromTemplate(template)
}

export function installAppMenu(ctx: AppContext): void {
  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: appVersion(),
  })
  Menu.setApplicationMenu(buildAppMenu(ctx))
}
