# xpenses — Architecture

## 1. High-Level Shape
```
[ API client ]  --HTTPS/JSON-->  [ Express API (Passenger) ]  -->  [ MySQL ]
                                          |
                                    node-cron (daily)
                                 recurring auto-insert
```
Single subdomain: `xpenses.merxylab.com`. API under `/api/*`.

## 2. Deployment Topology (Hostinger Business shared)
- Backend runs in Hostinger's Node.js App slot, managed by Phusion Passenger.
  - No custom listen port: export the Express `app` (Passenger provides the server).
  - `app.js` entry; `NODE_ENV=production`.
  - No always-on worker process guaranteed — cron runs inside the same app via
    node-cron; the app must stay warm. (Fallback: Hostinger cron job hitting a
    protected `/api/cron/run` endpoint — see SCHEMA.md Plan B.)
- MySQL hosted by Hostinger; credentials via env (never in repo).
- `deploy.sh` (SSH): `git pull` + `npm ci --omit=dev` on server.

## 3. Backend Structure (organize by feature)
```
server/
  app.js                 # express app, middleware, route mount, export app
  config/env.js          # load + validate env (fail fast)
  db/pool.js             # mysql2 pool
  db/migrate.js          # run SQL migrations in order
  middleware/auth.js     # verify JWT cookie
  middleware/validate.js # zod-based boundary validation
  middleware/error.js    # central error -> API envelope
  features/
    auth/       (routes, service, __tests__)
    accounts/   (routes, repo, service, __tests__)
    categories/ (routes, repo, service, __tests__)
    transactions/(routes, repo, service, sync, __tests__)
    budgets/    (routes, repo, service, __tests__)
    recurring/  (routes, repo, service, cron, __tests__)
    reports/    (routes, service, __tests__)
    savingsPots/(routes, repo, service, __tests__)
    entityWrites/ (shared write interface, schemas, business rules)
  lib/money.js           # satang helpers (pure, immutable)
  lib/apiResponse.js     # success/error envelope
  cron/index.js          # schedule recurring job
```

## 4. Data Flow — Writes
1. REST routes and sync push translate input into an entity write command.
2. `writeEntity` owns schema validation, conflicts, reference guards,
   recurring resume normalization, LWW ordering, and persistence.
3. REST maps the result to an HTTP envelope. Sync maps the same result to a
   per-operation status. Replay mode changes idempotency only, not business
   validation or integrity rules.

Savings-pot allocation and spending use explicit InnoDB transactions and row
locks. Allocation locks the account before the pot, preventing parallel writes
from reserving the same available balance twice. Pot-funded spending creates
the expense and purchase link atomically.

## 5. Data Flow — Reads / Sync
- `GET /api/sync?since=<updated_at>` returns changed categories,
  transactions, budgets, and recurring rules, incl. tombstones.
- Accounts return as a full snapshot after changed transactions are read.
  Their balances derive from transactions and have no independent timestamp.

## 6. Sync Reconciliation Rules
- REST and sync writes cross the same `writeEntity` seam, so validation,
  uniqueness conflicts, and delete reference guards cannot diverge.
- Transaction create: idempotent upsert on the client UUID, guarded by
  `updated_at`.
- Transaction update/delete: apply only if incoming `updated_at` is at least
  the stored value.
- Accounts, categories, budgets, and recurring rules use server timestamps.
  Sync replays of their creates and deletes are idempotent; updates still
  require an active existing row.
- Every delete is soft so pull sync can propagate its tombstone. Only
  transaction deletes use the client-timestamp LWW guard.
- Solo-user assumption removes concurrent-merge complexity by design.
- `updated_at` is stored with whole-second precision (MySQL DATETIME, no
  fractional seconds) — two edits to the same transaction within the same
  second compare as equal, and the guard's `>=` treats equal as "apply," so
  whichever write reaches the server second wins, not necessarily whichever
  the client made later. Accepted: same-second conflicting edits from a
  single solo user are rare enough not to warrant microsecond timestamps.

## 7. Auth Flow
- `POST /api/auth/login {password}` -> bcrypt.compare vs env hash -> set
  httpOnly, Secure, SameSite=Lax cookie with signed JWT (short-ish exp + silent
  re-issue on activity). All `/api/*` (except login) require the cookie.

## 8. Recurring Job
- node-cron daily at a fixed hour (server TZ = Asia/Bangkok).
- Query rules where `active=1 AND next_run_date <= today`.
- For each: insert txn from template, advance next_run_date by interval,
  wrap per-rule in try/catch, log outcome. Idempotency: unique
  (rule_id, run_date) guard row prevents double-insert if job runs twice.
- Resuming an overdue paused rule advances `next_run_date` by its existing
  interval to the first scheduled date on or after Bangkok today. Missed runs
  are not inserted. REST PATCH and sync push use the same pure normalization.

## 9. Technical Goals / NFRs
- Performance: sub-5s add-expense round-trip (no unnecessary server work).
- Availability: best-effort on shared hosting; no uptime SLA (solo personal tool).
- Scale: single user, low write volume — no horizontal scaling needed.
- Latency: API responses target <300ms on Hostinger shared MySQL for simple
  CRUD; sync pull bounded by `since` filtering (indexed on updated_at).

## 10. System Constraints
- Hostinger Business shared plan: Node runs only via Passenger App slot (no
  custom port, no guaranteed long-lived background process).
- MySQL version/features limited to what Hostinger shared MySQL supports —
  avoid MySQL 8-only syntax unless confirmed available.
- No dedicated Redis/cache tier available — no caching layer planned for v1.

## 11. Integration Points
- None external in v1 (no bank APIs, no OAuth, no push notification service).
- Hostinger cron (Plan B fallback) is the only "external" trigger, authenticated
  via a shared secret header on `/api/cron/run`.

## 12. Scalability Plan
- Not applicable at solo-user scale. If revisited: vertical scaling on
  Hostinger plan tier, or migrate to a VPS with a persistent Node process
  (removing the Passenger/cron-warmth constraint).

## 13. Deployment Target
- Hostinger Business shared hosting, subdomain `xpenses.merxylab.com`.
- Backend: Node.js App slot (Phusion Passenger managed).
- Database: Hostinger-provided MySQL instance.

## 14. Observability
- Logging: server-side console logs (stdout, captured by Passenger/Hostinger
  logs) for request errors and cron run outcomes.
- Metrics/alerting: none in v1 (no APM budget for a solo personal tool).

## 15. Testing Architecture
- Backend: unit (services, money, sync reconciler) + integration (supertest on
  routes against a test MySQL schema / or mysql2 with a disposable test DB).

## 16. Key Libraries (rationale)
- **express** — minimal, huge MySQL/Passenger compatibility.
- **mysql2** — promise-based MySQL driver, prepared statements.
- **zod** — schema validation at API boundary.
- **jsonwebtoken + bcrypt** — standard JWT/password hashing pair.
- **node-cron** — in-process scheduling for recurring job (Plan B: external
  Hostinger cron hitting `/api/cron/run`).
- **uuid** — client-generated transaction IDs.

---

## Architecture Decision Records

## [2026-07-10] Node.js + Express backend on Hostinger shared hosting
**Status:** Accepted

**Context:** Hostinger Business shared plan is PHP/LiteSpeed-native. Node is
only available via a constrained Node.js App slot (Phusion Passenger managed:
no custom listen port, no guaranteed always-on process). A PHP backend would
be a more natural fit for this host. The user was explicitly told of this
mismatch mid-interview and chose to proceed with Node anyway.

**Decision:** Keep Node.js + Express as the backend, deployed via Hostinger's
Passenger-managed Node.js App slot. Export the Express `app` (no custom
`.listen()`), rely on Passenger for the HTTP server, and run the recurring-txn
cron in-process via `node-cron` with a documented Plan B fallback
(`/api/cron/run` behind a shared secret, triggered by Hostinger's own cron)
in case the app process isn't kept warm reliably.

**Consequences:**
- Positive: user familiarity with the Node ecosystem preserved; zod/Express/mysql2
  stack is well-documented and simple.
- Negative: in-process cron reliability is not guaranteed on shared hosting —
  mitigated by the Plan B external-cron fallback, which must be kept in sync
  with the primary path (same idempotency guard table covers both).
- Negative: no custom port/process management flexibility Passenger doesn't expose.

---

## Security

- **Auth + authorization**: single shared password (bcrypt hash in env, never
  in code/repo). Login issues a JWT set in an httpOnly, Secure, SameSite=Lax
  cookie. All `/api/*` routes except `/api/auth/login` require a valid cookie,
  enforced by `middleware/auth.js`. No roles/permissions (single owner).
- **Input validation**: every route validates its body/query with zod at the
  boundary before touching the DB or business logic; invalid input returns
  `400 VALIDATION_ERROR` via the shared error envelope, never a raw stack trace.
- **Secret management**: `PASSWORD_HASH`, `JWT_SECRET`, MySQL credentials, and
  the Plan-B cron shared secret all come from environment variables only
  (`config/env.js` fails fast at boot if any required var is missing). Never
  hardcoded, never committed (`.gitignore` excludes `.env*`).
- **Known attack surfaces + mitigations**:
  - Login brute force -> rate-limited via `express-rate-limit` on
    `/api/auth/login`.
  - SQL injection -> `mysql2` parameterized queries only, no string-concatenated SQL.
  - Cookie theft/XSS -> httpOnly cookie (unreadable by JS) + Secure flag
    (HTTPS-only) + SameSite=Lax (limits cross-site send).
  - Cron endpoint abuse (Plan B) -> requires a shared-secret header, not
    public; treat as a second credential to rotate if exposed.
  - Error responses -> central `middleware/error.js` maps all errors to the
    standard envelope, stripping stack traces/SQL details from client responses.
- **Dependency audit process**: run `npm audit` (server) before each deploy;
  address CRITICAL/HIGH findings before shipping (see SETUP.md testing
  workflow and PLAN.md Phase 7 hardening task).
