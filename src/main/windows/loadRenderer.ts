import { shell, type BrowserWindow } from 'electron'
import { rendererEntry } from '../paths'

/**
 * Loads a renderer entry and locks navigation down: no in-app navigation, no new windows;
 * http(s)/mailto links (e.g. from task descriptions) open in the system browser.
 */
export function loadRenderer(win: BrowserWindow, entry: 'index' | 'quick-add'): Promise<void> {
  const wc = win.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    if (url !== wc.getURL()) {
      event.preventDefault()
      if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url)
    }
  })
  const target = rendererEntry(entry)
  return 'url' in target ? win.loadURL(target.url) : win.loadFile(target.file)
}
