# Martin's To Dos

A personal, local-only desktop task tracker (Electron + React + SQLite) for small tasks
captured in passing. macOS and Windows. Product spec and architecture:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Run

Requires Node 22.12+ and npm.

```sh
npm install
npm run seed       # first run: dev app with ~40 demo tasks (only seeds an empty DB)
npm run dev        # dev app with hot reload
```

Dev builds keep their data in `<appData>/Martins To Dos-dev/` (never the real app's data).
`npm run seed:reset` wipes the dev DB and re-seeds it.

## Checks

```sh
npm run typecheck
npm run lint
npm test           # Vitest unit tests
npm run test:e2e   # builds, then Playwright (_electron) smoke tests + screenshots in e2e/screenshots/
npm run build      # typecheck + production build to out/
```
