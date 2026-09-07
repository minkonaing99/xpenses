# Future plan

Status: ideas for later implementation. No feature implementation authorized by this document.

## Savings pots

### Purpose

Reserve existing money for a trip, emergency fund, laptop, or other goal.
Money stays in its account. A pot tracks its intended purpose.

Proposed first version: manual allocations, one account per pot, THB only.
Reuse existing accounts, transaction entry, money helpers, and UI components.

### User flow

1. Create a pot with name, target amount, and account holding the money.
2. Allocate available account money to the pot.
3. View reserved amount and target progress.
4. Release money when plans change, without recording income.
5. Record a purchase using the pot; reduce its reserve alongside the expense.
6. Archive an empty pot while preserving its history.

### Money rules

- Allocating money is not an expense. Releasing money is not income.
- Moving actual money between accounts remains a normal transfer.
- Account available amount = current balance minus all its pot reserves.
- This available amount does not yet subtract future bills or planned purchases.
- Pot reserves carry across months until spent or released.
- Targets describe desired savings, not additional reserved money.
- Reject allocations exceeding the account's unreserved funds.
- Reject releases or pot-funded spending exceeding that pot's reserve.
- First version funds one expense from one pot in the same account.
- Record the expense and reserve reduction atomically and idempotently.
- Expense edits or reversals must reconcile linked pot entries exactly once.
- Preserve allocation history through explicit entries and corrections.
- Store money as integer satang; validate amounts and account references server-side.
- Ordinary expenses or transfers can leave an account below its reserves.
  Show the shortfall and require reallocation before adding reserves; never hide it.

### Example

| State | Bank balance | Emergency pot | Trip pot | Unreserved |
|---|---:|---:|---:|---:|
| Before purchase | THB 30,000 | THB 10,000 | THB 5,000 | THB 15,000 |
| Spend THB 3,000 from Trip | THB 27,000 | THB 10,000 | THB 2,000 | THB 15,000 |

The purchase counts once in expense reports. Using reserved money leaves
the unreserved amount unchanged.

### Relationship with Plans

Existing Plans describe intended purchases. Pots describe money reserved.
Keep them independent initially; defer linking and combined affordability totals.
When linked later, deduct only a plan's unfunded portion in addition to reserves.
Confirming a linked purchase must create one expense and consume its reserve once.

### Acceptance checks for implementation

- Allocations and releases leave account balances and expense totals unchanged.
- Multiple pots cannot allocate the same available money, including concurrent requests.
- Spending from a pot updates the account, reserve, and reports consistently.
- Retried submissions never duplicate expenses or reserve movements.
- Corrections restore the right amounts without removing history.
- Month changes preserve reserves; insufficient backing displays a shortfall.
- Archive requires zero reserve; linked account history remains accessible.

### Defer

Automatic contributions, deadlines, monthly saving suggestions, multiple accounts
per pot, partial pot funding, and Plan links. Add when manual use reveals a need.

### Reference

[Actual Budget's budgeting model](https://actualbudget.org/docs/budgeting/)
provides an established example of assigning existing money and carrying unused
funds forward. This proposal keeps Xpenses' existing category budgets separate.

## Purchase reflection

### Purpose and first version

Learn which planned purchases felt worthwhile after using them.
Add optional reflection to confirmed purchases: "Worth it", "Regret", or
"Not sure yet", plus a short note. Unreviewed purchases remain separate.

- Open a confirmed purchase and record a reflection.
- Show purchase amount, purchase date, current reflection, and note together.
- Offer an in-app review list after seven days; allow reviewing sooner or skipping.
- Preserve confirmed purchases as accessible history after leaving the active Plans list.
- Allow changing an opinion later without changing the financial transaction.
- Summarize counts and purchase amounts by reflection, with the reviewed count visible.
- Treat results as personal feedback, not proof of what caused satisfaction.

### Acceptance checks

- Unconfirmed plans cannot be reviewed as completed purchases.
- Ratings and notes never change balances, budgets, or expense totals.
- Unreviewed and "Not sure yet" purchases are excluded from worth-it/regret ratios.
- Repeated saves do not create duplicate reflections for the same purchase.
- Deleted or reversed purchases retain understandable links and history.
- Validate rating choices and note length; render notes as text.

Defer push reminders, scores, AI interpretations, and category rankings until
there are enough reflections to make them useful. Seven days is a proposed
review delay, not a requirement for every kind of purchase.

## Pending sync list

### Purpose and first version

Make unsent and failed changes visible so users know whether a save reached
the server. Extend the existing React Query mutation persistence and offline
banner; inspect current behavior before introducing any additional storage.

- Show a compact pending count with an action to open the list.
- Each row shows action, record summary, local submission time, and status.
- Distinguish "Waiting for connection", "Sending", and "Needs attention".
- Resume eligible paused writes on reconnect through the existing mechanism.
- Offer retry for recoverable failures, keeping the original operation identity.
- Explain validation errors with a correction path; request login for expired sessions.
- Remove successful rows only after server acknowledgement.
- Do not label stale writes skipped by the server as successfully applied edits.

### Acceptance checks

- Paused and failed entries remain recoverable across reloads; verify whether
  failed mutations need explicit persistence beyond current defaults.
- Retry after a lost response does not duplicate a transaction.
- Disable repeated retry while an operation is in flight.
- Preserve ordering for dependent edits to the same record.
- Never blindly retry validation failures or overwrite newer server data.
- Warn before logout clears unsent work; keep recovery possible if logout fails.
- Verify cache expiry and cleanup cannot silently erase unresolved entries.
- Server error details shown to users exclude secrets and internal diagnostics.

Defer optimistic balances, bulk retry, and cancellation until individual status
and recovery are reliable. Cancelling an in-flight request cannot guarantee
that the server has not already applied it.

Reference: [TanStack Query mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
documents retry and persisted offline mutations. Reuse those capabilities where
they satisfy the required recovery behavior.

## Balance check

### Purpose and first version

Compare one account's tracked balance with its actual bank balance or counted
cash. Start with manual input, difference, recent transactions, and last-checked
date. No bank connection required.

### User flow

1. Open an account and tap "Check balance".
2. Enter actual balance from the bank or physical cash count.
3. Show difference = actual balance minus tracked balance.
4. Review transactions since the last successful check, with access to older entries.
5. Record a missing transaction or correct an identified mistake through normal flows.
6. When balances match, tap "Mark checked" and save the matched balance and check time.

Example: tracker THB 12,800, bank THB 12,450, difference -THB 350.
Show "Tracker has THB 350 more than actual account." A forgotten THB 350 dinner
would explain it, but the difference alone cannot identify the cause.

### Matching rules and acceptance checks

- Compare bank posted balance with tracker entries covering the same point in time.
  Explain that pending charges may require waiting or reviewing timing differences.
- Use the actual account balance, not the amount left after savings pot reservations.
- Require fresh server data and resolved pending account writes before marking checked.
- Revalidate the balance when saving a check; concurrent changes require another review.
- Store and compare integer satang; accept valid zero and negative bank balances.
- A check records a snapshot and does not alter transactions or starting balance.
- Backdated additions, edits, or deletions affecting a checked period flag it for review;
  keep the original check as history rather than implying it still proves a match.
- Never mark an unresolved nonzero difference as matched.

### Unknown differences

Offer an explicit "Record adjustment" with required note if the cause stays unknown.
Show amount and resulting balance before confirmation. Preserve original history;
record the correction separately from ordinary income and spending in reports.
Adjustment creation and retries must be atomic and idempotent.

The first release can defer adjustments until their accounting and report behavior
are implemented. Manual checks and recording identifiable missing transactions
remain useful on their own. Defer statement import and automatic matching.

Reference: [Actual Budget reconciliation](https://actualbudget.org/docs/accounts/reconciliation/)
provides an established account-to-bank comparison workflow.

## Additional candidates

These are optional backlog ideas, not commitments to implement everything.

### Trip and project tags

Group expenses under "Japan trip" or "Home office" across existing categories.
Start with a reusable tag, Ledger filter, and total for matching expenses.
Categories continue to describe spending type; tags describe its context.
Transactions with multiple matching tags count once in a combined total.
Defer tag budgets and collaboration.

### Split transactions

Divide one payment across categories, such as groceries and household supplies.
Start with expense-only splits whose integer-satang amounts sum exactly to
the payment. Account balance changes once; category reports use split amounts.
Edits, exports, and offline retries must preserve that same total.
Defer splitting across accounts, pots, or multiple people.

Reference: [Actual Budget split transactions](https://actualbudget.org/docs/transactions/split-transactions/)
provides an established example of categorizing parts of one payment.

## Suggested order

1. Pending sync list: make existing offline saves visible and recoverable.
2. Purchase reflection: extend the existing planned-purchase workflow.
3. Savings pots: introduce reserved-money accounting with the checks above.
4. Tags or split transactions: choose based on actual logging friction.
5. Balance check: prioritize earlier if account balances regularly drift from reality.
