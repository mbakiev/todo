# CLAUDE.md

Source of truth for product + architecture: `docs/ARCHITECTURE.md`. Read it before changing anything.

## Commands
- `npm run dev` / `npm run seed` (demo data into empty dev DB) / `npm run seed:reset`
- `npm run typecheck` · `npm run lint` · `npm test` (Vitest) · `npm run test:e2e` (builds, then Playwright `_electron`)
- `npm run build` (typecheck + electron-vite build) · `npm run format`
- typecheck, lint and test must pass before reporting work as done.

## Where things live
- `src/shared/` pure TS (no electron/node/DOM): types, zod schemas, `ipc.ts` (channels + `Api`), `views.ts` (all view filters/sorts), `dates.ts`, `ordering.ts`, `quickAddParser.ts`, `constants.ts`.
- `src/main/` Electron main: `index.ts` bootstrap, `db/` (node:sqlite wrapper `connection.ts`, migrations, repos, `seed.ts`), `ipc/` (zod-validated handlers, broadcast `dataChanged`/`settingsChanged`), `windows/`, `services/`, `tray.ts`, `shortcuts.ts`.
- `src/preload/index.ts` the typed `window.api`.
- `src/renderer/src/`: `app/` shell, `stores/` (zustand + `selectors.ts` hooks), `components/ui/` (shadcn), `components/task/` (shared task widgets), `features/<name>/` (one owner each), `lib/` (`api()`, `useToday`, theme, platform).
- Tests colocated as `*.test.ts(x)`; e2e in `e2e/`. Unit tests run with `TZ=America/New_York` by default.

## Conventions (spec §12)
- TypeScript strict. No `any`; no non-null assertions without a comment saying why.
- Business rules live in `src/shared` (pure, tested) or main-process repos — never only in a component.
- Renderer never touches Node/Electron; only `window.api` (via `@/lib/api`).
- Platform branches only in main via `process.platform`, always with a sensible Windows path.
- Dates are `YYYY-MM-DD` local strings (`shared/dates.ts`); timestamps only for created/updated/completed.
- Use theme tokens (`bg-background`, `text-muted-foreground`, `text-priority-high`, `bg-tag-blue`, `text-overdue`…), not raw palette colours.
- Feature folders don't import each other (exceptions: task-detail → editor, quick-add dialog → quick-add form).
- Views put toolbar controls in the shell via `<ToolbarControls>` (`@/app/ToolbarControls`).
- Do not add npm dependencies without agreement; do not edit shared files from a feature branch of work.
- Dev data: `<appData>/Martins To Dos-dev`; e2e overrides userData with `MARTIN_TODOS_USER_DATA`.
