# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TaskMaster AI — a Japanese-language task/project management SPA for individuals and small teams. Supports parent task ("案件") / sub-task hierarchies, templates, history, Excel import, daily/weekly report export, and Gemini-powered summaries. A guest mode keeps data in `localStorage` for offline trial.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install deps (Node 18+). |
| `npm run dev` | Runs `tsx server.ts` — Express + Vite middleware on `PORT` (default 3000), host `0.0.0.0`. |
| `npm run build` | Production build to `dist/` via Vite. |
| `npm run preview` | Preview the built bundle. |
| `npm run lint` | Type-check only (`tsc --noEmit`). There is no test suite. |
| `npm run clean` | `rm -rf dist`. |

There is no test runner configured; "lint" is type-checking. CloudBase is deployed via `cloudbaserc.json` (`@cloudbase/framework-plugin-website`), serving the `dist/` build.

## Environment variables

Set in `.env.local` (loaded by Vite via `loadEnv` and injected through `define` as `process.env.X` in client code — see `vite.config.ts`):

- `TCB_ENV_ID` — CloudBase (腾讯云开发) environment ID. **Required**; without it DB/auth calls fail.
- `GEMINI_API_KEY` — Used by `src/services/aiService.ts` for daily-report summaries.
- `APP_URL` — Self-link base for the app.
- `PORT`, `HOST` — Override server bind (defaults `3000` / `0.0.0.0`).
- `SSL_KEY_FILE`, `SSL_CERT_FILE` — If both files exist, `server.ts` starts HTTPS instead of HTTP. **Required for real CloudBase usage** — see "CloudBase safe-domain workaround" below.

## Architecture

### Runtime topology

- `server.ts` is the dev entry point. It mounts Vite in middleware mode (`appType: 'spa'`) in dev and serves `dist/` static + SPA fallback in production. It deliberately listens on `0.0.0.0` so a `hosts`-redirected CloudBase托管 domain can resolve to localhost.
- The app is purely client-rendered React 19 + Vite. There is no backend API beyond `/api/health`; all persistence is CloudBase.

### CloudBase safe-domain workaround (important when running locally against real CloudBase)

CloudBase rejects requests from `localhost` because it cannot be added to the "Web 安全域名" whitelist. The pattern used here:

1. Whitelist your托管 domain (e.g. `<env>-<uin>.tcloudbaseapp.com`) in the CloudBase console.
2. Point that domain to `127.0.0.1` in the OS `hosts` file.
3. Provide `SSL_KEY_FILE` / `SSL_CERT_FILE` so `server.ts` boots HTTPS — CloudBase's `watch()` and DB calls then succeed.

Without HTTPS+correct domain, DB calls return 403 and `watch()` is unavailable; the app falls back to a polling-on-event re-fetch path.

`vite.config.ts` allows the托管 domain via `server.allowedHosts: ['.tcloudbaseapp.com', '.app.tcloudbase.com']`. HMR is intentionally disabled (`hmr: false`) — do not re-enable; the comment notes file-watching causes flicker in agent edits.

### Data layer — `src/services/taskService.ts`

Single object `taskService` is the only data gateway. Key concepts:

- **Dual-mode**: every method branches on `taskService.isGuest`. Guest mode reads/writes a single JSON blob in `localStorage` under `taskmaster_guest_data` (`GUEST_STORAGE_KEY`) and notifies observers manually. CloudBase mode talks to `db.collection(...)`.
- **Owner isolation**: CloudBase security rules (`cloudbase/database-rules.json`) are `auth.uid == doc.owner_id` on every collection. Because the rule references `doc.owner_id`, every read/write **must** include `owner_id` in its `where()` — see `ownedDoc()` helper. Using `db.collection(x).doc(id).update()` directly will fail with "Permission denied by security rules".
- **Document ID mapping**: CloudBase stores `_id`; the app uses `id`. Always convert via `mapDoc<T>()`.
- **Read limit**: `READ_LIMIT = 1000` — CloudBase's default `get()` returns only 20 docs.
- **Subscriptions**: `watchOwnedDocs()` is the universal subscribe helper. It (a) does an initial `get()`, (b) attempts `watch()` for realtime, and (c) falls back to event-driven re-fetch via `notifyCollection()` (called after every write) plus a window `focus` / `visibilitychange` reload (debounced 200 ms). It dedupes via `lastJson` to avoid re-renders.
- **Error handling**: CloudBase throws plain objects, not `Error` instances. Always route through `handleDbError()` → `extractErrorMessage()`; do not `String(error)` directly (yields `[object Object]`).
- **Order field**: lists are sorted by `order` asc then `created_at` asc (`orderSort`). When bulk-inserting (import), pass `order` explicitly to avoid the O(n²) "read length, then add" pattern.

### Auth flow — `src/App.tsx` + `src/cloudbase.ts`

- `auth.signInWithPassword`, `auth.getVerification` + `auth.verify` + `auth.signUp` (email-code two-step), `auth.signInAnonymously` (guest), `auth.resetPassword` (with verification token).
- `App.tsx` subscribes via `auth.onAuthStateChange` and recomputes `isGuest` from `user.loginType === 'ANONYMOUS'`. If anonymous sign-in is disabled on the CloudBase env, the code falls back to a **local-only** guest mode (`taskService.isGuest = true` without a CloudBase session).
- On logout of an anonymous/guest user, `taskService.cleanupUserData()` wipes their docs before `signOut()`, and the page reloads.
- Errors from CloudBase are localized to Japanese in `authErrorMessage()`.

### Domain model — `src/types.ts`

- `ParentTask` ("案件") ↔ many `SubTask`. Sub-tasks carry the heavy lifting: status (`遅れ`/`済`/`進行中`/`未着手`/`保留`/`着手遅れ`/`期限遅れ`), `start_date`/`due_date`/`final_deadline`, priority A/B/C, planned/actual hours, `is_in_report` flag (drives the Daily Report screen + the badge count in `App.tsx`).
- Delay tracking: when a delay shifts a task, the original dates are preserved in `original_due_date` / `original_final_deadline` (rendered with strike-through), and `delay_shift_status` colors the new dates.
- `TaskTemplate` + `TemplateItem` are a separate hierarchy used to materialize new sub-task batches.
- `DailyReportSnapshot` stores per-day frozen state including AI summary.
- `UserSettings` holds UI prefs, notification rules, and (legacy) `ai_models`.

### Deadline calculation rule

`taskService.calculateDeadline(dueDate, plannedHours)` follows the import template's 規則表 and skips weekends:

| Planned hours | Business days added |
| --- | --- |
| `0 < h < 3` | +1 |
| `3 ≤ h < 5` | +2 |
| `5 ≤ h < 8` | +4 |
| `h ≥ 8` | +5 (1 week) |

### UI

- Single-component-per-screen under `src/components/`. `App.tsx` is the router — `activeTab` switches between Dashboard / Templates / History / FileImport / DailyReport / Settings; selecting a parent task opens `SubTaskManagement` overlaying everything.
- Wrapped in `ErrorBoundary`. Layout chrome is `<Layout>`; the daily-report badge (`reportCount`) is fed from a separate `subscribeAllSubTasks` filtered by `is_in_report`.
- Tailwind v4 via `@tailwindcss/vite` plugin (no `tailwind.config.js`). DnD via `@hello-pangea/dnd`. Resizable panes via `react-resizable`.

### Excel import — `src/importColumns.ts` + `src/components/FileImport.tsx`

- `.xlsx` only, via `exceljs` (the `xlsx` package was removed for security; do not reintroduce it).
- Row 1 = headers, data starts row 2. If a worksheet named `import` exists, it is preferred over the first sheet.
- Merged column ranges (`システム` A–B, `月次` C–D, `タスク` K–P) are read from the first non-empty cell; blank cells fill down. Rows are grouped by `案件` to create parent tasks with one sub-task per row.
- Template file lives at `public/task-import-template.xlsx` and is downloadable from the import screen as `taskimportfile.xlsx`.

## Conventions

- Comments in the codebase are in Japanese (with some Chinese in CloudBase-specific notes). Match the existing language when editing nearby code.
- Use `process.env.X` to access env vars in client code — Vite's `define` rewrite makes this work; do not switch to `import.meta.env`.
- Never bypass the `ownedDoc()` / `getOwnedDocs()` helpers when touching CloudBase — `_id`-only queries violate the security rules.
- After any write, call `notifyCollection(<collName>...)` so non-`watch()` subscribers re-fetch.
