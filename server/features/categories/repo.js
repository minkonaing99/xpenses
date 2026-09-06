'use strict'

const UPDATABLE_FIELDS = {
  name: 'name',
  icon: 'icon',
  sortOrder: 'sort_order',
}

async function findAll(pool) {
  const [rows] = await pool.query(
    'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY sort_order, created_at',
  )
  return rows
}

async function findById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] || null
}

async function findByIdAny(pool, id) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id])
  return rows[0] || null
}

// Uniqueness among non-deleted categories is enforced here, not by a DB
// constraint — MySQL has no partial unique index (see migration 003).
// Accepted TOCTOU: this check-then-create is not transactional (same
// tradeoff as budgets' findActiveByCategoryId) — acceptable for a
// solo-user, single-session app.
async function findActiveByName(pool, name, excludeId) {
  const [rows] = await pool.query(
    'SELECT id FROM categories WHERE name = ? AND deleted_at IS NULL AND id != ?',
    [name, excludeId ?? ''],
  )
  return rows[0] || null
}

async function create(pool, { id, name, icon, sortOrder }) {
  await pool.query('INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)', [
    id,
    name,
    icon ?? null,
    sortOrder ?? 0,
  ])
}

async function update(pool, id, patch) {
  const columns = Object.keys(patch).filter((key) => key in UPDATABLE_FIELDS)
  if (columns.length === 0) return

  const setClause = columns.map((key) => `${UPDATABLE_FIELDS[key]} = ?`).join(', ')
  const values = columns.map((key) => patch[key])
  await pool.query(`UPDATE categories SET ${setClause} WHERE id = ? AND deleted_at IS NULL`, [...values, id])
}

async function softDelete(pool, id) {
  await pool.query('UPDATE categories SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL', [id])
}

async function countReferences(pool, id) {
  const [[txnRows], [budgetRows], [planRows]] = await Promise.all([
    pool.query('SELECT COUNT(*) AS count FROM transactions WHERE deleted_at IS NULL AND category_id = ?', [id]),
    pool.query('SELECT COUNT(*) AS count FROM budgets WHERE deleted_at IS NULL AND category_id = ?', [id]),
    pool.query("SELECT COUNT(*) AS count FROM planned_purchases WHERE status = 'planned' AND category_id = ?", [id]),
  ])
  return txnRows[0].count + budgetRows[0].count + planRows[0].count
}

// Includes soft-deleted rows (tombstones) — see docs/TECH.md §6 pull sync.
async function findChangedSince(pool, since) {
  const [rows] = await pool.query('SELECT * FROM categories WHERE updated_at > ?', [since])
  return rows
}

module.exports = {
  findAll,
  findById,
  findByIdAny,
  findActiveByName,
  create,
  update,
  softDelete,
  countReferences,
  findChangedSince,
}
