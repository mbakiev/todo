# Martin's To Dos

[![CI](https://github.com/mbakiev/todo/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mbakiev/todo/actions/workflows/ci.yml)

A personal, local-only desktop task tracker for small tasks captured in passing (Electron +
React + SQLite, macOS and Windows). A global hotkey pops up a quick-add box; date-aware
boards keep the focus on what matters today. Spec: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Using the app:** see the [User Guide](docs/USER_GUIDE.md).

## Download

Get the latest version from the
[Releases page](https://github.com/mbakiev/todo/releases/latest):

| Your computer | File |
|---|---|
| Mac with Apple silicon (M1 or later) | `MartinsToDos-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `MartinsToDos-<version>-mac-x64.dmg` |
| Windows 10 / 11 (64-bit) | `MartinsToDos-<version>-win-x64-setup.exe` |

The installers are unsigned, so macOS and Windows ask before running them; each release's
notes explain the one-time step.

## Features

- Quick-add popup from anywhere, with inline tokens: `#tag`, `!high`, `@tomorrow`
- Views: Today, This Week, Everything (Kanban boards), List, Timeline, Calendar
- Priorities, due/start dates, tags, Markdown descriptions with checklists
- Search and tag/priority filters across all views
- Lives in the tray / menu bar; optional launch at login; light and dark themes
- Automatic daily backups, JSON export/import

## Default shortcuts

| Action | macOS | Windows |
|---|---|---|
| Quick add (global) | `⌥⇧N` | `Ctrl+Alt+N` |
| Show / hide app (global) | `⌥⇧T` | `Ctrl+Alt+T` |
| New task | `⌘N` | `Ctrl+N` |
| Search | `⌘F` | `Ctrl+F` |
| Switch view | `⌘1`…`⌘6` | `Ctrl+1`…`Ctrl+6` |
| Settings | `⌘,` | `Ctrl+,` |

Global shortcuts can be changed in Settings → Shortcuts (Windows and Linux default to
`Ctrl+Alt`, because left `Alt+Shift` is Windows' keyboard-layout switch). Shortcuts already
stored in settings are never rewritten. If one can't be registered (another app owns it),
the app says so once when its window opens, with a button to change it.

## Where data lives

| | macOS | Windows |
|---|---|---|
| Database | `~/Library/Application Support/Martins To Dos/data/todos.db` | `%APPDATA%\Martins To Dos\data\todos.db` |
| Backups | `…/Martins To Dos/backups/` | `%APPDATA%\Martins To Dos\backups\` |
| Dev builds (`npm run dev`) | `…/Martins To Dos-dev/` | `%APPDATA%\Martins To Dos-dev\` |

Settings → Data & backup → "Reveal data folder" opens it. Uninstalling keeps your data.

**Custom data location:** set `MARTIN_TODOS_USER_DATA` to a folder before starting the app
and everything (database, backups, settings) lives there instead, e.g. on macOS
`MARTIN_TODOS_USER_DATA=~/todos "/Applications/Martins To Dos.app/Contents/MacOS/Martins To Dos"`,
on Windows a user environment variable `MARTIN_TODOS_USER_DATA=D:\todos`. It only moves the data;
the app behaves exactly as usual. (`MARTIN_TODOS_E2E=1` is the separate switch the e2e
tests use for test mode; never set it for normal use.)

If the database cannot be opened at startup the app says so in a dialog: a file **locked**
by another program offers Try again / Reveal data folder / Quit; a **damaged** file offers to
restore the newest backup (the unreadable file is kept as `todos.db.broken-<timestamp>`); one
**created by a newer version** offers Reveal / Quit.

## Backup, export, import

- A snapshot is taken at startup and every 24 h (newest 14 kept; skipped while the database
  has no tasks at all). "Back up now" copies are kept separately (newest 10), as are the
  safety copies taken before every import (newest 5), so neither can push out the daily
  history.
- **Export** writes one JSON file with all tasks and tags.
- **Import** a JSON export: **Merge** (newer edit wins) or **Replace all**; both back up the
  current data first.

## Development

Requires Node 22.16+ and npm (macOS or Windows; no native build tools needed). CI uses Node 24
(`.nvmrc`), the version bundled in Electron 45. Older Node 22 releases lack `node:sqlite`'s
`isTransaction`, so the unit tests' transaction rollbacks fail there.

```sh
npm ci
npm run seed         # dev app with ~40 demo tasks (only seeds an empty dev DB)
npm run dev          # dev app with hot reload
npm run seed:reset   # wipe and re-seed the dev DB

npm run typecheck && npm run lint && npm test
npm run test:e2e     # builds, then Playwright (_electron) tests
```

## Building installers

```sh
npm run pack         # unpacked app for this machine → release/<version>/mac-arm64/ (or win-unpacked/)
npm run dist:mac     # macOS: .dmg + .zip for arm64 and x64 → release/<version>/
npm run dist:win     # Windows (run on Windows): NSIS installer x64 → release/<version>/
npm run icons        # regenerate icons from build/icon-src/*.svg
```

Builds are unsigned (macOS: ad-hoc signed). **macOS:** open the `.dmg`, drag the app to
Applications, launch it. A build made on your own Mac just opens; a copy downloaded or
AirDropped from elsewhere is quarantined, so run
`xattr -dr com.apple.quarantine "/Applications/Martins To Dos.app"` once (or System
Settings → Privacy & Security → Open Anyway). **Windows:** run
`MartinsToDos-<version>-win-x64-setup.exe` (per-user, no admin); SmartScreen →
"More info" → "Run anyway". Windows checklist: [`docs/WINDOWS_HANDOVER.md`](docs/WINDOWS_HANDOVER.md).

## CI and releases

GitHub Actions (`.github/workflows/`), on every push to `main`, every pull request, and on
demand (Actions → CI → Run workflow):

| Job | Runs on | What |
|---|---|---|
| Typecheck, lint, format | Linux | `npm run typecheck`, `lint`, `format:check` |
| Unit tests | Linux, macOS, Windows | `npm test` (Vitest, `TZ=America/New_York`) |
| E2E | macOS, Windows | `npm run test:e2e` (Playwright `_electron`); traces uploaded on failure |
| Package | macOS, Windows | `dist:mac` / `dist:win` with `--publish never`, then `npm run test:packaged` against the packaged app (Windows also silently installs, smoke-tests and uninstalls the NSIS installer) |

CodeQL scans the code on pushes, PRs and weekly; Dependabot proposes GitHub Actions updates
weekly and npm updates monthly (minor + patch grouped in one PR).

**Downloading a build:** released versions are on the
[Releases page](https://github.com/mbakiev/todo/releases). For an unreleased build, open a CI
run (Actions tab, or the checks on a PR) → *Artifacts* → `installers-macos` (arm64 + x64
`.dmg` / `.zip`) or `installers-windows` (`-setup.exe`). Artifacts are kept for 7 days.

**Cutting a release:**

1. Bump `"version"` in `package.json` (and `package-lock.json`), e.g. `npm version 0.2.0 --no-git-tag-version`, and commit it to `main`.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. `release.yml` checks that the tag equals `v` + the `package.json` version, runs the whole
   CI workflow, then publishes a GitHub Release with the macOS DMGs/ZIPs, the Windows
   installer and `SHA256SUMS.txt` attached. The notes are `.github/release-notes.md`
   (download table, first-launch steps) followed by GitHub's auto-generated change list. A
   tag with a suffix (`v0.2.0-beta.1`) becomes a pre-release.

**The installers are unsigned** (signing certificates cost money): the macOS app is ad-hoc
signed and not notarized, so Gatekeeper blocks a downloaded copy until you allow it
(System Settings → Privacy & Security → *Open Anyway*, or the `xattr` command above); the
Windows installer triggers a SmartScreen warning (*More info* → *Run anyway*).
