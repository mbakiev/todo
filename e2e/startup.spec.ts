// Startup failure handling: a database that cannot be opened must never leave an invisible
// process behind; the user's dialog choice is stubbed via MARTIN_TODOS_STARTUP_DIALOG_CHOICE
// (honoured only with MARTIN_TODOS_E2E=1).
import { spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import electronPath from 'electron'
import type { Api } from '../src/shared/ipc'
import { launchShell, tempUserData, type ShellApp } from './shellHelpers'

let shell: ShellApp | undefined
const dirs: string[] = []

test.afterEach(async () => {
  await shell?.close()
  shell = undefined
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function userDataDir(): string {
  const d = tempUserData()
  dirs.push(d)
  return d
}

const dbFile = (userData: string): string => join(userData, 'data', 'todos.db')

/** Runs the app to completion; resolves with its exit code and output (or fails on timeout). */
function runToExit(
  userData: string,
  choice: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((done, fail) => {
    const child = spawn(
      electronPath as unknown as string,
      [resolve(__dirname, '../out/main/index.js')],
      {
        env: {
          ...process.env,
          MARTIN_TODOS_USER_DATA: userData,
          MARTIN_TODOS_E2E: '1',
          MARTIN_TODOS_STARTUP_DIALOG_CHOICE: choice,
          ELECTRON_RENDERER_URL: '',
        },
      },
    )
    let output = ''
    child.stdout.on('data', (b: Buffer) => (output += b.toString()))
    child.stderr.on('data', (b: Buffer) => (output += b.toString()))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`app did not exit within 20 s (lingering). Output:\n${output}`))
    }, 20_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      done({ code, output })
    })
  })
}

/** A real database with one task, created by the app itself. */
async function databaseWithTask(userData: string, title: string): Promise<void> {
  const s = await launchShell({ userData })
  await s.page.evaluate(
    (t) =>
      (globalThis as unknown as { api: Api }).api.tasks.create({
        title: t,
      }),
    title,
  )
  await s.close({ keepUserData: true })
}

test('a corrupt database with no backup: the dialog is shown and the app exits', async () => {
  const userData = userDataDir()
  mkdirSync(join(userData, 'data'), { recursive: true })
  writeFileSync(dbFile(userData), 'this is not a sqlite database '.repeat(50))

  const { output } = await runToExit(userData, 'quit')
  expect(output).toContain("can't read your data file")
  expect(output).not.toContain('"id":"restore"')
  // Nothing was deleted or replaced.
  expect(readdirSync(join(userData, 'data'))).toEqual(['todos.db'])
})

test('a database from a newer version: no restore offered, the app exits', async () => {
  const userData = userDataDir()
  await databaseWithTask(userData, 'kept as is')
  mkdirSync(join(userData, 'backups'), { recursive: true })
  copyFileSync(dbFile(userData), join(userData, 'backups', 'todos-20260101-000000.db'))
  // Playwright's module loader cannot import node:sqlite directly.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(dbFile(userData))
  db.exec('PRAGMA user_version = 999')
  db.close()

  const { output } = await runToExit(userData, 'restore')
  expect(output).toContain('created by a newer version')
  expect(output).not.toContain('"id":"restore"')
  expect(readdirSync(join(userData, 'data')).some((n) => n.includes('broken'))).toBe(false)
})

test('a corrupt database with a backup: restore moves it aside and starts from the backup', async () => {
  const userData = userDataDir()
  await databaseWithTask(userData, 'Saved in the backup')
  mkdirSync(join(userData, 'backups'), { recursive: true })
  copyFileSync(dbFile(userData), join(userData, 'backups', 'todos-20260101-000000.db'))
  writeFileSync(dbFile(userData), 'garbage '.repeat(100))

  shell = await launchShell({
    userData,
    env: { MARTIN_TODOS_STARTUP_DIALOG_CHOICE: 'restore' },
  })
  await expect(shell.page.getByText('Saved in the backup').first()).toBeVisible()
  const files = readdirSync(join(userData, 'data'))
  const broken = files.filter((n) => n.startsWith('todos.db.broken-'))
  expect(broken).toHaveLength(1) // kept, never deleted (-wal/-shm handling: unit-tested)
  expect(readFileSync(join(userData, 'data', broken[0] ?? '?'), 'utf8')).toContain('garbage')
})

test('a missing database while backups exist: asks, and restore brings the tasks back', async () => {
  const userData = userDataDir()
  await databaseWithTask(userData, 'Back from the backup')
  mkdirSync(join(userData, 'backups'), { recursive: true })
  copyFileSync(dbFile(userData), join(userData, 'backups', 'todos-20260101-000000.db'))
  rmSync(join(userData, 'data'), { recursive: true, force: true })

  // Quit leaves everything as it was.
  const { output } = await runToExit(userData, 'quit')
  expect(output).toContain('data file is missing')
  expect(existsSync(dbFile(userData))).toBe(false)

  shell = await launchShell({
    userData,
    env: { MARTIN_TODOS_STARTUP_DIALOG_CHOICE: 'restore' },
  })
  await expect(shell.page.getByText('Back from the backup').first()).toBeVisible()
})
