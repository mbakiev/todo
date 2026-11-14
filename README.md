# Martin's To Dos

A personal, local-only desktop task tracker for small tasks captured in passing (Electron +
React + SQLite, macOS and Windows). A global hotkey pops up a quick-add box; date-aware
boards keep the focus on what matters today. Spec: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

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
| Quick add (global) | `⌥⇧N` | `Alt+Shift+N` |
| Show / hide app (global) | `⌥⇧T` | `Alt+Shift+T` |
| New task | `⌘N` | `Ctrl+N` |
| Search | `⌘F` | `Ctrl+F` |
| Switch view | `⌘1`…`⌘6` | `Ctrl+1`…`Ctrl+6` |
| Settings | `⌘,` | `Ctrl+,` |

Global shortcuts can be changed in Settings → Shortcuts.

## Where data lives

| | macOS | Windows |
|---|---|---|
| Database | `~/Library/Application Support/Martins To Dos/data/todos.db` | `%APPDATA%\Martins To Dos\data\todos.db` |
| Backups (newest 14) | `…/Martins To Dos/backups/` | `%APPDATA%\Martins To Dos\backups\` |
| Dev builds (`npm run dev`) | `…/Martins To Dos-dev/` | `%APPDATA%\Martins To Dos-dev\` |

Settings → Data & backup → "Reveal data folder" opens it. Uninstalling keeps your data.

## Backup, export, import

- A snapshot is taken at startup and every 24 h; "Back up now" takes one on demand.
- **Export** writes one JSON file with all tasks and tags.
- **Import** a JSON export: **Merge** (newer edit wins) or **Replace all** (backs up first).

## Development

Requires Node 22.12+ and npm (macOS or Windows; no native build tools needed).

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
