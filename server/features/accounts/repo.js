'use strict'

// Shared join block computing each account's expense/income/transfer sums —
// no WHERE clause on `a` here, since the two callers below need different
// filters (findAllWithSums excludes soft-deleted accounts; findAllForSync
// includes tombstones, see docs/TECH.md §6).
const SUMS_JOIN = `
  FROM accounts a
  LEFT JOIN (
    SELECT account_id, SUM(amount) AS total FROM transactions
    WHERE type = 'expense' AND deleted_at IS NULL GROUP BY account_id
  ) exp ON exp.account_id = a.id
  LEFT JOIN (
    SELECT account_id, SUM(amount) AS total FROM transactions
    WHERE type = 'income' AND deleted_at IS NULL GROUP BY account_id
  ) inc ON inc.account_id = a.id
  LEFT JOIN (
    SELECT from_account_id, SUM(amount) AS total FROM transactions
    WHERE type = 'transfer' AND deleted_at IS NULL GROUP BY from_account_id
  ) tout ON tout.from_account_id = a.id
  LEFT JOIN (
    SELECT to_account_id, SUM(amount) AS total FROM transactions
    WHERE type = 'transfer' AND deleted_at IS NULL GROUP BY to_account_id
  ) tin ON tin.to_account_id = a.id
`

const SUMS_SELECT = `
  SELECT
    a.*,
    COALESCE(exp.total, 0)  AS expense_out,
    COALESCE(inc.total, 0)  AS income_in,
    COALESCE(tout.total, 0) AS transfer_out,
    COALESCE(tin.total, 0)  AS transfer_in
  ${SUMS_JOIN}
  WHERE a.deleted_at IS NULL
`

const UPDATABLE_FIELDS = {
  name: 'name',
  type: 'type',
  startingBalance: 'starting_balance',
  sortOrder: 'sort_order',
}

async function findAllWithSums(pool) {
  const [rows] = await pool.query(`${SUMS_SELECT} ORDER BY a.sort_order, a.created_at`)
  return rows
}

async function findByIdWithSums(pool, id) {
  const [rows] = await pool.query(`${SUMS_SELECT} AND a.id = ?`, [id])
  return rows[0] || null
}

async function findById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] || null
}

async function create(pool, { id, name, type, startingBalance, sortOrder }) {
  await pool.query(
    `INSERT INTO accounts (id, name, type, starting_balance, sort_order) VALUES (?, ?, ?, ?, ?)`,
    [id, name, type ?? 'cash', startingBalance ?? 0, sortOrder ?? 0],
  )
}

async function update(pool, id, patch) {
  const columns = Object.keys(patch).filter((key) => key in UPDATABLE_FIELDS)
  if (columns.length === 0) return

  const setClause = columns.map((key) => `${UPDATABLE_FIELDS[key]} = ?`).join(', ')
  const values = columns.map((key) => patch[key])
  await pool.query(`UPDATE accounts SET ${setClause} WHERE id = ? AND deleted_at IS NULL`, [...values, id])
}

async function softDelete(pool, id) {
  await pool.query('UPDATE accounts SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id])
}

// Balances derive from transactions and have no independent updated_at.
// Return a full snapshot so sync cursors cannot leave them stale.
async function findAllForSync(pool) {
  const [rows] = await pool.query(
    `SELECT
      a.*,
      COALESCE(exp.total, 0)  AS expense_out,
      COALESCE(inc.total, 0)  AS income_in,
      COALESCE(tout.total, 0) AS transfer_out,
      COALESCE(tin.total, 0)  AS transfer_in
    ${SUMS_JOIN}`,
  )
  return rows
}

async function countReferences(pool, id) {
  const [[txnRows], [planRows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM transactions WHERE deleted_at IS NULL AND (account_id = ? OR from_account_id = ? OR to_account_id = ?)`, [id, id, id]),
    pool.query("SELECT COUNT(*) AS count FROM planned_purchases WHERE status = 'planned' AND account_id = ?", [id]),
  ])
  return txnRows[0].count + planRows[0].count
}

module.exports = {
  findAllWithSums,
  findByIdWithSums,
  findById,
  create,
  update,
  softDelete,
  countReferences,
  findAllForSync,
}
