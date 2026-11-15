# Windows handover checklist

The app was developed on macOS. Since the GitHub Actions CI (README "CI and releases") it is
also built and tested on a `windows-latest` runner (Windows Server, x64) on every push and
PR — see "What CI proves on Windows" below. The rest needs a real desktop session. Most of
it was run on a Windows 11 desktop on 2026-11-14 (see "Windows 11 desktop pass" below;
ticked items passed there, notes say what was and wasn't covered); unticked items still need
a person. Work top to bottom; items are in priority order. File references are to
`src/main/` unless stated otherwise.

## What CI proves on Windows

Checked on every run (`.github/workflows/ci.yml`, `package.yml`):

- `npm ci`, typecheck, and `npm test` pass on Windows (unit tests in `TZ=America/New_York`,
  checked by `src/main/unitTestTimezone.test.ts`), including the startup-recovery tests
  against real files (a damaged DB held open by another SQLite handle can't be moved aside).
- The Playwright `_electron` e2e suite (`npm run test:e2e`) passes against the unpackaged
  build: boards, list, timeline, calendar, detail panel, quick-add window (shown via a test
  hook), settings, export/import, crash recovery, quit gate, startup dialogs (stubbed),
  clipboard (CRLF line endings), window sizing. One test is skipped on Windows: "SIGTERM saves
  pending edits" — Windows has no catchable SIGTERM.
- `npm run dist:win` builds `MartinsToDos-<version>-win-x64-setup.exe` (unsigned) without
  errors.
- The packaged app (`release/<version>/win-unpacked`) starts as a packaged build with the right
  version, renders the board and creates a task (`npm run test:packaged`).
- The NSIS installer installs **silently** (`/S`) per-user to
  `%LOCALAPPDATA%\Programs\Martins To Dos\` without UAC, the installed exe passes the same
  smoke test, and the silent uninstaller removes it.

Not covered by CI (still manual, below):

- **Global hotkeys**: e2e uses a fake registrar (`MARTIN_TODOS_E2E=1`), so real
  `globalShortcut` registration, AltGr collisions and taken combos (3.7, 3.11) are untested.
- **Focus behaviour**: quick-add returning focus to the previous app, foreground rights,
  taskbar flashing (3.1, 3.2) — CI drives windows programmatically, not with real input.
- **Tray** icon, menu and left-click toggle (3.3); **close-to-tray** via the real ✕ button.
- **Logoff / shutdown**: the `query-session-end` / `session-end` path (3.4) has **no test** at
  all (unit or e2e); the SIGTERM test that covers the same quit gate on macOS is skipped on
  Windows.
- **Installer UI**: the assisted pages, the finish-page "Run" and desktop-shortcut checkboxes,
  Start-menu entry and icon, AUMID / taskbar pinning, upgrade-in-place (2). Silent install
  skips every page.
- **Launch at login** (3.6): disabled in test mode. **SmartScreen**: the runner never downloads
  the installer from the internet. **Multi-monitor / mixed DPI** (3.2, 3.10), dark taskbar
  rendering of `tray.ico`, file dialogs (3.8, stubbed or bypassed in e2e), single-instance
  re-launch from the Start menu (3.9).

## Windows 11 desktop pass (2026-11-14)

Windows 11 Enterprise 24H2 (10.0.26100), x64, two 5120×2880 monitors at 200 %, en-US
keyboard only, behind a TLS-inspecting proxy; Node 24.22.3. The installed app (silent `/S`
install of the locally built setup exe) was driven with real mouse/keyboard input and UI
Automation against a throwaway profile (`MARTIN_TODOS_USER_DATA`), not in test mode.

Bugs found and fixed:

- **Quick add reopened on the previous monitor** after a focus-returning hide: bounds set
  while the window is still minimized are lost when `restore()` runs. It is now positioned
  inside `prepareToShow` after the restore (`windows/hideWindow.ts`, `quickAddWindow.ts`);
  regression e2e test in `e2e/shell.spec.ts`.
- **A data file held open by another program read as "damaged"**, not "locked": on Windows
  SQLite reports a sharing violation as a generic "unable to open database file".
  `explainOpenError` (`services/startupRecovery.ts`, unit-tested) re-opens the file to tell
  them apart, so the user gets Try again instead of an offer to move the file aside.
- **"Reveal data folder" in the startup dialog opened nothing**: `shell.openPath` returns
  before Explorer has the request, and the app quits right after. `startup.ts` now starts
  `explorer.exe <folder>` as a separate process on Windows.
- **Sign-out had no test**: new Windows-only e2e test (`e2e/data-loss.spec.ts`,
  `e2e/windowsSessionEnd.ts`) sends the real `WM_QUERYENDSESSION` / `WM_ENDSESSION` from
  another process while an edit is still inside the autosave debounce.
- Node floor raised to 22.16 (0); proxy note added (0).

Still needs a person: SmartScreen on a downloaded installer and the assisted installer pages
(2); taskbar pin (2); a real sign-out / shutdown / restart (3.4, 3.6); mixed DPI (3.2); AltGr
layouts (3.11, likely a product decision); the tray icon on a light taskbar and at
100–150 % (3.3); recording a Win combo (3.7); export / import dialogs and backup rotation
(3.8); dark mode (3.2, 3.10).

## 0. Prerequisites

- [x] Windows 10 22H2 or Windows 11, x64.
- [x] Node **22.16+** (`node -v`) and npm (bundled); CI uses 24 (`.nvmrc`). On 22.12–22.15
      the app itself is fine (it runs on Electron's Node 24) but 11 DB unit tests fail:
      `node:sqlite` there has no `isTransaction`, so `Db.transaction` never rolls back. No
      Python / Visual Studio build tools needed: the app has no native modules (SQLite is
      Node's built-in `node:sqlite`).
- [x] Behind a TLS-inspecting corporate proxy (Netskope, Zscaler…) `npm ci` fails with
      `SELF_SIGNED_CERT_IN_CHAIN` (npm may only print "Exit handler never called!"). If the
      proxy's root CA is in the Windows certificate store, set `NODE_OPTIONS=--use-system-ca`
      (Node 22.15+) for the install instead of turning off certificate checks.
- [x] Git for Windows. The repo's `.gitattributes` forces LF line endings, so
      `core.autocrlf` doesn't matter; if you cloned before it existed, re-clone.
- [x] Network access to registry.npmjs.org and to GitHub releases (Electron and
      electron-builder's NSIS tooling download on first use).

## 1. Install, run, build

```powershell
git clone <repo> martin-todos; cd martin-todos
npm ci
npm run typecheck; npm run lint; npm test   # should all pass as on macOS
npm run test:e2e                            # Playwright _electron suite (temp userData + MARTIN_TODOS_E2E=1)
npm run seed                                # dev app with demo data (<%APPDATA%>\Martins To Dos-dev)
npm run dist:win                            # → release\0.1.0\MartinsToDos-0.1.0-win-x64-setup.exe
```

- [x] All npm scripts are plain commands chained with `&&` (no `VAR=x` prefixes, no `rm`,
      no globs), so they run the same in PowerShell and cmd. Report any that don't.
      *Pass:* npm runs them through `cmd.exe` whatever shell you call it from.
- [x] `npm run dist:win` succeeds (proven by CI). It runs on Windows only (it hasn't been
      tried by cross-building). Unsigned: expect a "no code signing certificate configured,
      signing is skipped" message, not an error. *Locally:* if the worktree is open in an
      Electron-based tool whose file watcher holds `.asar` files (seen with Orca), it fails
      with EBUSY / EPERM on `win-unpacked
esources\default_app.asar`. Build into a folder
      outside the watched tree:
      `npx electron-builder --win "-c.directories.output=%TEMP%\mt-release"`.
- [x] Watch for e2e failures caused by Windows itself (focus, timing) vs real bugs.
      *Pass:* 91 passed, 1 skipped (SIGTERM) in 10 min; the two tests added since pass in
      their spec runs. One one-off failure under load right after a build ("a renderer that
      never answers cannot hang quit", 6 s limit); it passed 4/4 in isolation and in two
      full-spec runs.

## 2. Installer (do this before the behaviour checks; most of them need the installed app)

Config: `electron-builder.yml` (`win`, `nsis`) and `build/installer.nsh`.

- [ ] **SmartScreen**: the installer is unsigned, so on first run expect "Windows protected
      your PC" → *More info* → *Run anyway*. Write down exactly what shows. Edge/Chrome may
      also flag the download as "not commonly downloaded" (*Keep*).
- [ ] No UAC prompt. No "all users / just me" page (forced per-user by
      `customInstallMode`). Installs to `%LOCALAPPDATA%\Programs\Martins To Dos\`.
      *Partly:* silent install and upgrade: no UAC, right folder. The assisted pages weren't
      clicked through.
- [ ] Finish page has **Run Martins To Dos** (checked) and **Create a desktop shortcut**
      (unchecked). Both work. The desktop-shortcut checkbox is custom NSIS
      (`customFinishPage`); if it looks broken, set `createDesktopShortcut: true` in
      `electron-builder.yml` and delete the `customFinishPage`/`customUnInstall` macros.
- [x] Start menu entry "Martins To Dos" with the indigo check icon (`build/icon.ico`);
      icon also on the installer, uninstaller, exe, taskbar and Alt+Tab. *Pass:* the
      Windows shell renders the exe, installer and uninstaller icons cleanly at 16–256 px.
      All ICO frames are PNG-compressed, which .NET's `System.Drawing.Icon` can't decode
      (noise); Windows can. Alt+Tab wasn't looked at.
- [ ] Pin to taskbar, then launch from the pin: **one** taskbar button, not two. This needs
      `app.setAppUserModelId('com.martin.todos')` (`index.ts`) to match the shortcut's AUMID.
      *Partly:* `Get-StartApps` shows the Start-menu shortcut's AppID is `com.martin.todos`,
      so it matches. The pin itself wasn't tried.
- [ ] Uninstall (Settings → Apps): removes the Start menu and desktop shortcuts and the
      Run-at-login entry (see 6). Keeps `%APPDATA%\Martins To Dos\` (by design).
- [x] Re-run the installer over an existing install: upgrades in place, data intact.
      *Pass* (silent `/S`): no UAC, the app isn't started, data intact.

## 3. Behaviours to verify, in priority order

### 3.1 Quick-add returns focus to the previous app (highest risk)
`windows/hideWindow.ts` (`hideWindowReturningFocus`), `windows/quickAddWindow.ts`.
Chromium hides windows without activating another, so on Windows the code does
`setOpacity(0) → minimize() → hide() → setOpacity(1)` to make Windows activate the
previous window, and `prepareToShow()` restores before the next show.
- [x] From Notepad: `Ctrl+Alt+N`, type, **Enter** → popup hides, Notepad has focus and a
      blinking caret, so typing goes into Notepad. Repeat with **Esc**. Repeat from a browser,
      Explorer, and a full-screen/maximized app. *Pass* with a plain WinForms window standing
      in for Notepad, plus Explorer, a Chromium app and a maximized window: after Enter, Esc,
      blur or the hotkey again, the previous app is in front and the next keystrokes land
      there.
- [ ] No flash of a minimize animation, no taskbar button blinking. (Not watched by eye.)
- [x] The popup is created with `minimizable: false` and `type: 'toolbar'`. Check that
      `minimize()` still takes effect on such a window. If focus does **not** return,
      this is the first suspect. *Pass:* the popup is minimized after the hide.
- [x] Clicking elsewhere (blur) hides the popup and keeps the draft (plain `hide()` path).
      Esc and Enter clear it (by design).
- [x] Same for the main window: `Ctrl+Alt+T` while it's focused hides it and focus goes
      back to the previous app (`toggleMainWindow` → `hideMainWindow` → same helper).

### 3.2 Quick-add window behaviour
- [x] Title field has keyboard focus as soon as it shows; you can type straight away
      (the hotkey press should give the process the foreground right).
- [x] Not in the taskbar, not in Alt+Tab (`skipTaskbar` + `type: 'toolbar'`), always on top.
      *Pass:* `WS_EX_TOOLWINDOW` + `WS_EX_TOPMOST`, no `WS_EX_APPWINDOW`.
- [x] Multi-monitor: opens on the monitor under the **mouse cursor**, centred, upper third
      (`quickAddPosition.ts`). *Failed, fixed* (it reopened on the previous monitor; see
      "Windows 11 desktop pass"). Now centred with its top at 20 % of the work area on
      whichever monitor has the cursor.
- [ ] Mixed DPI (e.g. 100% laptop + 150% external): width stays ~640 px (logical) on both;
      moving between them doesn't grow/shrink it (`setSize` re-applied on win32 in
      `showQuickAdd`). Height follows content (`resizeQuickAdd`). Not testable on the test
      machine (both monitors at 200 %).
- [ ] Rounded corners/shadow look acceptable on Windows 11; no white flash in dark mode.
      *Partly:* light mode looks right; dark mode not looked at.

### 3.3 Tray (`tray.ts`, `resources/tray.ico`)
- [ ] Icon is crisp at 100/125/150/200% scaling and readable on **light and dark**
      taskbars (solid indigo tile, PNG-in-ICO 16–64 px). Note: this ICO can't be decoded
      on macOS, so it has never been rendered in the app. *Partly:* crisp on a dark taskbar
      at 200 %, and Windows' decoder draws every frame cleanly on light and dark
      backgrounds. A live light taskbar and 100–150 % weren't checked.
- [x] **Left-click** toggles the main window (400 ms focus grace, so a click while the
      window is focused hides it rather than re-showing). *Pass:* behind another app → to
      the front; focused → hidden; hidden → shown with focus.
- [x] **Right-click** shows: Open Martin's To Dos, New Task, Settings…, Quit. Each brings
      the window to the front (one dialog for New Task / Settings…). The menu is a Chromium
      window, not a Win32 `#32768` menu, which matters for UI automation.
- [x] Tooltip reads "Martin's To Dos". Icon may land in the overflow (^) area; that's normal.
      The tests pinned it by setting the icon's `IsPromoted` registry value, which Explorer
      reset on every relaunch. Check whether a user's own drag onto the taskbar survives a
      restart.

### 3.4 Close-to-tray and quitting (`index.ts`, `windows/mainWindow.ts`)
- [x] Title-bar ✕ hides the window; the app keeps running in the tray. Focus goes to the
      next window.
- [x] Tray **Quit**, File → **Exit** (`Alt` to show the menu) and `Alt+F4`-then-Quit really
      end the process (check Task Manager: no leftover `Martins To Dos.exe`).
- [ ] **Shutdown / sign-out / restart** with the app running (window shown *and* hidden):
      Windows must not show "This app is preventing shutdown". Handled by the
      `query-session-end` / `session-end` listeners on the main window, which set
      `ctx.quitting`, ask the renderer to save pending edits (`query-session-end`) and close
      the DB (`session-end`; Windows emits no before-quit / will-quit then — see
      `quitGate.ts`). The hidden quick-add window also vetoes `close` unless quitting.
      Verify both paths, and that text typed in a task description just before sign-out is
      still there afterwards. *Partly:* the new e2e test (see "Windows 11 desktop pass")
      sends the real messages back to back. The app answers "go ahead", handles
      `WM_ENDSESSION` without hanging, and the pending edit is in the database after a
      relaunch. A real sign-out / shutdown / restart still needs a person.

### 3.5 Hidden menu bar + accelerators (`menu.ts`, `mainWindow.ts`)
- [x] Menu bar hidden (`autoHideMenuBar` + `setMenuBarVisibility(false)`). `Ctrl+N` (new
      task) and `Ctrl+,` (settings) work from the main window. They are handled both
      by the menu accelerators and by `renderer/src/app/useShellShortcuts.ts`. Check that one
      press opens exactly one dialog, and that `Ctrl+N` still works inside a text field.
- [ ] Pressing `Alt` alone shows the menu bar (autoHide behaviour). Decide if that's OK.
      *Behaviour:* it shows File Edit View Window Help and pushes the content down until the
      next click or Alt.
- [x] Help → About shows "Version 0.1.0". Edit-menu copy/paste work in text fields.
      (Copy/paste through the Edit menu not tried.)

### 3.6 Launch at login (`services/autoLaunch.ts`)
- [x] Settings → General → Launch at login **on** creates
      `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value pointing at the installed
      exe (quoted path) with `--hidden`. Also listed in Task Manager → Startup apps.
      *Pass:* `com.martin.todos` = `"…\Programs\Martins To Dos\Martins To Dos.exe" --hidden`.
      Task Manager wasn't opened.
- [ ] Sign out/in: the app starts **hidden in the tray** (no window). *Partly:* a launch
      with `--hidden` (what the Run value does) shows no window and takes no focus. The tray
      icon is there, and clicking it opens the window. A real sign-in not done.
- [x] Toggle off removes the Run value. Only active in installed builds (`app.isPackaged`),
      never in `npm run dev` or e2e. Off also removes Windows' `StartupApproved` entry.
- [x] If the user disables it in Task Manager, the toggle state may disagree with Windows.
      Note what happens. *Result* (Task Manager's "disabled" `StartupApproved` value written
      directly): the switch stays **On** and the Run value stays, but Windows won't start the
      app. Switching it off and on again in Settings re-enables it. To show Windows' view
      instead, `app.getLoginItemSettings()` on Windows reports `executableWillLaunchAtLogin`
      (product decision).

### 3.7 Shortcut recorder (Settings → Shortcuts; `shared/accelerators.ts`)
- [ ] Record `Ctrl+Alt+Space`, `Win+Shift+K`, etc. Win shows as "Win" and is saved as
      `Super`. Recorder suspends real hotkeys while listening. *Partly:* `Ctrl+Alt+Space`
      records and shows "Active". Win combos weren't recorded (the tests sent no Win-key
      input), and suspending while listening wasn't checked.
- [x] OS-reserved Win combos (Win+L, Win+D, Win+E…) and combos already taken by other apps
      fail to register; Settings must **show the error**, not silently fail. *Pass:*
      `RegisterHotKey` refuses Win+L, Win+D and Win+E; Win+Shift+K is free. With `Ctrl+Alt+N`
      held by another process, Settings → Shortcuts shows "Already in use by another app or
      by the system". A refused Win combo fails the same way, but wasn't recorded.
- [x] Changing the shortcut takes effect immediately, and the old combo is freed. A newly
      recorded combo opens quick add from another app at once. Reset to default releases it
      at once.

### 3.8 File dialogs and data folder (`services/exportImport.ts`, `ipc/data.ts`)
- [ ] Export → native Save dialog, `.json` written; Import → Open dialog; Merge and
      Replace all work; dialogs are modal to the main window.
- [ ] "Reveal data folder" opens Explorer at `%APPDATA%\Martins To Dos\data`. (Settings'
      button not tried. It uses `shell.openPath` with the app still running, which works.
      Only the reveal-then-quit path in the startup dialog was broken.)
- [ ] Backups appear in `%APPDATA%\Martins To Dos\backups\` (startup snapshot ~3 s after
      launch once there is at least one task, then every 24 h, newest 14 kept; "Back up now"
      files are `todos-manual-…`, newest 10). *Partly:* the startup snapshot appeared (and
      Restore used it). Rotation and "Back up now" weren't checked.
- [ ] Open the oldest backup in another program (e.g. DB Browser for SQLite) and take
      backups until it should rotate out: backups keep working (the locked file is skipped
      and deleted at a later rotation).
- [x] Startup problems (`startup.ts`): with the app quit, replace `data\todos.db` with a
      text file → launch shows "can't read your data file" with Reveal / Restore / Quit;
      Restore keeps the bad file as `todos.db.broken-…` and opens the backup. Open
      `todos.db` exclusively in another program → the "locked" message with **Try again** /
      Reveal / Quit (no restore); Try again keeps failing while the file is held and opens
      the app once it is released. With the damaged file open in another program (so it
      can't be renamed), Restore must come back to the dialog saying the file couldn't be
      moved aside — not exit with a raw error. Check that no `Martins To Dos.exe` is left
      running after choosing Quit. *Pass* after two fixes (see "Windows 11 desktop pass"):
      a lock was reported as damage, and Reveal opened no Explorer window. Now, with the
      native dialogs driven by their own button messages:
      - Missing file with backups: Restore / Start fresh / Quit.
      - Damaged: Reveal opens Explorer at `data` and quits without touching the file;
        Restore keeps `todos.db.broken-…` and opens.
      - Damaged file held open: Restore comes back with "couldn't be moved aside" and nothing
        changes on disk.
      - Locked: Try again keeps coming back while the file is held. Reveal opens Explorer
        and the dialog returns. Try again after release opens the app with the data intact.
      - Quit leaves no process in every case.

### 3.9 Single instance (`index.ts`)
- [x] With the app hidden in the tray, launch it again from Start/desktop: no second
      process, and the existing window is shown and focused (not just flashing in the taskbar).
      *Pass* when launched from a foreground app, as Start, the desktop and Explorer are: the
      second process exits, the window comes to the front with focus, and the process count
      is unchanged. A launch from a background process can't take the foreground (Windows'
      foreground lock), so test it by hand from Start.

### 3.10 Window chrome and look
- [x] Standard Windows frame/title bar reading "Martin's To Dos"; the renderer has no
      overlap with the frame (mac-only `hiddenInset` isn't applied).
- [x] Window / taskbar icon: Windows uses the full-bleed `resources/icon.ico` (same tile-cropped
      artwork as `build/icon.ico`, written by `npm run icons`, shipped via `extraResources`;
      chosen in `mainWindow.ts` `platformChrome`). It should fill the title-bar and taskbar
      slot like other apps' icons; Linux keeps `resources/icon.png`.
- [x] Bounds/maximized state restored after restart, including after a monitor is
      unplugged (window must come back on-screen). *Pass:* the exact bounds on the second
      monitor; maximized comes back maximized on the same monitor, and un-maximize goes back
      to the saved bounds. Bounds saved for a monitor that no longer exists open centred on
      the primary at the saved size (simulated, not unplugged).
- [ ] Light/dark follows Windows' app mode; fonts (Segoe UI) look right; scrollbars OK.
      *Partly:* light mode and fonts look right; dark mode not looked at.

### 3.11 Default global shortcuts
- [x] Windows defaults are `Ctrl+Alt+N` (quick add) / `Ctrl+Alt+T` (show / hide), chosen
      because left `Alt+Shift` is Windows' default *switch input language* hotkey (macOS
      keeps `⌥⇧N` / `⌥⇧T`). Resolved in one place: `defaultShortcuts()` in
      `shared/constants.ts`. Only unset values use them: shortcuts already stored in
      settings are never rewritten; Settings → Shortcuts → reset uses the Windows default.
- [x] On a fresh install both register (Settings → Shortcuts shows "Active").
- [ ] **Check:** on keyboard layouts where `AltGr` = `Ctrl+Alt` (e.g. Polish, German),
      `AltGr+N` / `AltGr+T` may produce a character that the shortcut now swallows, or the
      shortcut may fire while typing. Also check collisions with apps in use (Teams, Office,
      PowerToys, IDEs). Not testable here (en-US only). Expected: Windows delivers AltGr as
      Ctrl+Alt, so on Polish (Programmers) `AltGr+N` is `ń` and the registered `Ctrl+Alt+N`
      takes it: no `ń` while the app runs. Likely a product decision (another default for
      such layouts, or tell the user in Settings).
- [x] With the combo taken by another app, opening the main window shows one toast naming
      the shortcut, with **Change…** opening Settings → Shortcuts.

## 4. Reporting back

For each item: pass / fail / notes, Windows version, display scaling, and for failures
a screen recording if focus or timing is involved.
