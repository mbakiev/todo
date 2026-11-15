// Windows only: plays the messages Windows sends to every top-level window at sign-out /
// shutdown (WM_QUERYENDSESSION, then WM_ENDSESSION) against one window, through a real
// SendMessage from another process — what Electron turns into `query-session-end` /
// `session-end`.
//
// PowerShell + Add-Type take ~2 s to start, longer than the detail panel's autosave debounce,
// so the sender is started first and fires only when told to: a test can type, then `fire()`
// while the edit is still pending.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ElectronApplication } from '@playwright/test'

const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SessionEnd {
  [DllImport("user32.dll")]
  static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
  // The LRESULT, or null when the window did not answer within 5 s (Windows would then show
  // "This app is preventing shutdown").
  public static long? Send(long hwnd, uint msg, long w) {
    IntPtr r;
    // lParam ENDSESSION_LOGOFF (0x80000000); SMTO_ABORTIFHUNG.
    var ok = SendMessageTimeout(new IntPtr(hwnd), msg, new IntPtr(w), new IntPtr(0x80000000L), 2, 5000, out r);
    return ok == IntPtr.Zero ? (long?)null : r.ToInt64();
  }
}
'@
[Console]::Out.WriteLine('ready')
$line = [Console]::In.ReadLine()
$hwnd, $gap = $line -split ' '
$query = [SessionEnd]::Send([long]$hwnd, 0x11, 0)          # WM_QUERYENDSESSION
Start-Sleep -Milliseconds ([int]$gap)
$end = [SessionEnd]::Send([long]$hwnd, 0x16, 1)            # WM_ENDSESSION, wParam TRUE
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{ query = $query; end = $end }))
`

export interface SessionEndResult {
  /** WM_QUERYENDSESSION's answer: non-zero lets the session end; null = no answer (hung). */
  query: number | null
  end: number | null
}

export interface SessionEndSender {
  /** Sends WM_QUERYENDSESSION, waits `gapMs`, then WM_ENDSESSION, to the given window. */
  fire(hwnd: bigint, gapMs?: number): Promise<SessionEndResult>
}

/** Starts the sender and resolves once it is ready to fire. */
export async function startSessionEndSender(): Promise<SessionEndSender> {
  const dir = mkdtempSync(join(tmpdir(), 'martin-todos-session-end-'))
  const file = join(dir, 'session-end.ps1')
  writeFileSync(file, SCRIPT)
  const ps = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  ps.once('exit', () => rmSync(dir, { recursive: true, force: true }))
  let stderr = ''
  ps.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
  const lines = createInterface({ input: ps.stdout })
  const next = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const onExit = (): void => reject(new Error(`session-end sender exited: ${stderr}`))
      ps.once('exit', onExit)
      lines.once('line', (l) => {
        ps.off('exit', onExit)
        resolve(l.trim())
      })
    })
  if ((await next()) !== 'ready') throw new Error(`session-end sender failed to start: ${stderr}`)
  return {
    async fire(hwnd, gapMs = 0) {
      const result = next()
      ps.stdin.end(`${hwnd} ${gapMs}\n`)
      return JSON.parse(await result) as SessionEndResult
    },
  }
}

/** The main window's HWND. */
export async function mainWindowHandle(app: ElectronApplication): Promise<bigint> {
  const bytes = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().split(/[?#]/)[0]?.endsWith('/index.html'),
    )
    if (!win) throw new Error('main window not found')
    return [...win.getNativeWindowHandle()]
  })
  return Buffer.from(bytes).readBigUInt64LE()
}
