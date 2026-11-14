// Smoke test for the *packaged* app (electron-builder output), run by CI after packaging:
// `npm run test:packaged`. Not part of `npm run test:e2e` (which runs the unpackaged build).
//
// Like the e2e harness it uses a temp userData dir (MARTIN_TODOS_USER_DATA) and test mode
// (MARTIN_TODOS_E2E=1), so it never touches real data, real global shortcuts or login items.
// The executable is MARTIN_TODOS_PACKAGED_EXE, or else this platform's unpacked app under
// release/<version>/.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { windowByEntry } from './launch'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as {
  version: string
}

function packagedExecutable(): string {
  const fromEnv = process.env['MARTIN_TODOS_PACKAGED_EXE']
  if (fromEnv) return fromEnv
  const release = resolve(__dirname, '../release', pkg.version)
  if (process.platform === 'darwin') {
    const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    return join(release, dir, 'Martins To Dos.app', 'Contents', 'MacOS', 'Martins To Dos')
  }
  if (process.platform === 'win32') return join(release, 'win-unpacked', 'Martins To Dos.exe')
  return join(release, 'linux-unpacked', 'martin-todos')
}

let app: ElectronApplication | undefined
let userData: string | undefined

test.afterEach(async () => {
  await app?.close()
  if (userData) rmSync(userData, { recursive: true, force: true })
})

test('packaged app starts, renders the board and creates a task', async () => {
  const executablePath = packagedExecutable()
  expect(existsSync(executablePath), `packaged app not found: ${executablePath}`).toBe(true)
  userData = mkdtempSync(join(tmpdir(), 'martin-todos-packaged-'))
  app = await electron.launch({
    executablePath,
    env: { ...process.env, MARTIN_TODOS_USER_DATA: userData, MARTIN_TODOS_E2E: '1' },
  })

  // It really is the packaged build, with the right version, using the temp data folder.
  const info = await app.evaluate(({ app: a }) => ({
    isPackaged: a.isPackaged,
    version: a.getVersion(),
    userData: a.getPath('userData'),
  }))
  expect(info).toEqual({ isPackaged: true, version: pkg.version, userData })

  const page = await windowByEntry(app, 'index')
  await page.waitForSelector('[data-slot="view"]')
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()

  await page.getByRole('button', { name: 'New task' }).click()
  const input = page.getByRole('textbox', { name: 'Task title' })
  await input.fill('Packaged smoke task !high')
  await input.press('Enter')
  await expect(
    page.locator('[data-testid="board-today"] [data-task-id]', {
      hasText: 'Packaged smoke task',
    }),
  ).toBeVisible()

  // The database was created inside the temp userData dir.
  expect(existsSync(join(userData, 'data', 'todos.db'))).toBe(true)
})
