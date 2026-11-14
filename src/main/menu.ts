// Application menu (spec §9). macOS gets the conventional app menu; the Edit menu's roles
// are what make copy/paste/undo work in text inputs on macOS. On Windows the menu bar is
// hidden (mainWindow.ts) but the menu stays installed so its accelerators keep working.
import { app, dialog, Menu, type KeyboardEvent, type MenuItemConstructorOptions } from 'electron'
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
  // While the main window is focused its renderer owns Cmd/Ctrl+N and Cmd/Ctrl+, (it also
  // receives the key press; useShellShortcuts.ts). Acting on the accelerator here too would
  // open the dialog twice, so only clicks and presses from elsewhere (quick-add window, no
  // window) are handled by the menu.
  const ownedByRenderer = (event: KeyboardEvent): boolean => {
    const main = ctx.getMainWindow()
    return event.triggeredByAccelerator === true && !!main && main.isFocused()
  }
  const newTask: MenuItemConstructorOptions = {
    id: 'new-task',
    label: 'New Task',
    accelerator: 'CmdOrCtrl+N',
    click: (_item, _win, event) => {
      if (!ownedByRenderer(event)) requestNewTaskInMainWindow(ctx)
    },
  }
  const settings: MenuItemConstructorOptions = {
    id: 'settings',
    label: mac ? 'Settings…' : 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: (_item, _win, event) => {
      if (!ownedByRenderer(event)) void openSettingsInMainWindow(ctx)
    },
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
