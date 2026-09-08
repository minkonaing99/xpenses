# Savings Pots Implementation Plan

Status: implemented on `version3.2.0`.

## Goal

Reserve money already held in an account for a named purpose without changing
the account balance, income, expense totals, or monthly budgets.

The first release supports manual pots, one account per pot, and THB only.

## Scope

Included:

- Create a pot with name, target amount, and account.
- Allocate available account money to a pot.
- Release reserved money from a pot.
- Show reserve, target progress, account balance, and unreserved amount.
- Record one expense funded by one pot in the same account.
- Archive a pot only when its reserve is zero.
- Preserve allocation, release, purchase, and archive history.
- Keep writes idempotent and compatible with the pending-write queue.

Deferred:

- Automatic or recurring contributions.
- Target deadlines and monthly saving suggestions.
- One pot spanning multiple accounts.
- One purchase funded by multiple pots.
- Partial pot funding.
- Links between pots and planned purchases.
- Combined plan and pot affordability totals.
- Pot transfers, sharing, currencies, and interest tracking.

## Domain rules

- Allocation and release are reservation changes, not transactions.
- An actual transfer between accounts remains a normal transfer transaction.
- Pot reserve carries across months.
- Target amount is a goal, not money. Changing it does not change reserve.
- Account available amount is `balance - total active reserves`.
- Available amount may be negative after an ordinary expense. Show this as a
  shortfall and block new allocations until it is corrected.
- Allocation must not exceed the account's current available amount.
- Release and pot-funded spending must not exceed that pot's reserve.
- Pot-funded spending creates exactly one normal expense and links it to the
  pot in the same database transaction.
- A pot-funded expense must use the pot's account.
- Editing a linked expense may change amount, date, category, or note. It may
  not change account, and an increase may not exceed the restored pot reserve.
- Deleting a linked expense restores its amount to the pot reserve. The link
  remains visible in history.
- Archive requires an exact zero reserve. Archived pots are read-only.
- All money uses positive integer satang. Direction comes from operation type.

## Data model

Add migration `005_savings_pots.sql`.

### `savings_pots`

| Field | Type | Rule |
|---|---|---|
| id | CHAR(36) | Primary key, client UUID |
| name | VARCHAR(80) | Required |
| target_amount | BIGINT | Positive satang |
| account_id | CHAR(36) | Active account FK |
| archived_at | DATETIME | Null while active |
| created_at | DATETIME | Server timestamp |
| updated_at | DATETIME | Server timestamp |

Indexes: `(account_id, archived_at)` and `(archived_at, created_at)`.

### `savings_pot_movements`

Immutable manual reserve changes.

| Field | Type | Rule |
|---|---|---|
| id | CHAR(36) | Primary key, client UUID |
| pot_id | CHAR(36) | Pot FK |
| type | VARCHAR(16) | `allocate` or `release` |
| amount | BIGINT | Positive satang |
| note | VARCHAR(255) | Optional; required for a correction |
| created_at | DATETIME | Server timestamp |

Index: `(pot_id, created_at)`.

There is no update or delete operation. Corrections use a new opposite movement
with a note, preserving the ledger.

### `savings_pot_purchases`

| Field | Type | Rule |
|---|---|---|
| transaction_id | CHAR(36) | Primary key and transaction FK |
| pot_id | CHAR(36) | Pot FK |
| created_at | DATETIME | Server timestamp |

Index: `(pot_id, created_at)`.

Reserve is derived, not stored:

```text
reserve = allocations - releases - active linked expense amounts
```

Deriving purchase usage from the linked transaction makes amount edits and
soft deletion reconcile automatically. Deleted purchases stay in history but
do not consume reserve.

## Concurrency and idempotency

- Allocation begins a transaction and locks the referenced account row with
  `SELECT ... FOR UPDATE` before recomputing account balance and all reserves.
- Release, spend, and archive lock the pot row before checking reserve.
- Use indexed primary-key lookups for row locks.
- Lock account first, then pot, everywhere that needs both, preventing reversed
  lock order.
- Client UUIDs make movement creation and pot-funded expense creation retryable.
- Reusing an ID with identical data returns the existing result.
- Reusing an ID with different data returns `409 CONFLICT`.
- A failed transaction rolls back every related insert or update.

This follows InnoDB guidance to group related writes in transactions and lock
only the rows that protect the invariant:
https://dev.mysql.com/doc/refman/8.0/en/innodb-best-practices.html

## API

All routes require existing cookie authentication and standard envelopes.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/savings-pots` | Active pots, archived pots, totals, and recent history |
| POST | `/api/savings-pots` | Create `{ id, name, targetAmount, accountId }` |
| PATCH | `/api/savings-pots/:id` | Edit name or target amount |
| POST | `/api/savings-pots/:id/movements` | Create `{ id, type, amount, note? }` |
| POST | `/api/savings-pots/:id/spend` | Atomically create and link one expense |
| POST | `/api/savings-pots/:id/archive` | Archive a zero-reserve pot |

The spend body contains the normal expense fields except `accountId`, which is
taken from the pot: `{ id, amount, categoryId, note?, txnDate, updatedAt }`.

Response pots include:

```text
reserved, targetAmount, progress, accountBalance, accountAvailable, shortfall
```

Do not add these entities to the legacy `/api/sync` contract. The current web
app uses persisted React Query reads and keyed offline mutations, as Plans do.

## Backend structure

Add `server/features/savingsPots/` with `router.js`, `repo.js`, `service.js`, and
co-located tests. Mount it at `/api/savings-pots`.

Responsibilities:

- `repo.js`: parameterized reads, aggregates, locks, and inserts.
- `service.js`: immutable reserve, available, progress, and shortfall math.
- `router.js`: zod validation, transactions, conflict mapping, and envelopes.
- Transaction writes: add one shared guard for linked pot expenses so every
  edit path enforces account and reserve rules.
- Account deletion: count pot references and return a conflict.

Keep Plans forecasting unchanged. Pots and Plans remain independent in this
release.

## Web experience

Add `/pots`, linked from Settings as `Savings pots`. Do not add another primary
navigation tab.

### List screen

- Header with total reserved and total available.
- Active pot cards show name, account, reserved amount, target amount, and a
  progress bar.
- Negative account availability uses a clear shortfall warning.
- Archived pots appear in a collapsed history section.
- `Add pot` opens the existing responsive `Sheet` pattern.

### Pot detail sheet

- Reserve and target progress.
- Account balance and unreserved amount.
- Actions: `Add money`, `Release`, `Spend`, `Edit`, and `Archive`.
- Recent history combines movements and linked purchases in time order.
- Deleted purchases show `Transaction deleted` and restored reserve.

### Forms

- Reuse `MoneyInput`, `Select`, `Chips`, `Button`, `Money`, and `Sheet`.
- Disable submission for invalid amounts or missing references.
- Show the resulting reserve or available amount before confirmation.
- Require confirmation for release, spend, and archive.
- Meet 44px target sizing and verify phone, iPad portrait, iPad landscape, and
  desktop layouts.

## Client data and offline behavior

- Add `SavingsPot`, `SavingsPotMovement`, and `SavingsPotHistoryItem` types.
- Add one pots query key and read hook.
- Register keyed mutations for create, edit, movement, spend, and archive.
- Keep all writes in the existing FIFO `writes` scope.
- Persist paused or failed writes through the existing query client.
- Broad invalidation remains acceptable at solo-user scale.
- Pot spend invalidates accounts, pots, transactions, reports, budgets, and
  insights through that existing broad invalidation.
- Surface pot mutations in the current pending-sync list using concise labels.

TanStack Query's default online network mode pauses mutations while offline;
the existing registered mutation defaults remain required for reload recovery:
https://tanstack.com/query/latest/docs/framework/react/guides/network-mode

## TDD slices and commits

Use RED -> GREEN -> REFACTOR for every implementation slice.

1. `docs: plan savings pots`
   - This plan and schema/API documentation placeholders.
2. `feat(pots): add pot storage and read model`
   - Migration, pure calculations, repository aggregates, list/create API.
3. `feat(pots): allocate and release reserves`
   - Immutable movements, row locking, oversubscription checks, retries.
4. `feat(pots): spend reserved money atomically`
   - Expense creation, purchase link, transaction edit/delete guard.
5. `feat(web): add savings pots management`
   - Types, query, mutation defaults, route, list, detail, and forms.
6. `feat(pots): expose account availability`
   - Add reserved/available display where account balances are shown.
7. `docs: finish savings pots documentation`
   - `SCHEMA.md`, `WEB.md`, `TECH.md`, `SETUP.md`, and release notes.

Each commit must keep backend and frontend tests passing.

## Required tests

Backend:

- Allocation and release never change account balance or expense reports.
- Two concurrent allocations cannot reserve the same available money.
- Allocation rejects insufficient availability, including existing shortfall.
- Release and spend reject amounts above reserve.
- Spend creates one expense and one link in one transaction.
- Retry with the same IDs does not duplicate movements or expenses.
- Changed payload with reused ID returns conflict.
- Linked expense amount edits recalculate reserve.
- Linked expense account changes are rejected.
- Linked expense deletion restores reserve while preserving history.
- Archive rejects nonzero reserve and blocks later writes.
- Account deletion rejects pot references.
- Every input boundary rejects invalid UUIDs, money, text length, and refs.

Frontend:

- Empty, loading, error, active, archived, and shortfall states.
- Create, allocate, release, spend, edit, and archive flows.
- Confirmation summaries show resulting values.
- Pending pot writes survive reload and resume in FIFO order.
- Mutation failures stay recoverable and do not double-submit.
- Accessible labels, keyboard operation, and 44px controls.

Maintain at least 80 percent coverage in both packages.

## Release gate

- Run server and web test suites, coverage, production build, and dependency
  audits.
- Run secret and unsafe-input scans.
- Review all money and transaction boundaries.
- Apply migration before deploying application code.
- Smoke test allocate, release, spend, edit, delete, retry, archive, and offline
  replay against a disposable database.
- Manually verify phone and iPad layouts.

## Success criteria

- Reserved money is never counted as spending or removed from account balance.
- The same account money cannot be allocated twice.
- Pot-funded spending affects financial reports exactly once.
- Retried writes never duplicate money movement.
- Current reserve remains correct after linked expense edits or deletion.
- Users can always distinguish balance, reserved, available, and shortfall.

The model follows envelope budgeting's rule that only money already held can be
assigned: https://actualbudget.org/docs/budgeting/
