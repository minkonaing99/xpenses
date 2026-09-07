# xpenses — Web Frontend

Mobile-first PWA for the xpenses API. Rebuilt 2026-07-11 with a lean
React-Query architecture (replacing the earlier custom offline-engine build).

## Stack

- React 19 + TypeScript, Vite 6, `react-router-dom` 7.
- `@tanstack/react-query` 5 for all server state (cache + mutations).
- `vite-plugin-pwa` (Workbox `generateSW`) for installable, offline-capable PWA.
- Plain co-located CSS + CSS variables. No UI framework, no CSS-in-JS.
- Native system font stack; tabular numerals for all money.

## Design system

Calm personal-finance / one-ink-accent, light theme. Tokens in `src/theme/tokens.css`
(OKLCH): warm paper, soft ink, and violet `--accent` for the
primary/add action and active tab; muted ledger tints (`--pos` green in,
`--neg` clay-red out) carry money sign, never the brand color. Money is
integer satang end to end; formatted to THB only at the display edge
(`src/lib/money.ts`).

## Structure (organized by feature)

```
web/src/
  main.tsx                 # PersistQueryClientProvider + router mount
  app/
    App.tsx                # auth gate (useMe) + routes
    Shell.tsx              # bottom tab bar (Home·Ledger·+·Reports·Settings)
    MonthContext.tsx       # shared selected month (dashboard/ledger/reports/budgets)
    queryClient.ts         # client + keyed mutation DEFAULTS (offline-resumable)
    ErrorBoundary.tsx, OfflineBanner.tsx
  api/
    types.ts               # domain types (money = satang)
    keys.ts, queries.ts, mutations.ts, hooks.ts (barrel)
  lib/
    api.ts                 # envelope-aware fetch client + ApiError
    money.ts, format.ts    # satang parse/format, Bangkok-TZ dates
  ui/                       # Button, Money, MoneyInput, Select, Segmented,
                            # Sheet, Chips, PageHeader, MonthSwitcher
  features/
    auth/ dashboard/ transactions/ accounts/
    categories/ budgets/ recurring/ reports/ settings/
```

## Screens

Login · Dashboard (private-by-default balance, month flow, anomaly insight cards,
upcoming recurring next 30 days, budget bars, category spend) · Ledger
(day-grouped, URL-backed multi-select filters, search across all cursor pages, and a
52/48 read-only detail split on wide iPads) · Add/Edit transaction sheet
(expense/income/transfer) · Reports (month stats, category bars, month-over-month
comparison, daily-spend calendar heatmap) · Settings hub → Accounts / Categories
/ Budgets / Recurring CRUD, plus a date-range export (CSV or JSON). Month
navigation is shared across data screens via `MonthContext`.

Dashboard sections can be hidden and reordered. Preferences are stored in
`xpenses.dashboard-layout.v1`. Quick-add supports four saved favorites and six
visible favorite/recent templates total via `xpenses.favorite-templates.v1`.
Deleted account/category references remain visible but disabled so the saved
favorite can be removed. No database or API schema is involved.

## Responsive behavior

- Phone and iPad portrait use labeled bottom navigation and bottom sheets.
- iPad landscape and desktop use an expanded sidebar and right-side sheets.
- Safe-area insets are applied on all four edges. Rotation keeps React route,
  selected transaction, open sheet, and draft state alive.
- Primary targets are at least 44px. The supported iPad mini CSS viewports are
  744x1133 portrait and 1133x744 landscape.
- Reports put chart/category data side by side when wide; category rows and
  donut segments open a filtered Ledger URL.

## Data + offline model

React Query is the single source of server state. There is no hand-rolled
sync engine.

- **Reads:** cached in memory and **persisted to `localStorage`**
  (`PersistQueryClientProvider` + `createSyncStoragePersister`). Read entries
  older than seven days are removed after restore. Last-known data renders
  offline; refetches when back online.
- **Ledger pagination:** the selected month loads up to 200 transactions first.
  "Load older transactions" follows the API cursor until the month is complete.
- **Writes:** every mutation's `mutationFn` + invalidation is registered as a
  **keyed mutation default** in `queryClient.ts`. React Query's default
  `networkMode: 'online'` **pauses** a write made offline and **auto-resumes**
  it on reconnect; because the fn lives in the client (not just a hook), a
  paused write survives a reload and replays via `resumePausedMutations()`.
- **Sync activity:** queued, sending, and failed writes appear in a compact
  global banner and detail sheet. Network/server failures can be retried;
  validation conflicts return to the owning screen. Writes share one FIFO lane
  so dependent offline changes preserve submission order.
- **Recovery:** paused and failed keyed mutations remain persisted until server
  acknowledgement or explicit discard. Sign-out
  confirms before clearing unresolved work. Active queries still refetch when stale.
- **Idempotency:** transactions use client-generated UUIDs; edits/deletes carry
  `updatedAt` (last-write-wins). Replays are safe against the server's upsert.
- **Invalidation:** after any write the client refetches broadly
  (`qc.invalidateQueries()`) — cheap at solo write volume.
- **Logout:** the endpoint is idempotent, including for missing or expired
  sessions. A successful logout clears both the in-memory query cache and the
  persisted `xpenses-cache` before reloading. Network failure keeps local state
  intact and shows a retryable error.

**Ceiling:** no optimistic UI — an offline write appears after it replays on
reconnect, not the instant Save is tapped. Add `onMutate` optimistic inserts
if instant offline feedback is wanted. The `/api/sync` bidirectional pull is
unused (persisted cache + reconnect refetch covers a single-user, single
logical device); wire it if the app goes multi-device.

## PWA

Installable, `standalone`, any orientation, theme-colored. Icons: `icon.svg` +
rasterized PNG 192 / 512 / maskable-512 (generated from SVG via `sharp`).
Service worker precaches the app shell; it does **not** cache `/api`
(NavigationRoute matches document navigations only, so API `fetch`es always
hit the network).

## Build, run, deploy

- **Dev:** `cd web && npm run dev` (Vite `:5173`, proxies `/api` → `:3001`).
  Backend: `cd server && npm run dev`.
- **Build:** `npm run build` emits into **`server/public/`** (`vite.config.ts`
  `build.outDir`). In production `server/app.js` serves that dir with an SPA
  fallback (`/api/*` excluded), so the frontend is **same-origin** with the API
  and the httpOnly auth cookie is first-party. No CORS, no separate host.
- **Deploy:** build `web` → `server/public/`, rsync `server/` (incl. `public/`)
  to Hostinger; Passenger runs `app.js` in production. `server/.env` and
  `server/public/` are gitignored.

## Testing

Vitest + Testing Library, jsdom. The suite covers money/format/api-client logic,
month context, UI primitives, every CRUD screen (create/edit/409-delete),
add-transaction validation/create/edit/delete, dashboard, reports, responsive
Ledger behavior, and offline pause-then-replay. Run `npm test` and `npm run build`.
Verify phone, iPad mini portrait/landscape, and desktop layouts manually before
release.

Ledger uses one collapsed Filters disclosure on every viewport. It contains the
type segmented control plus account and category checklists. Repeated
`accountId` and `categoryId` URL parameters use OR within each checklist and AND
between checklists; active list filters load all remaining transaction pages
before filtering locally. Reports group chart and summary in one column so a tall
category list cannot open a gap between them. Settings export actions keep an
intrinsic button size. Transfers omit the optional Note control. New transfers
submit a null note, while edits preserve any legacy hidden note. The API and
database schema are unchanged.

Appearance offers explicit Light and Dark themes stored per device as
`xpenses.theme.v1`. A validated pre-paint initializer applies the saved theme
before React mounts, including browser chrome color, so dark reloads do not
flash light. Theme state never reaches the API or database. Typography uses
the native iOS system stack with 20/28/34px display tiers; inputs remain 16px
to prevent Safari focus zoom.
