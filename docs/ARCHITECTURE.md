# Martin's To Dos — Architecture & Product Spec

This is the source of truth for what we are building and how. If something here is
ambiguous or turns out to be unworkable, stop and report it rather than inventing a
different design.

## 1. What this is

A personal, local-only desktop task tracker for small, quick tasks captured in passing
(meeting action items, "file a ticket", "reply to X"). The two things that matter most:

1. **Capture is instant.** A global hotkey pops a small entry window; type a title, hit
   Enter, back to what you were doing.
2. **Focus stays on what matters now.** Date-aware Kanban views hide future work;
   priorities and due dates surface what is urgent.

Platforms: macOS and Windows. Development happens on macOS first; every choice must work
on Windows without redesign (no mac-only APIs without a Windows branch).

## 2. Stack (decided — do not substitute)

| Concern | Choice |
|---|---|
| Shell | Electron (latest stable), `electron-vite` for dev/build, `electron-builder` for packaging |
| Language | TypeScript, `strict: true`, everywhere (pinned to 6.0.x: `typescript-eslint` does not yet support TS 7) |
| UI | React, Tailwind CSS v4, shadcn/ui (Radix primitives), `lucide-react` icons |
| Client state | Zustand. Renderer holds the full task list in memory; main process is the source of truth |
| Storage | SQLite in the main process, WAL mode. **Driver: Node's built-in `node:sqlite`** (zero native deps → painless Windows handover; verified in Electron 45's main process in dev and production builds, and under Vitest on Node 22). Fallback only if it demonstrably does not work in Electron's main process: `better-sqlite3` + `@electron/rebuild`. All access goes through a thin `Db` wrapper in `src/main/db/connection.ts` so the driver is swappable |
| Migrations | Plain SQL/TS migrations, versioned by `PRAGMA user_version`, run at startup inside a transaction |
| Validation | `zod` schemas in `src/shared` for every IPC payload and for import files |
| Rich text | Tiptap (v3). **Descriptions are stored as Markdown (GFM)**, not HTML/JSON |
| Drag & drop | dnd-kit |
| Table / virtualization | TanStack Table, `@tanstack/react-virtual` |
| Dates | `date-fns`; `chrono-node` only for quick-add date tokens |
| Gantt, Calendar | Custom components (no heavyweight chart/calendar libs) |
| Tests | Vitest (unit), Playwright `_electron` (smoke e2e) |
| Tooling | npm, ESLint (flat config) + Prettier |

Electron security baseline: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, a typed `contextBridge` API, no remote content, CSP in the HTML.

## 3. Repository layout

```
src/
  shared/            Pure TS. No electron, node, or DOM imports. Unit-tested.
    types.ts           Task, Tag, Settings, enums
    schemas.ts         zod schemas (IPC inputs, export file)
    ipc.ts             Channel names + the `Api` interface exposed on window.api
    views.ts           View filter/sort logic (Today, Week, Timeline, …)
    dates.ts           Local-date helpers (YYYY-MM-DD strings)
    ordering.ts        Manual position math
    quickAddParser.ts  Inline token parser (#tag !priority @date)
    constants.ts       Statuses, priorities, tag palette, default settings
  main/
    index.ts           Bootstrap: single-instance lock, app lifecycle
    windows/           mainWindow.ts, quickAddWindow.ts
    tray.ts
    shortcuts.ts       Global shortcut registration
    ipc/               Handlers, one file per domain; all inputs zod-validated
    db/                connection.ts, migrations/, tasksRepo.ts, tagsRepo.ts, settingsRepo.ts
    services/          backup.ts, exportImport.ts, autoLaunch.ts
  preload/index.ts     contextBridge → window.api (typed by shared/ipc.ts)
  renderer/
    index.html         Main window
    quick-add.html     Quick-add window (separate entry)
    src/
      main.tsx, quick-add.tsx
      app/             App shell: Sidebar, Toolbar, view switch, layout
      stores/          tasksStore, tagsStore, uiStore, settingsStore
      components/ui/   shadcn components
      components/task/ Shared task widgets (badges, pickers, context menu)
      features/
        board/         Kanban (Today / Week / Everything)
        task-detail/   Side panel
        editor/        Tiptap Markdown editor
        list/          Table view
        timeline/      Gantt view
        calendar/      Calendar view
        quick-add/     Quick-add form (used by popup window AND in-app dialog)
        settings/      Settings dialog
      lib/             Renderer-only helpers
e2e/                 Playwright electron smoke tests
resources/           Runtime assets (tray icons)
build/               electron-builder assets (app icons)
docs/
```

Unit tests are colocated as `*.test.ts`. Feature folders do not import from each other
except: anything may import `components/`, `stores/`, `lib/`, `shared/`; `task-detail`
imports `editor`; the in-app new-task dialog imports `quick-add`.

## 4. Data model

SQLite file: `<userData>/data/todos.db`. **Dev builds must use a separate userData
directory** (app name suffixed `-dev`) so development never touches real data.

```sql
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,              -- crypto.randomUUID()
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',      -- Markdown
  status        TEXT NOT NULL DEFAULT 'not_started'
                CHECK (status IN ('not_started','in_progress','blocked','done')),
  priority      INTEGER NOT NULL DEFAULT 2     -- 1 low, 2 medium, 3 high, 4 critical
                CHECK (priority BETWEEN 1 AND 4),
  start_date    TEXT,                          -- 'YYYY-MM-DD' local calendar date, nullable
  due_date      TEXT,                          -- 'YYYY-MM-DD' local calendar date, nullable
  position      REAL NOT NULL,                 -- manual order within a status; lower = higher up
  created_at    INTEGER NOT NULL,              -- epoch ms
  updated_at    INTEGER NOT NULL,
  completed_at  INTEGER,                       -- set when status becomes 'done', cleared when it leaves
  deleted_at    INTEGER                        -- soft delete (enables Undo); purged after 30 days
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_completed ON tasks(completed_at);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color      TEXT NOT NULL,                    -- key into the tag palette in shared/constants.ts
  created_at INTEGER NOT NULL
);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- JSON values
```

Rules enforced in the repository layer (not the UI):

- Dates are calendar dates as `YYYY-MM-DD` strings; never `Date`/timestamps. If both are
  set and `start_date > due_date`, reject.
- `completed_at` is maintained automatically on status transitions.
- `updated_at` is bumped on every mutation.
- New tasks get `position = (min position in that status) - 1`, i.e. top of the column.
- Reordering sets `position` to the midpoint of the two neighbours; if the gap falls
  below `1e-6`, renumber that status column to integers in one transaction.
- Deletes are soft. On startup, hard-delete rows with `deleted_at` older than 30 days.

Domain type (renderer and IPC use camelCase):

```ts
type Status = 'not_started' | 'in_progress' | 'blocked' | 'done';
type Priority = 1 | 2 | 3 | 4;
interface Task {
  id: string; title: string; description: string;
  status: Status; priority: Priority;
  startDate: string | null; dueDate: string | null;
  position: number; tagIds: string[];
  createdAt: number; updatedAt: number; completedAt: number | null;
}
interface Tag { id: string; name: string; color: string; createdAt: number; }
```

Scale assumption: the renderer loads all non-deleted tasks at startup. This is fine into
the tens of thousands. If it ever is not, the escape hatch is lazy-loading old `done`
tasks — do not build that now, but do not make it impossible (keep all DB access behind
the repos, all filtering in `shared/views.ts`).

## 5. IPC contract

Preload exposes `window.api`, typed by `Api` in `src/shared/ipc.ts`. All calls are
`ipcRenderer.invoke` → `ipcMain.handle`; every handler validates input with zod.

```ts
interface Api {
  tasks: {
    list(): Promise<Task[]>;
    create(input: { title: string; description?: string; status?: Status; priority?: Priority;
                    startDate?: string | null; dueDate?: string | null;
                    tagIds?: string[]; newTagNames?: string[] }): Promise<Task>;
    update(id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority'
                    | 'startDate' | 'dueDate' | 'position' | 'tagIds'>>): Promise<Task>;
    // Reorder / change column. The repo computes the midpoint between the neighbours and
    // renumbers the column when needed; renumbered siblings are broadcast via dataChanged.
    move(id: string, input: { status?: Status; beforeId: string | null;
                              afterId: string | null }): Promise<Task>;
    delete(id: string): Promise<void>;     // soft
    restore(id: string): Promise<Task>;    // undo
  };
  tags: {
    list(): Promise<Tag[]>;
    create(input: { name: string; color?: string }): Promise<Tag>;
    update(id: string, patch: { name?: string; color?: string }): Promise<Tag>;
    delete(id: string): Promise<void>;
  };
  settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Settings>; };
  data: {
    exportToFile(): Promise<{ path: string } | null>;            // shows save dialog
    importFromFile(mode: 'merge' | 'replace'): Promise<ImportResult | null>;  // shows open dialog
    backupNow(): Promise<{ path: string }>;
    revealDataFolder(): Promise<void>;
  };
  app: {
    getInfo(): Promise<{ version: string; platform: NodeJS.Platform; isDev: boolean }>;
    showMainWindow(taskId?: string): Promise<void>;
    hideQuickAdd(): Promise<void>;
    resizeQuickAdd(height: number): Promise<void>;
    getShortcutStatus(): Promise<ShortcutStatus>;  // lets Settings surface registration failures
    openSettings(): Promise<void>;                 // shows the main window and opens Settings
  };
  on: {
    dataChanged(cb: (e: DataChange) => void): () => void;   // returns unsubscribe
    settingsChanged(cb: (s: Settings) => void): () => void;
    openTask(cb: (taskId: string) => void): () => void;
    quickAddShown(cb: () => void): () => void;
    newTaskRequested(cb: () => void): () => void;           // tray/menu "New Task" inside main window
    settingsRequested(cb: () => void): () => void;          // tray/menu "Settings…"
    shortcutStatusChanged(cb: (s: ShortcutStatus) => void): () => void;
  };
}
type DataChange = { upsertedTasks?: Task[]; removedTaskIds?: string[]; tags?: Tag[];
                    removedTagIds?: string[] };
```

Sync model: after every successful mutation the main process broadcasts `dataChanged` to
**all** windows with the affected records. Renderer stores apply these idempotently
(upsert by id). The originating window applies an optimistic update first and reconciles
with the returned record; on error it rolls back and shows a toast. This is what keeps
the quick-add window and the main window in sync.

Optimistic bookkeeping (tasks, tags, settings stores): while writes to a record are in
flight, the store keeps the newest server-confirmed copy and replays the pending patches on
top of it. A broadcast or result therefore never reverts a field a still-pending write set,
and a failed write reverts only its own fields, to the newest server copy (never to a
pre-write snapshot). When the last pending write settles, the record equals the server copy.
Task `updated_at` is strictly increasing per task (main bumps it by ≥ 1 ms per write), so
an older task broadcast is recognised as stale and ignored — except an import's broadcast,
which is marked `authoritative` (imports may write older versions).

## 6. Views

All filter logic lives in `src/shared/views.ts` as pure functions taking
`(tasks, today: 'YYYY-MM-DD', settings)` and is unit-tested. "Today" is the local
calendar date; views must refresh when the date rolls over (check on a timer and on
window focus).

Definitions: `anchor(task) = startDate ?? dueDate`. `open` = status is not `done`.

| View | Shows |
|---|---|
| **Today** (board) | Open tasks where `anchor` is null or `anchor <= today`. Done column: only tasks whose `completedAt` falls on today (local). |
| **This Week** (board) | Open tasks where `anchor` is null or `anchor <= end of this week`. Done column: only tasks completed within this week. Week start comes from settings (default Monday). |
| **Everything** (board) | All tasks. Done column sorted by `completedAt` desc, showing the newest 50 with a "Show more" control. |
| **List** | All tasks in a sortable table. |
| **Timeline** (Gantt) | Open tasks that have at least one date — future-dated work plus anything overdue. Completed tasks hidden by default (toggle to show). |
| **Calendar** | Tasks that have at least one date. |

A task is **overdue** when it is open and `dueDate < today`. Overdue is shown in red
everywhere; due-today in amber.

### Shared across all views
- **Filter bar**: text search (title + description), tag multi-select, priority
  multi-select. Lives in `uiStore`, applies to whichever view is active.
- **View preferences** (list sort / grouping / status chips / collapsed groups, timeline
  zoom / grouping / show-completed, calendar show-completed) persist per device in
  localStorage through one helper (`lib/viewPrefs.ts`, zustand `persist`, keys
  `martin-todos.viewPrefs.<view>`). They are not Settings and are not exported.
- Clicking a task anywhere opens the **detail panel** (`uiStore.selectedTaskId`).
- Right-click a task → context menu: set status, set priority, due Today / Tomorrow /
  Next week / Clear, Delete.
- Delete shows a toast with **Undo**.

### Board (Kanban)
- Columns in fixed order: Not Started, In Progress, Blocked, Done. Header shows count.
- Card: title, priority indicator, tag chips, due-date badge (overdue/today coloured),
  a small icon if it has a description, and checklist progress `n/m` if the description
  contains Markdown task-list items.
- Drag between columns changes status. Sort selector per board: **Priority** (default:
  priority desc, then due date asc with nulls last, then newest), **Due date**,
  **Manual**. Drag-to-reorder within a column only applies in Manual; in other modes a
  drag only changes the column. The selected sort persists in settings.
- Inline "+ Add task" at the top of Not Started (title only, Enter to add, stays open
  for the next one).
- Columns scroll independently. No virtualization on boards (it fights drag-and-drop and open
  columns stay small in practice); the Done column pages in 50 at a time via "Show more".

### List
TanStack Table. Columns: status, title, priority, tags, start, due, created, completed.
Click header to sort; group-by selector (None / Status / Priority); status filter chips
(default: all). Inline-editable status and priority cells. Virtualized rows.

### Timeline (Gantt)
- Left pane: task titles (sticky). Right pane: horizontally scrolling day grid with a
  "today" line and weekend shading. Zoom: Day / Week / Month column scale. An overdue
  task's left-pane title is red with the calendar's small alert icon.
- Bar spans `startDate → dueDate`; a task with a single date is a one-day bar. Bar colour
  follows priority; overdue bars are red-outlined.
- Range starts one week before today. Tasks dated earlier than the range start are
  clamped to the left edge with an overdue marker so ancient tasks do not stretch the
  chart. Range extends to the latest task date (min 6 weeks ahead).
- Rows sorted by anchor date. Drag a bar to move it; drag an edge to resize → updates
  dates. Click opens the detail panel.

### Calendar
- Month grid (week start from settings), prev/next/today navigation.
- A task with both dates renders as a bar spanning start→due (like all-day events);
  a task with one date renders as a chip on that day. Overflow collapses to "+N more"
  with a popover.
- Drag a task to another day to shift its dates (duration preserved). Clicking an empty
  day opens the new-task dialog with due date prefilled.
- Completed tasks are dimmed and struck through; toggle to hide them.

## 7. Task detail panel

Non-modal panel sliding in from the right (~480px, drag-resizable, width persisted); the
view underneath stays interactive. Esc or the close button dismisses it.

Contents, top to bottom: title (large inline-editable), property rows — status, priority,
start date, due date (date pickers with Today / Tomorrow / Next week / Clear presets),
tags (combobox, create-on-type, coloured chips) — then the description editor, then a
footer with created / updated / completed timestamps, **Copy as Markdown**, and Delete.
At narrow panel widths the footer shows only "Updated …" (all timestamps in its tooltip)
with an icon-only Copy button, and the editor toolbar keeps one line by moving its
least-used buttons (strikethrough, inline code, H3, quote, code block) into a "More" menu.

Everything autosaves: discrete fields immediately, title and description debounced
(~500 ms) and flushed on blur, panel close, task switch, and window hide. Never lose
keystrokes: if a title/description save fails, the field keeps the typed text (the store's
rollback is not adopted over it), shows a persistent "Not saved · Retry" state and saves
again on the next edit or flush. Limits are enforced where the user types: the title input
stops at 500 characters, and a description over 1,000,000 characters is flagged and not
sent until shortened.

### Description editor (Tiptap)
- Extensions: StarterKit, tables, task lists, links, placeholder, Markdown
  serialisation. Use the official `@tiptap/markdown` if it round-trips GFM tables and
  task lists reliably; otherwise `tiptap-markdown`. Verify with round-trip unit tests
  before committing to one.
- Storage format is Markdown. Load = parse Markdown; save = serialise to Markdown.
- Typing Markdown shortcuts works (`# `, `- `, `1. `, `[] `, `> `, ```` ``` ````, `**b**`).
- Pasting Markdown text converts to rich content. Copying a selection puts Markdown on
  the clipboard as `text/plain` (plus HTML).
- Compact toolbar: bold, italic, strike, inline code, H1–H3, bullet / ordered / task
  list, quote, code block, link, insert table (+ row/column controls when in a table).

## 8. Quick add

One form component (`features/quick-add`) used in two places: the global popup window
and the in-app "New task" dialog (`Cmd/Ctrl+N`).

**Popup window**: frameless, always-on-top, not in taskbar/dock switcher, ~640px wide,
positioned in the upper third of the display that currently has the cursor. Created
hidden at startup so the hotkey shows it instantly. It does **not** bring up the main
window — capture should not pull you out of what you were doing.

- Title input is focused on show. `Tab` moves to an optional description (plain
  textarea; it is Markdown, so it renders properly later). A small row of controls sets
  priority, due date, and tags.
- `Enter` in title (or `Cmd/Ctrl+Enter` anywhere) saves and hides. `Esc` hides and
  clears. Losing focus hides but keeps the draft.
- New tasks always land in Not Started.
- **Inline tokens** in the title, parsed live and stripped from the saved title. Each value
  is shown once: a parsed priority / due date appears in its control (changing or clearing
  the control overrides the token); tags appear as removable chips beside the Tags control.
  Precedence: explicit control > token > prefill > default.
  - `#word` → tag (created if new). Digits-only like `#1234` is not a tag.
  - `!low` `!med` `!high` `!crit` (also `!1`–`!4`) → priority.
  - `@today` `@tomorrow` `@fri` `@nov20` `@2026-12-01` → due date. Only consumed if it
    parses as a date, so `@john` stays in the title. A bare weekday (`@fri`) is the next
    occurrence strictly after today (`@today` is for today).

## 9. Desktop shell

- **Single instance** lock; a second launch focuses the existing window.
- **Tray**: icon with menu — Open, New Task, Settings, Quit. Left-click toggles the main
  window on Windows; on macOS it opens the menu (platform convention). macOS uses a
  template image.
- **Closing the main window hides it**; the app keeps running in the tray. Only
  Quit (tray, app menu, `Cmd+Q`) exits. On macOS the dock icon remains and re-shows the
  window on click.
- **Global shortcuts** (configurable in Settings via a shortcut recorder; registration
  failures are surfaced in Settings, never silent):
  - Toggle main window: default `Alt+Shift+T`
  - Quick add: default `Alt+Shift+N`
- **In-app shortcuts**: `Cmd/Ctrl+N` new task, `Cmd/Ctrl+F` focus search,
  `Cmd/Ctrl+1…6` switch view, `Cmd/Ctrl+,` settings, `Esc` close panel/dialog.
- **Launch at login** toggle (packaged builds only).
- **Window chrome**: macOS `titleBarStyle: 'hiddenInset'` with a drag region in the
  sidebar/toolbar; Windows uses the standard frame with the menu bar hidden. Window
  bounds are persisted and restored.

### Settings
The Settings dialog also hosts **tag management** (rename, recolour, delete) and the
export / import / backup controls.

`theme` (system | light | dark), `weekStartsOn` (1 Mon | 0 Sun), `shortcuts.toggleApp`,
`shortcuts.quickAdd`, `launchAtLogin`, `boardSort` (one value per board:
`{ today, week, everything }`), `detailPanelWidth`, `lastView`, `windowBounds` (main-window
bounds; main process only).
Stored in the `settings` table; defaults in `shared/constants.ts`.

### Backup, export, import
- **Backups** (`<userData>/backups/`, VACUUM INTO snapshots). Retention is per kind, encoded
  in the file name (pre-existing `todos-YYYYMMDD-HHmmss.db` files are automatic backups):

  | Kind | File | Kept |
  |---|---|---|
  | Automatic: at startup (skipped if one is < 1 h old) and every 24 h | `todos-YYYYMMDD-HHmmss.db` | newest 14 |
  | Manual: "Back up now" | `todos-manual-YYYYMMDD-HHmmss.db` | newest 10 |
  | Safety copy before every import (Merge and Replace all; skipped when the DB has no tasks) | `todos-preimport-YYYYMMDD-HHmmss.db` | newest 5 |

  No automatic snapshot is taken while the database has zero tasks (soft-deleted included),
  so an accidental wipe cannot rotate out good history. Deleting an old backup is
  best-effort (a file locked by another program is logged and retried at the next
  rotation). "Last backup" in Settings counts every kind.
- **Export**: one JSON file `{ app: 'martin-todos', formatVersion: 1, exportedAt, tasks, tags }`
  via a save dialog.
- **Import**: open dialog → zod-validate → **Merge** (upsert by id; the record with the
  newer `updatedAt` wins; tags: all id matches first, then name matches only against local
  tags no id match claimed, then the rest are created) or **Replace all**. Both take a
  pre-import backup first (unless the local DB has no tasks). Runs in one transaction; returns counts. A leading UTF-8 BOM
  is accepted.

### Startup problems
Opening the database runs through `main/startup.ts` (decisions and file operations in the
unit-tested `services/startupRecovery.ts`). The process never lingers without a window:
- **Cannot open / migrate** the DB → native dialog with a cause-specific message: created by
  a **newer version** (no restore offered — it would drop the newer data), **damaged /
  unreadable**, or **locked** by another program. Buttons: **Reveal data folder**,
  **Restore latest backup** (only when a backup exists and the cause is not "newer version"),
  **Quit**. Restore moves the bad file aside as `todos.db.broken-<YYYYMMDD-HHmmss>` (plus
  `-wal` / `-shm` if present; nothing is ever deleted), copies the newest backup of any kind
  into place and continues startup (a backup that also fails is skipped next time). Anything
  but a successful restore quits.
- **DB file missing but backups exist** → **Restore latest backup** / **Start fresh** /
  **Quit**, instead of silently creating an empty database.
- Any other startup exception shows an error box and exits.

### Renderer crashes and quitting
- A renderer that crashes or is killed (main or quick-add window) is reloaded. Three crashes
  within 60 s stop the loop and ask **Quit** / **Try again** instead. A hung renderer gets a
  **Wait** / **Reload** prompt. A quick-add window destroyed outside a real quit is recreated
  hidden.
- Every quit (tray Quit, app menu / `Cmd+Q`, SIGTERM / SIGINT) goes through one quit gate
  (`main/quitGate.ts`): the quit is held until the main window's renderer has saved pending
  edits (≤ 1.5 s), repeated quit requests during that wait are held too, and the DB is closed
  exactly once afterwards. Windows logoff / shutdown (no `before-quit`) starts the flush on
  `query-session-end` and closes the DB on `session-end`.

### Environment variables
| Variable | Effect |
|---|---|
| `MARTIN_TODOS_USER_DATA=<dir>` | Uses `<dir>` as userData (DB, backups, settings). A supported "custom data location"; changes nothing else. |
| `MARTIN_TODOS_E2E=1` | e2e test mode only: fake global-shortcut registrar, no login-item changes, `__martinTodosTest` main-process hooks, and the test switches below. Set by `e2e/launch.ts`. |
| `MARTIN_TODOS_HIDE_WINDOW=1` | (test mode only) keep the main window hidden. |
| `MARTIN_TODOS_FAKE_TAKEN_SHORTCUTS=<a,b>` | (test mode only) accelerators the fake registrar refuses. |
| `MARTIN_TODOS_STARTUP_DIALOG_CHOICE=<choice>` | (test mode only) answers the startup-problem dialog without showing it (`reveal`, `restore`, `fresh`, `quit`). |
| `MARTIN_TODOS_CRASH_DIALOG_CHOICE=<quit\|reload>` | (test mode only) answers the renderer crash-loop dialog. |

A launch without `MARTIN_TODOS_E2E=1` behaves exactly like production.

## 10. Visual design

Clean, quiet, modern — in the spirit of Linear / Things. No gradients, no heavy shadows,
no theme gallery.

- Neutral zinc greys, one accent colour (indigo) for focus/selection/primary actions.
- System font stack, 13–14px base, compact but not cramped; 8px spacing rhythm.
- Light and dark themes, following the OS by default.
- Priority colours: low = slate, medium = blue, high = amber, critical = red. Use these
  consistently in every view.
- Tags: a fixed palette of 8 soft colours; auto-assigned on creation, editable.
- Layout: narrow left sidebar (the six views, then tags as quick filters, Settings at the
  bottom) · main area with a top toolbar (view title, search, filters, view-specific
  controls, New task button) · detail panel on the right.
- Subtle motion only (panel slide, drag overlay). Empty states get one line of helpful
  text, not illustrations.

## 11. Naming & packaging

- Display name everywhere in the UI: **Martin's To Dos**.
- npm package name `martin-todos`; appId `com.martin.todos`; bundle/installer
  `productName` **"Martins To Dos"** (no apostrophe, to avoid quoting problems in
  Windows paths and installer tooling). This is also `productName` in `package.json`,
  so userData is `<appData>/Martins To Dos` (dev: `Martins To Dos-dev`).
- electron-builder targets: macOS `dmg` (arm64 + x64), Windows `nsis` (x64). Unsigned
  for now. No auto-update.

## 12. Engineering conventions

- No `any`; no non-null assertions without a comment explaining why.
- Business rules live in `shared/` (pure, tested) or the main-process repos — never
  only in a component.
- The renderer never touches Node or Electron APIs directly; only `window.api`.
- Every platform-specific branch goes through `process.platform` checks in the main
  process and must have a sensible Windows path.
- `npm run typecheck`, `npm run lint`, and `npm test` must pass before any work is
  reported as done.
