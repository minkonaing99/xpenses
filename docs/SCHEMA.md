# xpenses — Schema + API

## Conventions
- Engine InnoDB, charset utf8mb4.
- Money = signed/unsigned BIGINT in **satang** (1 THB = 100 satang). No floats.
- Transaction id is a client-generated UUID (CHAR(36)) = primary key -> enables
  append-only, collision-free offline creates.
- All mutable rows carry `updated_at` (LWW) and soft-delete `deleted_at`.
- Timestamps stored UTC; app TZ Asia/Bangkok for display + cron.

## Data Models

### accounts
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | CHAR(36) | PK, client UUID | |
| name | VARCHAR(80) | NOT NULL | |
| type | VARCHAR(32) | NOT NULL, default 'cash' | cash \| bank \| other |
| starting_balance | BIGINT | NOT NULL, default 0 | satang |
| sort_order | INT | NOT NULL, default 0 | |
| created_at | DATETIME | NOT NULL, default now | |
| updated_at | DATETIME | NOT NULL, on update now | LWW |
| deleted_at | DATETIME | NULL | soft delete |

### categories
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | CHAR(36) | PK, client UUID | |
| name | VARCHAR(80) | NOT NULL, UNIQUE | |
| icon | VARCHAR(40) | NULL | optional glyph key |
| sort_order | INT | NOT NULL, default 0 | |
| created_at | DATETIME | NOT NULL, default now | |
| updated_at | DATETIME | NOT NULL, on update now | LWW |
| deleted_at | DATETIME | NULL | soft delete |

### transactions
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | CHAR(36) | PK, client UUID | |
| type | VARCHAR(16) | NOT NULL | expense \| income \| transfer |
| amount | BIGINT | NOT NULL, > 0 | satang |
| note | VARCHAR(255) | NULL | |
| category_id | CHAR(36) | NULL, FK categories.id | required for expense |
| account_id | CHAR(36) | NULL, FK accounts.id | expense \| income |
| from_account_id | CHAR(36) | NULL, FK accounts.id | transfer |
| to_account_id | CHAR(36) | NULL, FK accounts.id | transfer |
| txn_date | DATE | NOT NULL | |
| created_at | DATETIME | NOT NULL, default now | |
| updated_at | DATETIME | NOT NULL | client-supplied, LWW |
| deleted_at | DATETIME | NULL | soft delete |

Indexes: `idx_txn_date`, `idx_txn_type`, `idx_txn_category`, `idx_txn_account`,
`idx_txn_updated_at`.

Application-level invariants (validated at API boundary, not DB CHECK, for
MySQL-version portability):
- expense: category_id + account_id set; from/to null.
- income: account_id set; category_id/from/to null.
- transfer: from_account_id + to_account_id set (and different); account/category null.

### budgets
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | CHAR(36) | PK, client UUID | |
| category_id | CHAR(36) | NOT NULL, UNIQUE, FK categories.id | one limit per category |
| limit_amount | BIGINT | NOT NULL | satang per month |
| created_at | DATETIME | NOT NULL, default now | |
| updated_at | DATETIME | NOT NULL, on update now | LWW |
| deleted_at | DATETIME | NULL | soft delete |

Monthly spend derived at query time (no per-month rows): sum of expense txns
for the category within the current calendar month, compared to limit_amount.

### recurring_rules
| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | CHAR(36) | PK, client UUID | |
| type | VARCHAR(16) | NOT NULL | expense \| income \| transfer |
| amount | BIGINT | NOT NULL | satang |
| note | VARCHAR(255) | NULL | |
| category_id | CHAR(36) | NULL, FK categories.id | |
| account_id | CHAR(36) | NULL, FK accounts.id | |
| from_account_id | CHAR(36) | NULL, FK accounts.id | |
| to_account_id | CHAR(36) | NULL, FK accounts.id | |
| interval_unit | VARCHAR(8) | NOT NULL | day \| week \| month |
| interval_count | INT | NOT NULL, default 1 | |
| next_run_date | DATE | NOT NULL | Overdue paused rules advance on resume to the first scheduled date on or after Bangkok today. |
| active | TINYINT(1) | NOT NULL, default 1 | |
| created_at | DATETIME | NOT NULL, default now | |
| updated_at | DATETIME | NOT NULL, on update now | LWW |
| deleted_at | DATETIME | NULL | soft delete |

Index: `idx_rule_due (active, next_run_date)`.

### recurring_runs (idempotency guard)
| Field | Type | Constraints | Notes |
|---|---|---|---|
| rule_id | CHAR(36) | PK (composite), FK recurring_rules.id | |
| run_date | DATE | PK (composite) | |
| transaction_id | CHAR(36) | NOT NULL | |
| created_at | DATETIME | NOT NULL, default now | |

The (rule_id, run_date) PK guarantees a due rule inserts at most one txn per
date even if the cron fires twice.

### planned_purchases
One-time future expenses. Active plans reserve their amount in account
forecasts; plans in selected month also reserve category budget forecasts.
They never appear in Ledger or Reports until confirmed. Confirmation creates
one expense transaction and links it to the plan. Deleting an active plan is
permanent. Confirmed plans remain available as purchase history and may store
one editable reflection rating and optional note.

## Relationships (ERD-style)
- Account has many Transactions (as account_id, from_account_id, to_account_id).
- Category has many Transactions (as category_id).
- Category has one Budget (unique category_id).
- RecurringRule has many RecurringRuns; each RecurringRun references one
  generated Transaction.

## Enums / Constants
- `transactions.type` / `recurring_rules.type`: `expense`, `income`, `transfer`.
- `accounts.type`: `cash`, `bank`, `other`.
- `recurring_rules.interval_unit`: `day`, `week`, `month`.
- `planned_purchases.reflection`: `worth_it`, `regret`, `not_sure`, or null.
- Currency: fixed, THB only — not a stored field, implied app-wide.

## Validation Rules (per field, boundary — zod)
- `amount`: integer, > 0 (satang).
- `type`: enum per table above.
- `name` (accounts/categories): required, 1-80 chars.
- `note`: optional, max 255 chars.
- `reflection_note`: optional, max 255 chars.
- `txn_date`: valid ISO date.
- `updated_at`: valid ISO datetime, client-supplied on writes.
- transfer: `from_account_id != to_account_id`.
- `limit_amount` (budgets): integer, > 0.
- `interval_count`: integer, >= 1.

## Soft Delete Strategy
Every mutable table has `deleted_at DATETIME NULL`. Deletes are UPDATEs
setting `deleted_at = now()` and bumping `updated_at`, never a hard `DELETE`.
Reads always filter `WHERE deleted_at IS NULL` unless explicitly fetching
tombstones for sync (`GET /api/sync`). This lets deletes propagate through the
same last-write-wins path as edits.

## Audit Fields Standard
Every table: `created_at` (set once, default now), `updated_at` (LWW clock,
bumped on every write — client-supplied for `transactions` since offline
clients set it, DB-default `ON UPDATE` elsewhere), `deleted_at` (soft-delete
tombstone). No `created_by`/`updated_by` — single-owner app, no multi-user attribution.

## Auth Model
- JWT signed with `JWT_SECRET` (env), delivered via httpOnly, Secure,
  SameSite=Lax cookie — not stored in JS-accessible storage.
- No refresh-token rotation in v1: short-ish expiry with silent re-issue on
  activity (server extends/reissues cookie on authenticated requests).
- No user table: the token simply asserts "authenticated", checked against a
  single `PASSWORD_HASH` env var at login time.

## File / Media Storage
TBD — not needed for v1 (no receipt photos/attachments in scope).

## Caching Layer
None in v1. No Redis/CDN tier on Hostinger shared hosting; reads go straight
to MySQL.

## Background Jobs
| Job | Trigger | Retry policy |
|---|---|---|
| Recurring transaction insertion | node-cron, daily (Asia/Bangkok) | Per-rule try/catch; failed rule logged, other rules unaffected; idempotency via `(rule_id, run_date)` PK prevents double-insert on retry/re-run. |
| Recurring insertion (Plan B) | Hostinger external cron -> `POST /api/cron/run` | Same idempotency guard as above; safe to call more than once per day. |

## Migration Strategy
Plain ordered SQL files run by `db/migrate.js`: `001_init.sql` (tables) ->
`002_seed.sql` (accounts+categories). Naming convention: zero-padded sequence
prefix + short snake_case description (`00N_description.sql`). A
`schema_migrations(version, applied_at)` table tracks applied files; the
runner applies any file not yet recorded, in filename order. No down-migrations
in v1 (solo project, forward-only).

## Seed Data (migration)
- accounts: "Cash" (cash), "Bank" (bank), starting_balance 0.
- categories starter list: Food, Groceries, Transport, Bills, Shopping,
  Health, Entertainment, Rent, Salary, Other.

## Balance Query (per account)
```sql
-- current balance = starting_balance
--   - expenses from account
--   + income to account
--   - transfers out (from_account) + transfers in (to_account)
```
Computed in the accounts service via aggregated queries over non-deleted txns.

---

## API

Base: `/api` · JSON only · Auth via httpOnly JWT cookie (all routes except login and logout).
No versioning in v1 (single consumer, solo app) — `/api/*` is implicitly v1.

### Response Envelope
```json
// success
{ "ok": true,  "data": <payload>, "meta": { } }
// error
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```
Codes: `VALIDATION_ERROR`(400) `UNAUTHORIZED`(401) `NOT_FOUND`(404)
`CONFLICT`(409) `RATE_LIMITED`(429) `SERVER_ERROR`(500).

### Auth
| Method | Path | Body | Auth Required | Notes |
|---|---|---|---|---|
| POST | /api/auth/login | `{ password }` | No | Sets JWT cookie. Rate-limited. |
| POST | /api/auth/logout | — | No | Idempotently clears the session cookie. |
| GET  | /api/auth/me | — | Yes | 200 if session valid, else 401. |

### Accounts
| Method | Path | Body / Query | Auth Required | Notes |
|---|---|---|---|---|
| GET    | /api/accounts | — | Yes | List incl. computed current balance. |
| POST   | /api/accounts | `{ id, name, type, startingBalance }` | Yes | id = client UUID. |
| PATCH  | /api/accounts/:id | partial | Yes | LWW via updatedAt. |
| DELETE | /api/accounts/:id | — | Yes | 409 if referenced by txns. Soft delete. |

### Categories
| Method | Path | Body | Auth Required | Notes |
|---|---|---|---|---|
| GET    | /api/categories | — | Yes | List. |
| POST   | /api/categories | `{ id, name, icon? }` | Yes | |
| PATCH  | /api/categories/:id | partial | Yes | |
| DELETE | /api/categories/:id | — | Yes | 409 if referenced. Soft delete. |

### Transactions
| Method | Path | Body / Query | Auth Required | Notes |
|---|---|---|---|---|
| GET    | /api/transactions | `?month=YYYY-MM&type=&accountId=&categoryId=&limit=&cursor=` | Yes | Filtered, paginated, excludes deleted. |
| GET    | /api/transactions/:id | — | Yes | Single. |
| POST   | /api/transactions | full txn (see below) | Yes | Idempotent upsert on `id`. |
| POST   | /api/transactions/bulk | `{ transactions: [...] }` (1-20 full txns) | Yes | Atomic ordered, create-only batch. Identical IDs replay; conflicting reuse returns 409; any failure rolls back all items. |
| PATCH  | /api/transactions/:id | partial + `updatedAt` | Yes | LWW. |
| DELETE | /api/transactions/:id | `{ updatedAt }` | Yes | Soft delete (LWW). |

Transaction body:
```json
{
  "id": "uuid",
  "type": "expense|income|transfer",
  "amount": 12500,
  "note": "coffee",
  "categoryId": "uuid|null",
  "accountId": "uuid|null",
  "fromAccountId": "uuid|null",
  "toAccountId": "uuid|null",
  "txnDate": "2026-07-10",
  "updatedAt": "2026-07-10T09:00:00.000Z"
}
```

### Sync
| Method | Path | Query / Body | Auth Required | Notes |
|---|---|---|---|---|
| GET  | /api/sync | `?since=<ISO>` | Yes | Returns a full account snapshot plus other rows changed since timestamp, incl. tombstones. |
| POST | /api/sync/push | `{ ops: [{ entity, action, payload }] }` | Yes | Batch replay of outbox through the same validation, conflict, and reference-guard rules as REST; per-op result array so client can mark done/failed. |

`push` response:
```json
{ "ok": true, "data": { "results": [ { "id": "...", "status": "applied|skipped|error", "code": "..." } ] } }
```
`skipped` = incoming updatedAt older than stored (LWW no-op).

### Budgets
| Method | Path | Body | Auth Required | Notes |
|---|---|---|---|---|
| GET    | /api/budgets | `?month=YYYY-MM` | Yes | Each: id, categoryId, limitAmount, spent, over (bool). Drives banner. |
| POST   | /api/budgets | `{ id, categoryId, limitAmount }` | Yes | One per category (409 on dup). |
| PATCH  | /api/budgets/:id | `{ limitAmount }` | Yes | |
| DELETE | /api/budgets/:id | — | Yes | Soft delete. |

### Recurring
| Method | Path | Body | Auth Required | Notes |
|---|---|---|---|---|
| GET    | /api/recurring | — | Yes | List rules. |
| GET    | /api/recurring/upcoming | `?days=30` | Yes | Read-only projection: active rules' occurrences in `[today, today+days]`, flattened + sorted by date. Each item = the rule plus `date`. Does not insert txns. |
| POST   | /api/recurring | rule template + `{ intervalUnit, intervalCount, nextRunDate }` | Yes | |
| PATCH  | /api/recurring/:id | partial (incl. `active`) | Yes | Pause/resume. Resuming an overdue rule preserves cadence, skips missed runs, and advances `nextRunDate` to the first scheduled date on or after Bangkok today. |
| DELETE | /api/recurring/:id | — | Yes | Soft delete. |

### Plans
| Method | Path | Body / Query | Auth Required | Notes |
|---|---|---|---|---|
| GET | /api/plans | `?month=YYYY-MM` | Yes | Active plans, confirmed purchase history, and account/budget forecasts. |
| POST | /api/plans | `{ id, name, amount, accountId, categoryId, plannedDate, waitDays }` | Yes | Idempotent on `id`; conflicting reuse returns 409. `waitDays` 0-30, default 7. Planned date moves to end of wait if needed. |
| PATCH | /api/plans/:id | active plan fields, or `{ reflection, reflectionNote? }` for a confirmed purchase | Yes | Increasing an active plan price restarts its waiting period. Reflection updates never change its transaction. |
| DELETE | /api/plans/:id | — | Yes | Permanently deletes active plan. |
| POST | /api/plans/:id/confirm | — | Yes | After wait ends, creates linked expense dated today. |

### Reports
| Method | Path | Query | Auth Required | Notes |
|---|---|---|---|---|
| GET | /api/reports/category-spend | `?month=YYYY-MM` | Yes | `[{ categoryId, name, total }]` for the chart. |
| GET | /api/reports/summary | `?month=YYYY-MM` | Yes | `{ accounts:[{id,name,type,balance}], monthIncome, monthExpense, monthNet }` (satang). |
| GET | /api/reports/daily-spend | `?from=YYYY-MM-DD&to=YYYY-MM-DD` | Yes | `[{ date, total, topCategoryName }]` expense-only spend per day over the inclusive range. `topCategoryName` is the highest-spend category that day. Feeds the calendar heatmap. Satang. |
| GET | /api/reports/export | `?month=YYYY-MM` \| `?from=&to=` `&format=csv\|json` | Yes | Attachment of transactions. `month` **or** `from`+`to` (inclusive) required; `format` defaults `csv`. Columns/keys: `date,type,category,account,amount_thb,note`. Amount in baht (2dp). |

### Cron (Plan B, optional)
| Method | Path | Auth Required | Notes |
|---|---|---|---|
| POST | /api/cron/run | shared secret header | Triggers recurring insertion if Hostinger cron is used instead of in-process node-cron. |

### Validation Rules (boundary)
- amount: integer, > 0.
- type in {expense, income, transfer}; account/category fields validated per type.
- transfer: fromAccountId != toAccountId.
- dates: valid ISO; txnDate is a date, updatedAt a datetime.
- All string lengths bounded per schema.

### Error Response Format
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "amount must be > 0" } }
```
Always the same envelope shape; never a raw stack trace or SQL error message.

### Rate Limiting
`/api/auth/login` is rate-limited (via `express-rate-limit`) to blunt password
brute-forcing. No rate limiting elsewhere in v1 (single trusted client).
