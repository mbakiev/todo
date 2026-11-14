# Windows handover checklist

The app has only been built and run on macOS. Everything Windows-specific below was
reviewed against the code but **never executed**. Work top to bottom; items are in
priority order. File references are to `src/main/` unless stated otherwise.

## 0. Prerequisites

- [ ] Windows 10 22H2 or Windows 11, x64.
- [ ] Node **22.12+** (`node -v`) and npm (bundled). No Python / Visual Studio build tools
      needed: the app has no native modules (SQLite is Node's built-in `node:sqlite`).
- [ ] Git for Windows. The repo's `.gitattributes` forces LF line endings, so
      `core.autocrlf` doesn't matter; if you cloned before it existed, re-clone.
- [ ] Network access to registry.npmjs.org and to GitHub releases (Electron and
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

- [ ] All npm scripts are plain commands chained with `&&` (no `VAR=x` prefixes, no `rm`,
      no globs), so they run the same in PowerShell and cmd. Report any that don't.
- [ ] `npm run dist:win` succeeds. It runs on Windows only (it hasn't been tried by
      cross-building). Unsigned: expect a "no signing info" message, not an error.
- [ ] Watch for e2e failures caused by Windows itself (focus, timing) vs real bugs.

## 2. Installer (do this before the behaviour checks; most of them need the installed app)

Config: `electron-builder.yml` (`win`, `nsis`) and `build/installer.nsh`.

- [ ] **SmartScreen**: the installer is unsigned, so on first run expect "Windows protected
      your PC" → *More info* → *Run anyway*. Write down exactly what shows. Edge/Chrome may
      also flag the download as "not commonly downloaded" (*Keep*).
- [ ] No UAC prompt. No "all users / just me" page (forced per-user by
      `customInstallMode`). Installs to `%LOCALAPPDATA%\Programs\Martins To Dos\`.
- [ ] Finish page has **Run Martins To Dos** (checked) and **Create a desktop shortcut**
      (unchecked). Both work. The desktop-shortcut checkbox is custom NSIS
      (`customFinishPage`); if it looks broken, set `createDesktopShortcut: true` in
      `electron-builder.yml` and delete the `customFinishPage`/`customUnInstall` macros.
- [ ] Start menu entry "Martins To Dos" with the indigo check icon (`build/icon.ico`);
      icon also on the installer, uninstaller, exe, taskbar and Alt+Tab.
- [ ] Pin to taskbar, then launch from the pin: **one** taskbar button, not two. This needs
      `app.setAppUserModelId('com.martin.todos')` (`index.ts`) to match the shortcut's AUMID.
- [ ] Uninstall (Settings → Apps): removes the Start menu and desktop shortcuts and the
      Run-at-login entry (see 6). Keeps `%APPDATA%\Martins To Dos\` (by design).
- [ ] Re-run the installer over an existing install: upgrades in place, data intact.

## 3. Behaviours to verify, in priority order

### 3.1 Quick-add returns focus to the previous app (highest risk)
`windows/hideWindow.ts` (`hideWindowReturningFocus`), `windows/quickAddWindow.ts`.
Chromium hides windows without activating another, so on Windows the code does
`setOpacity(0) → minimize() → hide() → setOpacity(1)` to make Windows activate the
previous window, and `prepareToShow()` restores before the next show.
- [ ] From Notepad: `Alt+Shift+N`, type, **Enter** → popup hides, Notepad has focus and a
      blinking caret, so typing goes into Notepad. Repeat with **Esc**. Repeat from a browser,
      Explorer, and a full-screen/maximized app.
- [ ] No flash of a minimize animation, no taskbar button blinking.
- [ ] The popup is created with `minimizable: false` and `type: 'toolbar'`. Check that
      `minimize()` still takes effect on such a window. If focus does **not** return,
      this is the first suspect.
- [ ] Clicking elsewhere (blur) hides the popup and keeps the draft (plain `hide()` path).
- [ ] Same for the main window: `Alt+Shift+T` while it's focused hides it and focus goes
      back to the previous app (`toggleMainWindow` → `hideMainWindow` → same helper).

### 3.2 Quick-add window behaviour
- [ ] Title field has keyboard focus as soon as it shows; you can type straight away
      (the hotkey press should give the process the foreground right).
- [ ] Not in the taskbar, not in Alt+Tab (`skipTaskbar` + `type: 'toolbar'`), always on top.
- [ ] Multi-monitor: opens on the monitor under the **mouse cursor**, centred, upper third
      (`quickAddPosition.ts`).
- [ ] Mixed DPI (e.g. 100% laptop + 150% external): width stays ~640 px (logical) on both;
      moving between them doesn't grow/shrink it (`setSize` re-applied on win32 in
      `showQuickAdd`). Height follows content (`resizeQuickAdd`).
- [ ] Rounded corners/shadow look acceptable on Windows 11; no white flash in dark mode.

### 3.3 Tray (`tray.ts`, `resources/tray.ico`)
- [ ] Icon is crisp at 100/125/150/200% scaling and readable on **light and dark**
      taskbars (solid indigo tile, PNG-in-ICO 16–64 px). Note: this ICO can't be decoded
      on macOS, so it has never been rendered in the app.
- [ ] **Left-click** toggles the main window (400 ms focus grace, so a click while the
      window is focused hides it rather than re-showing).
- [ ] **Right-click** shows: Open Martin's To Dos, New Task, Settings…, Quit.
- [ ] Tooltip reads "Martin's To Dos". Icon may land in the overflow (^) area; that's normal.

### 3.4 Close-to-tray and quitting (`index.ts`, `windows/mainWindow.ts`)
- [ ] Title-bar ✕ hides the window; the app keeps running in the tray.
- [ ] Tray **Quit**, File → **Exit** (`Alt` to show the menu) and `Alt+F4`-then-Quit really
      end the process (check Task Manager: no leftover `Martins To Dos.exe`).
- [ ] **Shutdown / sign-out / restart** with the app running (window shown *and* hidden):
      Windows must not show "This app is preventing shutdown". Handled by the
      `query-session-end` / `session-end` listeners on the main window, which set
      `ctx.quitting`, ask the renderer to save pending edits (`query-session-end`) and close
      the DB (`session-end`; Windows emits no before-quit / will-quit then — see
      `quitGate.ts`). The hidden quick-add window also vetoes `close` unless quitting.
      Verify both paths, and that text typed in a task description just before sign-out is
      still there afterwards.

### 3.5 Hidden menu bar + accelerators (`menu.ts`, `mainWindow.ts`)
- [ ] Menu bar hidden (`autoHideMenuBar` + `setMenuBarVisibility(false)`). `Ctrl+N` (new
      task) and `Ctrl+,` (settings) work from the main window. They are handled both
      by the menu accelerators and by `renderer/src/app/useShellShortcuts.ts`. Check that one
      press opens exactly one dialog, and that `Ctrl+N` still works inside a text field.
- [ ] Pressing `Alt` alone shows the menu bar (autoHide behaviour). Decide if that's OK.
- [ ] Help → About shows "Version 0.1.0". Edit-menu copy/paste work in text fields.

### 3.6 Launch at login (`services/autoLaunch.ts`)
- [ ] Settings → General → Launch at login **on** creates
      `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value pointing at the installed
      exe (quoted path) with `--hidden`. Also listed in Task Manager → Startup apps.
- [ ] Sign out/in: the app starts **hidden in the tray** (no window).
- [ ] Toggle off removes the Run value. Only active in installed builds (`app.isPackaged`),
      never in `npm run dev` or e2e.
- [ ] If the user disables it in Task Manager, the toggle state may disagree with Windows.
      Note what happens.

### 3.7 Shortcut recorder (Settings → Shortcuts; `shared/accelerators.ts`)
- [ ] Record `Ctrl+Alt+Space`, `Win+Shift+K`, etc. Win shows as "Win" and is saved as
      `Super`. Recorder suspends real hotkeys while listening.
- [ ] OS-reserved Win combos (Win+L, Win+D, Win+E…) and combos already taken by other apps
      fail to register; Settings must **show the error**, not silently fail.
- [ ] Changing the shortcut takes effect immediately, and the old combo is freed.

### 3.8 File dialogs and data folder (`services/exportImport.ts`, `ipc/data.ts`)
- [ ] Export → native Save dialog, `.json` written; Import → Open dialog; Merge and
      Replace all work; dialogs are modal to the main window.
- [ ] "Reveal data folder" opens Explorer at `%APPDATA%\Martins To Dos\data`.
- [ ] Backups appear in `%APPDATA%\Martins To Dos\backups\` (startup snapshot ~3 s after
      launch once there is at least one task, then every 24 h, newest 14 kept; "Back up now"
      files are `todos-manual-…`, newest 10).
- [ ] Open the oldest backup in another program (e.g. DB Browser for SQLite) and take
      backups until it should rotate out: backups keep working (the locked file is skipped
      and deleted at a later rotation).
- [ ] Startup problems (`startup.ts`): with the app quit, replace `data\todos.db` with a
      text file → launch shows "can't read your data file" with Reveal / Restore / Quit;
      Restore keeps the bad file as `todos.db.broken-…` and opens the backup. Open
      `todos.db` exclusively in another program → the "locked" message. Check that no
      `Martins To Dos.exe` is left running after choosing Quit.

### 3.9 Single instance (`index.ts`)
- [ ] With the app hidden in the tray, launch it again from Start/desktop: no second
      process, and the existing window is shown and focused (not just flashing in the taskbar).

### 3.10 Window chrome and look
- [ ] Standard Windows frame/title bar reading "Martin's To Dos"; the renderer has no
      overlap with the frame (mac-only `hiddenInset` isn't applied).
- [ ] Window icon (`resources/icon.png`, 256 px with macOS-style padding) may look small in
      the title bar. If so, point the window icon at the `.ico` instead.
- [ ] Bounds/maximized state restored after restart, including after a monitor is
      unplugged (window must come back on-screen).
- [ ] Light/dark follows Windows' app mode; fonts (Segoe UI) look right; scrollbars OK.

### 3.11 Default global shortcuts
- [ ] `Alt+Shift+T` / `Alt+Shift+N` register (Settings → Shortcuts shows no error).
- [ ] **Known risk:** `Left Alt+Shift` is Windows' default *switch input language*
      hotkey. On machines with more than one keyboard layout, pressing the shortcut may also
      switch layout. Check that, plus collisions with apps in use (e.g. some IDEs use
      `Alt+Shift+N`/`T`; Teams/Office/PowerToys). If it's a problem, pick new defaults
      (`shared/constants.ts`) such as `Ctrl+Alt+Space` / `Ctrl+Alt+T`.

## 4. Reporting back

For each item: pass / fail / notes, Windows version, display scaling, and for failures
a screen recording if focus or timing is involved.
