# xpenses — Setup + Testing + Changelog

Backend + web frontend both implemented. Frontend architecture: see
`docs/WEB.md`. This doc covers setup, testing, and the changelog.

## Setup

### Prerequisites
- Node.js LTS (v20+) — matches Hostinger's Node.js App slot support.
- MySQL 8.x (Hostinger-hosted, or local for dev).
- npm (bundled with Node).

### Install Steps
```bash
git clone <repo-url> xpenses
cd xpenses/server && npm install
cd ../web && npm install
cp server/.env.example server/.env   # fill in real values, see Env Vars below
node server/db/migrate.js            # applies 001_init.sql, 002_seed.sql
```

### Env Vars
| Key | Description |
|---|---|
| `DB_HOST` | MySQL host |
| `DB_PORT` | MySQL port (default 3306) |
| `DB_USER` | MySQL user |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | MySQL database name |
| `PASSWORD_HASH` | bcrypt hash of the single app password |
| `JWT_SECRET` | signing secret for the auth JWT |
| `CRON_SHARED_SECRET` | shared secret for the Plan-B `/api/cron/run` endpoint |
| `NODE_ENV` | `development` \| `production` |

`config/env.js` (Phase 0.4) validates all of the above are present at boot
and fails fast if any are missing.

### How to Run Locally
```bash
# terminal 1 — backend
cd server && npm run dev

# terminal 2 — frontend
cd web && npm run dev
```
Frontend dev server (`:5173`) proxies `/api/*` to the backend (`:3001`).

### Production Build (same-origin)
```bash
cd web && npm run build      # emits to server/public/
```
`server/app.js` serves `server/public/` with an SPA fallback in production, so
the frontend is same-origin with the API (first-party auth cookie, no CORS).
Deploy: build web -> rsync `server/` (incl. `public/`) to Hostinger; Passenger
runs `app.js`. `server/.env` and `server/public/` are gitignored.

### Common Errors + Fixes
TBD — will be filled in as real errors are hit during Phase 0-1 implementation.

---

## Testing

### Test Framework + Runner
- Backend: Jest + Supertest (integration tests hit routes against a real/test
  MySQL schema — no DB mocking, per user's global testing rule).
- Frontend: Vitest + React Testing Library (unit/component).

### Coverage Target
80%+, enforced at Phase 7.4 as a gate before deploy.

### Test Types Required
1. **Unit** — pure functions (money helpers, sync LWW reconciler, recurring
   scheduler logic) — no I/O.
2. **Integration** — API routes against a real test MySQL DB (supertest).
3. **Manual acceptance** - critical flows: login, add expense online, add
   expense offline then reconnect, budget-over banner, and responsive layouts.

### TDD Workflow
RED -> GREEN -> REFACTOR, per task in `docs/PLAN.md`. Write the failing test
before any implementation code.

### How to Run Tests
```bash
cd server && npm test          # backend unit + integration
cd web && npm test              # frontend unit + component
```

### How to Write New Tests
Co-locate as `__tests__/` per feature folder (see `docs/TECH.md` §3-4
structure trees). One test file per module; integration tests for a feature
live alongside its `routes`/`service`/`repo` files.

### Mocking Strategy
Mock only true external boundaries (none in v1 — no third-party APIs).
Never mock the database in integration tests — hit a real test MySQL schema,
per project testing standard (avoids mock/prod divergence).

---

## Changelog

Current version: `0.2.0`

Format: [Keep a Changelog](https://keepachangelog.com)

## [Unreleased]
### Changed
- Fixed sign out for missing, expired, and active sessions. Successful logout
  clears persisted client session state before reload; network failure now shows
  a retryable error instead of silently reloading.
- Removed Playwright, its browser suite, and its npm command after repeated local
  browser crashes. Responsive release checks are manual.
- Replaced Ledger's persistent account/category selectors with one collapsed
  Filters button and multi-select checklists. Account/category filters remain
  URL-backed, load the full month before local filtering, and require no API or
  database schema change.
- Polished iPad Ledger filters, removed Reports grid dead space, compacted the
  Settings export action, and removed Note entry from transfers without an API
  or database schema change.
- Added device-local Light/Dark appearance settings with pre-paint restore and
  reduced display typography matching the native iOS scale.

### Added
- **Pending sync activity** - a global count and detail sheet now expose queued,
  sending, and failed writes with submission times. Safe network/server failures
  support guarded retry, validation conflicts link back to their editor, failed
  writes survive reloads, writes replay FIFO, and sign-out warns before clearing
  unresolved work.
- Purchase reflections on confirmed Plans: editable worth-it, regret, or not-sure
  rating with an optional note and preserved purchase history.
- **iPad and new features** - adaptive iPad mini portrait/landscape layouts,
  Ledger URL filters and detail pane, report drill-down, quick-add favorites,
  dashboard customization, dirty-draft guards, and responsive checks.
  The forecast API remains available, but its Dashboard card was removed.
- **Insights (Phase 8)** — new `features/insights/` server feature + `/api/insights`:
  - `GET /forecast?month=` — recurring-aware month-end projection. Discretionary
    (non-recurring) spend is extrapolated at the current daily burn rate over the
    days left; recurring bills still due are added at exact amounts from the rules
    (reuses `recurring/scheduler` `planDueRuns`). Optional `asOf=YYYY-MM-DD`.
  - `GET /anomalies?month=` — dismissible heads-up flags: budget burn (>=80% of
    budget before 80% of month) and category velocity (projected month spend >=2x
    the trailing 3-month average, floor ฿500).
  - `GET /comparisons?month=` — per-category current vs last month vs trailing
    3-month average, with deltas.
  - Web: dismissible anomaly cards on Dashboard (dismissed state per-month in
    `localStorage`, no schema); per-category trend chips on Reports. The forecast
    endpoint remains for API and MCP clients, but its Dashboard card was removed.
  - Tests: +30 server (service pure math, repo SQL, router), +3 web.
- **MCP server (Phase 9)** — `mcp/` package (stdio, `@modelcontextprotocol/sdk`)
  exposing finances to Claude Desktop / Claude Code. Ten tools cover reads,
  atomic bulk expense/income/transfer creation, and plan listing/creation.
  Mutations remain create-only. Auth via a
  new optional `API_TOKEN` env: `middleware/auth.js` now accepts a constant-time
  `Authorization: Bearer <token>` alongside the JWT cookie; `config/env.js`
  enforces a 24-char floor. Setup in `docs/MCP.md`. Self-check: `mcp/test.mjs`.
- **Quick-add / repeat**: the Add-transaction sheet shows one-tap chips of
  recent distinct expense/income entries (`lib/templates.ts`,
  `useRecentTransactions`); tapping prefills type/amount/note/category/account.
- **Ledger search**: client-side filter over the loaded month (note, category,
  account names) — no new server round trip (`filterTxns` in
  `TransactionsScreen`). Server `note LIKE` skipped: the month view already
  loads the full set, and client filtering also matches category/account names
  and works offline.
- **Month-over-month** spend delta on Reports (reuses `GET /reports/summary`
  for `prevMonth(month)`; no new endpoint).
- **CSV export**: `GET /api/reports/export?month=` streams a `text/csv`
  attachment (`reports/csv.js` pure builder, RFC4180 quoting; `monthTransactions`
  repo join). Reports screen links it via a plain `<a download>` (same-origin
  cookie auth, no fetch/blob).
- **Budget pace**: each budget row shows "฿X left · ฿Y/day" (remaining over
  days-left-in-month) or "Over by ฿X" (`lib/budgetPace.ts`, current-month only).
- Tests: +11 server (csv unit + export router), +15 web (templates, budgetPace,
  prevMonth pure + search/template/MoM/pace screen assertions). 247 server / 69
  web passing.

### Security (Phase 7 hardening)
- security-reviewer pass: 0 CRITICAL / 0 HIGH. Fixed 1 MEDIUM + 1 LOW; 1 LOW
  accepted (documented below).
  - **MEDIUM** — `/api/sync/push` bypassed the per-entity zod validation the
    direct REST routes enforce, letting the authenticated user replay a write
    with an out-of-enum account `type`, a non-positive budget `limitAmount`, or
    over-length strings. `features/sync/ops.js` `applySimpleOp` now validates
    each op against the same `createSchema`/`updateSchema` exported from the
    feature routers (recurring also re-runs `validateTransactionFields`), and
    passes the stripped/validated data to the repo instead of the raw payload.
  - **LOW** — CSV export (`reports/csv.js`) had no spreadsheet formula-injection
    guard; `escapeField` now prefixes `'` to any field starting with `= + - @`,
    tab, or CR (amounts are always positive satang, so the numeric column is
    unaffected).
  - **LOW (accepted)** — `lib/safeCompare.js` early-returns on length mismatch
    before the constant-time compare, leaking secret length via timing. Standard
    pattern; `CRON_SHARED_SECRET` is a random 32-byte value, not attacker-shaped.
- Coverage gate met: server 88% stmts / 88% lines, web 86% stmts (both > 80%).
- Phase 7.1 confirmed already satisfied: `app.js` exports the app with no
  `.listen()` (Passenger provides the server), in-process cron gated to
  production, `/api/cron` behind the shared-secret compare, built PWA served
  same-origin with SPA fallback.
- Tests: +3 server (sync-push schema rejection ×2, CSV formula guard). 250
  server / 73 web passing.

## [0.2.0] - 2026-07-11
### Changed
- **Web frontend rebuilt** from scratch with a leaner React-Query architecture
  (replacing the prior custom offline-engine build). Full detail in
  `docs/WEB.md`. Mobile-first PWA, warm-paper/one-ink-accent design system
  (`theme/tokens.css`), online-only fetch upgraded to offline-capable (below).
- All write hooks refactored to keyed **mutation defaults** in
  `app/queryClient.ts` so offline writes are resumable.
### Added
- Screens: Login, Dashboard, Ledger (+ edit/delete via tap), Add/Edit
  transaction sheet (expense/income/transfer), Reports, Settings hub, and CRUD
  for Accounts / Categories / Budgets / Recurring. Shared month navigation
  (`MonthContext`), `ErrorBoundary`, `OfflineBanner`.
- **Offline sync** via React Query: cache persisted to `localStorage`
  (offline reads); writes pause offline and auto-replay on reconnect, surviving
  reload. No hand-rolled sync engine.
- **Same-origin serving**: Vite builds into `server/public/`; `app.js` serves
  it with SPA fallback in production (first-party cookie, no CORS).
- PWA icons (SVG + PNG 192/512/maskable via `sharp`).
- 54 web tests (Vitest + RTL), ~85% coverage, incl. offline pause/replay.
### Security
- Real `PASSWORD_HASH` set (bcrypt cost 12). Auth cookie confirmed `Secure` in
  production. `server/.gitignore` added (`.env`, `node_modules`, `public`).
### Fixed
- API-doc drift corrected in `docs/SCHEMA.md`: budgets return `limitAmount`
  (not `limit`); `/reports/summary` returns `monthIncome/monthExpense/monthNet`.
- Form prefill effect no longer wiped a typed amount when accounts loaded late.
- Amount fields force the mobile decimal numpad; category is a native selector.

## [0.1.0] - 2026-07-10
### Added
- Initial project documentation: PRD, TECH, SCHEMA, DESIGN, PLAN, SETUP.
- Design tokens installed from Apple.com marketing-page analysis (root `DESIGN.md`).
- `web/` scaffolded (Vite + React + TypeScript, react-router, Vitest + RTL).
- design-bakeoff: 2-variant frontend bake-off run against `docs/DESIGN.md`
  tokens; user picked "Quiet Card System" (Variant B). Winner ported to real
  components: `theme/tokens.ts`, `ui/` primitives (Button, Panel, Chip,
  AmountInput, Banner, EmptyState, ProgressBar, Skeleton, TxnRow,
  BottomTabBar), and Transactions/Budgets/Reports/Settings screens on
  in-memory mock data (no backend yet — Phase 1-3 not started).
- Icon set resolved to Phosphor (`@phosphor-icons/react`).
- 38 tests (Vitest + RTL), all passing. `code-reviewer` pass run: 2 HIGH
  (transfer transactions incorrectly counted in net-worth total; Save allowed
  a ฿0 transaction) and 1 MEDIUM (modal missing focus-on-open/Escape-to-close)
  fixed.
- `server/` scaffolded (Express, mysql2, zod, jsonwebtoken, bcrypt,
  cookie-parser, node-cron, express-rate-limit, uuid, dotenv; dev: jest,
  supertest). `config/env.js` fail-fast env validator (TDD, 11 tests).
- `db/pool.js` (mysql2 promise pool) + migrations `001_init.sql`/
  `002_seed.sql` + `db/migrate.js` runner with `schema_migrations` tracking.
  Applied to local dev MySQL database `xpense`: 7 tables
  (accounts/categories/transactions/budgets/recurring_rules/recurring_runs/
  schema_migrations), starter accounts (Cash/Bank) + 10 categories seeded.
- 16 server tests (Jest), all passing. `code-reviewer` pass run: 0 CRITICAL,
  1 HIGH reviewed and rejected as a false positive (flagged
  `transactions.updated_at` having no DB default — that's intentional per
  docs/SCHEMA.md's client-supplied LWW sync design, not a bug).
- `lib/apiResponse.js` (success/error envelope + `ApiError`) and
  `middleware/error.js` (central error handler, never leaks stack/SQL detail).
- Full JWT-cookie auth: `middleware/auth.js` (verify, TDD 5/5), `features/auth/`
  `service.js` (bcrypt compare + sign) and `router.js` (login/logout/me,
  rate-limited login), `app.js` (Passenger-clean, no `.listen()`),
  `dev-server.js` (local-only listener). 42 server tests (Jest) all passing,
  including a full login->me->logout->me supertest flow with a real cookie
  jar and a rate-limit trip test. `code-reviewer` pass run: 0 CRITICAL, 1 HIGH
  fixed (`trust proxy` unset would've broken the login rate limiter behind
  Hostinger's reverse proxy), 2 MEDIUM fixed (JWT `algorithms: ['HS256']`
  pinned on verify + sign; explicit 10kb JSON body-size limit). Smoke-tested
  end to end against the running dev server with curl.
- Disposable test DB `xpense_test` created + migrated; `server/.env.test` +
  `server/jest.setup.js` load it for all Jest runs so integration tests never
  touch the dev DB `xpense`.
- Phase 2 — accounts/categories/transactions CRUD. `lib/caseMap.js`
  (snake_case->camelCase) and `lib/mysqlDate.js` (ISO 8601 -> MySQL DATETIME)
  added as shared helpers; `db/pool.js` gained `dateStrings: true` to avoid
  timezone day-shift bugs on DATE columns. Accounts' `balance` is computed at
  query time via a SQL aggregate JOIN. Transactions enforce per-type field
  invariants (expense/income/transfer) with a fully unit-tested validation
  matrix, and support filtered + keyset-cursor-paginated listing. 115 server
  tests (Jest) all passing. Full lifecycle (login -> create account -> create
  category -> create expense -> balance reflects it -> delete) smoke-tested
  against the real dev DB with curl. `code-reviewer` pass run: 0 CRITICAL,
  1 HIGH (correctly identified as the already-known Phase-3.1-deferred
  scope — transactions PATCH/DELETE don't yet guard against stale
  `updatedAt` writes, same as the POST-upsert gap), 3 LOW (2 fixed: the
  original `categories.name` UNIQUE constraint blocked reusing a deleted
  category's name forever — moved to an app-level check, DB constraint
  dropped via migration `003_category_name_scoped_unique.sql`; `decodeCursor`
  now rejects malformed field types instead of risking a downstream 500;
  1 accepted as-is: `.env.test` reuses the real local dev DB password —
  low risk, gitignored, local-machine-only).
- Phase 3 — full sync contract + budgets + recurring + reports:
  - Transactions gained LWW-guarded `upsert`/`updateGuarded`/
    `softDeleteGuarded` (`shouldApply()` pure comparator); POST is now real
    upsert semantics (201 create / 200 edit-or-skip + `meta.syncStatus`),
    closing the Phase 2 gap.
  - `/api/sync` (GET pull incl. tombstones, POST `/push` batch replay with
    per-op `applied|skipped|error` results) in `features/sync/`.
  - `features/budgets/` — CRUD + monthly spent (SQL aggregate) + `over`
    flag. Migration `004_budget_category_scoped_unique.sql` fixed the same
    soft-delete/UNIQUE bug pattern as categories, this time proactively.
  - `features/recurring/` — rule CRUD (reuses transactions' per-type
    validation), `scheduler.js` (pure day/week/month date math with
    month-end clamping and catch-up, unit-tested before any DB/cron code),
    `runner.js` (atomic per-run-date `(rule_id, run_date)` idempotency
    guard), `cron/index.js` (node-cron, daily 01:00 Asia/Bangkok,
    production-only), Plan B `POST /api/cron/run` behind a
    constant-time-compared shared secret (`lib/safeCompare.js`).
  - `features/reports/` — category-spend + summary (balances + month
    income/expense/net).
  - 233 server tests (Jest) all passing, in parallel and with
    `--runInBand` (switched to `--runInBand` after discovering parallel
    workers caused real cross-file test pollution against the shared
    `xpense_test` DB on a global-aggregate query; also fixed at the root by
    giving that test a collision-free month rather than relying on
    serial execution alone). Every new endpoint smoke-tested live against
    the running dev server with curl, including the LWW guarantee
    (create -> stale skip -> newer apply -> delete) and the cron secret
    check (rejects missing/wrong, accepts correct).
  - `code-reviewer` pass: 0 CRITICAL, 1 HIGH (budgets' category-uniqueness
    check-then-create is not transactional — same accepted TOCTOU tradeoff
    as categories, documented in-code, not fixed for a solo-user app),
    2 MEDIUM fixed (LWW sub-second precision now documented in
    docs/TECH.md §7; reports' global-aggregate tests hardened).
- Phase 4.3/4.4 — PWA installability + client auth, `web/` wired to the real
  API for the first time:
  - `vite-plugin-pwa` installed and configured in `vite.config.ts`: manifest
    (name/icons/theme+background color from `theme/tokens.ts`), generated SW
    (app-shell precache + `NetworkFirst` runtime cache for GET `/api/*`
    reads, explicitly excluding `/api/auth/*`). Icons (192/512/maskable-512)
    generated locally with ImageMagick from a simple SVG monogram — no
    external asset-generator dependency. Verified via `npm run build`:
    `dist/manifest.webmanifest` + `dist/sw.js` + workbox runtime all
    generated correctly.
  - Vite dev proxy added (`/api` -> `http://localhost:3001`) so `web/`'s dev
    server can talk to `server/`'s dev server without a CORS dance.
  - `lib/fetchClient.ts` — generic `apiFetch<T>()`: `credentials: 'include'`,
    unwraps the server's `{ok,data,error}` envelope, throws `ApiClientError`
    (carries `status` + `code` + `message`) on any non-ok/failed response.
  - `features/auth/` — `api.ts` (login/logout/me), `LoginScreen.tsx`
    (password-only form, Panel/Button/Banner primitives, disabled submit on
    empty/whitespace-only password), route guard `RequireAuth` in
    `app/App.tsx` (calls `me()` on mount; distinguishes a real 401 ->
    redirect to `/login` from network/offline failures -> non-redirecting
    error banner; unmount-cancellation guard on the check).
  - 53 web tests (Vitest + RTL) all passing (up from 38), `tsc -b` clean,
    `npm run build` clean. Login flow smoke-tested live end to end via curl
    through the real Vite dev proxy (401 with no cookie -> login sets
    httpOnly cookie -> 200 authenticated with cookie) — no Claude-in-Chrome
    browser extension was connected this session, so this stood in for an
    in-browser check.
  - `code-reviewer` pass: 0 CRITICAL, 1 HIGH fixed (the workbox runtime
    cache initially matched `/api/auth/*` too, which could serve a stale
    cached session-check response and would outlive `logout()` in Cache
    Storage — excluded `/api/auth/*` from the cache pattern and added
    `logout()` clearing the `api-get-cache` Cache Storage entry),
    2 MEDIUM fixed (route guard collapsed a real 401 and a network/offline
    failure into the same login-redirect — now only a 401 `ApiClientError`
    redirects; added an unmount-cancellation flag on the guard's effect),
    1 LOW fixed (whitespace-only password no longer enables the submit
    button).
- Phase 5.1/5.2/5.3 — offline engine (`web/src/offline/`):
  - `db.ts` — Dexie schema: cached `accounts`/`categories`/`transactions`/
    `budgets`/`recurringRules` tables (1:1 with server rows, incl.
    `deletedAt` tombstones), an `outbox` queue table, a `meta` key/value
    table for the `lastSyncedAt` sync cursor. `fake-indexeddb` added as a
    dev dependency (`setupTests.ts` imports `fake-indexeddb/auto`) so Dexie
    is unit-testable under Vitest/jsdom without a real browser.
  - `outbox.ts` — `enqueue`/`getPendingOps` (FIFO by `createdAt`)/
    `markOpDone` (deletes the row — nothing more to do with it once
    synced)/`markOpFailed` (flips `status`, keeps the row for now).
  - `sync.ts` — `pull()` (GET `/api/sync?since=`, merges every row through
    `shouldApplyToCache()`, a direct port of the server's `shouldApply()`
    LWW comparator, so a pull can never clobber a locally-newer row still
    sitting unsent in the outbox); `push()` (POST `/api/sync/push`, one
    batch call per replay, applies each op's result to the matching outbox
    row). Both wrapped in a per-db-instance lock (`withSyncLock`) and a
    single Dexie `db.transaction('rw', ...)` around all the IndexedDB
    writes (network `fetch` happens outside the transaction — awaiting it
    inside one closes the IDB transaction early and throws
    `TransactionInactiveError` on the writes after it).
  - 79 web tests (Vitest + RTL) all passing (up from 53), `tsc -b` clean.
    Verified live end to end against the real running `server/` dev
    instance with two one-off `tsx` scripts (deleted after use, not part of
    the permanent suite, since `web/` had no browser harness at that time):
    (1) offline enqueue -> `push()` -> confirmed via `GET /api/accounts`
    that the server actually has the row -> `pull()` -> confirmed it's back
    in the local Dexie cache; (2) a dedicated check that the `lastSyncedAt`
    cursor written after a pull round-trips correctly through the server's
    strict `zod.datetime()` validation on a second pull (this exercises the
    MySQL-DATETIME-to-ISO-8601 conversion in `toIsoDatetime()`, which the
    unit tests cover in isolation but couldn't prove server-side acceptance
    of on their own).
  - `code-reviewer` pass: 0 CRITICAL, 3 HIGH fixed —
    (a) a `'skipped'` push result (server's LWW guard rejected a stale
    write) was being folded into the same "remove from outbox" branch as
    `'applied'` with no comment explaining why that's actually correct
    (resubmitting a stale-`updatedAt` op can never succeed) — made explicit
    in code;
    (b) the `lastSyncedAt` cursor was a client-clock `Date.now()` snapshot
    taken *before* the round trip completed — combined with MySQL's
    whole-second `updated_at` precision, a row that changed on the server
    between that snapshot and the query executing could be permanently
    skipped on every future pull. Fixed by deriving the next cursor from
    the actual max `updatedAt` observed in the rows just merged (and
    leaving the cursor unchanged when a pull returns nothing, rather than
    advancing on an empty response);
    (c) `pull()`'s multi-table merge and `push()`'s outbox status updates
    had no `db.transaction(...)` wrapper, so a crash/close mid-loop could
    leave the cache and the `lastSyncedAt` cursor in an inconsistent state
    (cursor advanced past rows never actually written). Fixed with
    `db.transaction('rw', [...tables], async () => {...})` around the
    writes, network calls kept outside.
    2 MEDIUM fixed — added `withSyncLock()` (a per-db-instance promise
    chain) so an `online` event and a periodic sync timer firing close
    together can't run `pull()`/`push()` concurrently and race the cursor
    or double-submit outbox ops; added a `results.length !== pending.length`
    guard in `push()` before applying any status change, so a
    malformed/truncated server response can't silently mark real pending
    ops as done. 1 MEDIUM accepted as an intentional Phase 6 deferral (see
    Known gaps below). 1 LOW folded into the results-length guard fix.
- Phase 6 — all six client screens wired off mock data onto the real API +
  offline engine (feature-complete per PRD.md):
  - **6.0 Foundation** (`web/src/offline/`): `hooks.ts` (`useLiveQuery`-based
    reactive reads for all 5 entities + `useOutboxStatus`), `mutations.ts`
    (generic `applyWrite` — cache write + outbox enqueue in one Dexie
    transaction, fire-and-forget `push()` after — plus 15 per-entity
    create/update/delete wrappers), `SyncBoot.tsx` (gates on one initial
    `pull()`, registers `online`-event + 5-minute interval sync, never
    blocks on network failure).
  - **6.3/6.2 Categories/Accounts**: `CategoryPicker`/`AccountPicker`
    (reusable across every form that references them) + manage screens
    with inline add/edit/delete. Both block deleting a row still
    referenced by a transaction, showing the reference count.
  - **6.1 Transactions** (largest slice): `AddTransactionSheet` rewritten
    for add+edit+delete with a live account/category picker, per-type
    field validation mirroring the server, and a stale-selection guard.
    Live-verified end to end via a one-off `tsx` script: offline create ->
    reconnect -> push -> server confirms it.
  - **6.4 Budgets**: live `spent`/`over` from the server, refetched on
    every local budget write *and* a 30s poll (fixes a real staleness bug
    a reviewer caught: adding a transaction elsewhere never re-triggered
    the old local-write-only refetch, so the over-budget banner could mask
    a real over-budget condition indefinitely). Edit-in-place gained a
    Cancel button.
  - **6.5 Recurring** (net-new UI): create form + pause/resume/delete list.
    `nextRunDate` rejects past dates and resuming a stale-paused rule now
    reschedules to today — both close a real flood risk: the server's
    catch-up scheduler generates one real transaction per missed scheduled
    occurrence on the next cron tick.
  - **6.6 Reports**: `SummaryCards` + `CategoryChart`, entirely
    API-driven (no offline cache reads — these are server aggregates).
    Cleanest slice of the phase, 0 findings beyond one LOW fixed
    (`ProgressBar` NaN-width guard when `max` is 0).
  - 185 web tests passing (up from 53 at the end of Phase 4), typecheck
    clean, build clean, stable across repeated full-suite runs.
    `code-reviewer` ran once per sub-phase; every actionable finding fixed
    (2 real HIGH bugs in the sync/mutation layer during 6.1's review: a
    lost-update race in `updateTransaction` when two writers edit the same
    row concurrently — fixed by making the read-merge-write atomic inside
    one Dexie transaction instead of two; and no visibility anywhere for a
    silently-failed outbox push — fixed with a Settings-screen banner
    reading `useOutboxStatus`).
  - **Post-implementation UI walkthrough** (Claude-in-Chrome, at the
    user's request, after they said the UI "looked pretty bad"): found and
    fixed 2 real bugs the automated suite couldn't catch because they only
    manifest against live synced server data:
    1. Every account showed `฿NaN` for its balance. Root cause:
       `GET /api/sync`'s `accountsRepo.findChangedSince` was a plain
       `SELECT * FROM accounts WHERE updated_at > ?` — it never computed
       the `balance` field the way `findAllWithSums` (used by
       `GET /api/accounts`) does, so every account synced into the
       offline cache via `pull()` was permanently missing `balance` (not
       just `NaN` transiently — a pull only re-fetches a row whose
       `updated_at` changes again, and a quiet account's row rarely does,
       so this was effectively permanent once synced). Fixed server-side:
       `accounts/repo.js` now shares one `SUMS_JOIN` block between
       `findAllWithSums` and a rewritten `findChangedSince`, and
       `features/sync/router.js` maps accounts through `mapAccountRow`
       instead of plain `rowToCamel`. Added regression tests at both the
       repo level (`findChangedSince` includes the sum columns and
       reflects real transaction activity) and the sync-router level
       (`GET /api/sync` returns a computed numeric `balance`, not just
       `startingBalance`). 236/236 server tests passing (up from 233).
    2. `AmountInput` (originally built once for `AddTransactionSheet`'s
       full-screen borderless "hero" amount display) had been reused as-is
       in `AccountsScreen`'s and `BudgetsScreen`'s inline forms, where it
       rendered with no border/background at all next to the clearly
       bordered text inputs around it — looked broken, not just
       stylistically off. Added a `variant: 'hero' | 'field'` prop; the
       `'field'` variant gets the same border/height/radius as every other
       inline text input. Verified live in-browser after the fix (reloaded
       with a cleared IndexedDB cache to also confirm the balance fix took
       effect on a fresh sync).

### Known gaps / follow-ups
- `server/.env`'s `PASSWORD_HASH` is still a placeholder for the dev password
  "changeme123" — replace with a real hash
  (`node -e "console.log(require('bcrypt').hashSync('yourpassword', 10))"`)
  before relying on login for anything beyond local dev.
- No silent JWT re-issue on activity yet (flat 7-day expiry) — deliberate v1
  scope per docs/SCHEMA.md, not a bug; revisit if 7 days proves too short.
- Root `README.md` still missing (Phase 0.1 partial).
- Budgets' and categories' "one active per category/unique name" checks are
  check-then-create, not transactional — a real race under concurrent
  writers could create two. Accepted for now (solo-user, single-session
  app); would need `SELECT ... FOR UPDATE` or a generated-column unique
  index if this ever needs to support concurrent writers.
- `offline/outbox.ts` ops marked `'failed'` (a genuine server error, not a
  stale-LWW `'skipped'`) have no retry/backoff or requeue path — they sit
  inert since `getPendingOps()` only selects `status === 'pending'`. Phase 6
  added visibility (a Settings-screen banner reading `useOutboxStatus`
  shows "N changes couldn't sync"), but not a fix — there's still no way
  to retry or discard a failed op, and no differentiation between terminal
  errors (`VALIDATION_ERROR`, a `NOT_FOUND` because another device already
  deleted the target row) and transient ones (`SERVER_ERROR`) that a naive
  retry might actually fix.
- Recurring rules referencing a since-deleted account/category have no
  "broken reference" warning — `RecurringScreen` falls back to
  `'Uncategorized'`/`'?'` gracefully but never prompts the user to fix or
  pause the rule, and the server-side cron has no existence check either
  (it will happily keep generating transactions against a dead id).
  code-reviewer MEDIUM; needs product input on the right UX, not a
  mechanical fix.
- Generated recurring transactions have no back-reference to the rule that
  created them (no `recurringRuleId` column on `transactions`) — a user
  can't tell "why did this rent transaction appear" from the UI. The
  linkage technically exists server-side via the `recurring_runs` join
  table (used only for cron idempotency) but is never surfaced. Needs a
  schema/API change, out of scope for a client-only phase.
# Frontend device verification

Run `cd web && npm test` and `npm run build`. Manually check 390x844, 744x1133,
1133x744, and 1440x900. On a physical iPad mini, check Safari, Chrome, and the
installed PWA in both orientations. Rotate with a transaction draft and Ledger
selection open.
