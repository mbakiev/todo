// Tray icon + menu (spec §9): Open, New Task, Settings…, Quit.
// - macOS: monochrome template image (adapts to light/dark menu bars); clicking opens the
//   menu (platform convention — setContextMenu handles left click there).
// - Windows: colour .ico (16–64 px) that reads on light and dark taskbars; left click
//   toggles the main window, right click opens the menu.
import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import { APP_DISPLAY_NAME } from '@shared/constants'
import type { AppContext } from './context'
import { resourcePath } from './paths'
import {
  openSettingsInMainWindow,
  requestNewTaskInMainWindow,
  showMainWindow,
  toggleMainWindow,
} from './windows/mainWindow'

let tray: Tray | null = null

function trayImage(): NativeImage {
  if (process.platform === 'darwin') {
    // `…Template.png` (+ @2x picked up automatically) is treated as a template image.
    const img = nativeImage.createFromPath(resourcePath('trayTemplate.png'))
    img.setTemplateImage(true)
    return img
  }
  if (process.platform === 'win32') return nativeImage.createFromPath(resourcePath('tray.ico'))
  return nativeImage.createFromPath(resourcePath('tray.png'))
}

export function buildTrayMenu(ctx: AppContext): Menu {
  return Menu.buildFromTemplate([
    { label: `Open ${APP_DISPLAY_NAME}`, click: () => void showMainWindow(ctx) },
    { label: 'New Task', click: () => requestNewTaskInMainWindow(ctx) },
    { type: 'separator' },
    { label: 'Settings…', click: () => void openSettingsInMainWindow(ctx) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
}

export function createTray(ctx: AppContext): void {
  if (tray) return
  const image = trayImage()
  if (image.isEmpty()) console.warn('[tray] icon not found at', resourcePath())
  tray = new Tray(image)
  tray.setToolTip(APP_DISPLAY_NAME)
  tray.setContextMenu(buildTrayMenu(ctx))
  if (process.platform !== 'darwin') {
    tray.on('click', () => toggleMainWindow(ctx, { focusGraceMs: 400 }))
  }
}

export function getTray(): Tray | null {
  return tray
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
