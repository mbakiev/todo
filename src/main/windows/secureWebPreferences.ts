import { join } from 'node:path'
import type { WebPreferences } from 'electron'

/** Security baseline shared by every window (spec §2). */
export function secureWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: true,
  }
}
