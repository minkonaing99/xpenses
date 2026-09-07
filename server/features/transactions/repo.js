'use strict'

const { encodeCursor, decodeCursor, shouldApply } = require('./service')
const { monthRange } = require('../../lib/dateRange')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const UPDATABLE_FIELDS = {
  type: 'type',
  amount: 'amount',
  note: 'note',
  categoryId: 'category_id',
  accountId: 'account_id',
  fromAccountId: 'from_account_id',
  toAccountId: 'to_account_id',
  txnDate: 'txn_date',
  updatedAt: 'updated_at',
}

async function findById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] || null
}

// Includes soft-deleted rows — needed to LWW-compare against tombstones
// (see docs/SCHEMA.md "Soft Delete Strategy": deletes go through the same
// last-write-wins path as edits).
async function findByIdAny(pool, id) {
  const [rows] = await pool.query('SELECT * FROM transactions WHERE id = ?', [id])
  return rows[0] || null
}

async function findByIdAnyForUpdate(connection, id) {
  const [rows] = await connection.query('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [id])
  return rows[0] || null
}

async function findAll(pool, { month, type, accountId, categoryId, limit, cursor } = {}) {
  const conditions = ['deleted_at IS NULL']
  const params = []

  if (month) {
    const { start, end } = monthRange(month)
    conditions.push('txn_date >= ? AND txn_date < ?')
    params.push(start, end)
  }
  if (type) {
    conditions.push('type = ?')
    params.push(type)
  }
  if (accountId) {
    conditions.push('(account_id = ? OR from_account_id = ? OR to_account_id = ?)')
    params.push(accountId, accountId, accountId)
  }
  if (categoryId) {
    conditions.push('category_id = ?')
    params.push(categoryId)
  }

  const decodedCursor = decodeCursor(cursor)
  if (decodedCursor) {
    conditions.push('(txn_date, created_at, id) < (?, ?, ?)')
    params.push(decodedCursor.txnDate, decodedCursor.createdAt, decodedCursor.id)
  }

  const pageSize = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT)

  const [rows] = await pool.query(
    `SELECT * FROM transactions WHERE ${conditions.join(' AND ')}
     ORDER BY txn_date DESC, created_at DESC, id DESC
     LIMIT ?`,
    [...params, pageSize + 1],
  )

  const hasMore = rows.length > pageSize
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows
  const last = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && last ? encodeCursor({ txnDate: last.txn_date, createdAt: last.created_at, id: last.id }) : null

  return { rows: pageRows, nextCursor }
}

async function create(pool, txn) {
  await pool.query(
    `INSERT INTO transactions
       (id, type, amount, note, category_id, account_id, from_account_id, to_account_id, txn_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      txn.id,
      txn.type,
      txn.amount,
      txn.note ?? null,
      txn.categoryId ?? null,
      txn.accountId ?? null,
      txn.fromAccountId ?? null,
      txn.toAccountId ?? null,
      txn.txnDate,
      txn.updatedAt,
    ],
  )
}

async function update(pool, id, patch) {
  const columns = Object.keys(patch).filter((key) => key in UPDATABLE_FIELDS)
  if (columns.length === 0) return

  const setClause = columns.map((key) => `${UPDATABLE_FIELDS[key]} = ?`).join(', ')
  const values = columns.map((key) => patch[key])
  await pool.query(`UPDATE transactions SET ${setClause} WHERE id = ? AND deleted_at IS NULL`, [...values, id])
}

async function softDelete(pool, id, updatedAt) {
  await pool.query('UPDATE transactions SET deleted_at = NOW(), updated_at = ? WHERE id = ? AND deleted_at IS NULL', [
    updatedAt,
    id,
  ])
}

async function replaceAllFields(pool, id, txn) {
  await pool.query(
    `UPDATE transactions SET
       type = ?, amount = ?, note = ?, category_id = ?, account_id = ?,
       from_account_id = ?, to_account_id = ?, txn_date = ?, updated_at = ?
     WHERE id = ?`,
    [
      txn.type,
      txn.amount,
      txn.note ?? null,
      txn.categoryId ?? null,
      txn.accountId ?? null,
      txn.fromAccountId ?? null,
      txn.toAccountId ?? null,
      txn.txnDate,
      txn.updatedAt,
      id,
    ],
  )
}

// LWW-guarded writes — see docs/TECH.md §7. Each returns
// { status: 'applied'|'skipped'|'not_found', row } so callers (routes,
// /api/sync/push) can report per-op results without re-deriving the guard.

async function upsert(pool, txn) {
  const existing = await findByIdAny(pool, txn.id)
  if (!shouldApply(txn.updatedAt, existing ? existing.updated_at : null)) {
    return { status: 'skipped', created: false, row: existing }
  }
  if (existing) {
    await replaceAllFields(pool, txn.id, txn)
  } else {
    await create(pool, txn)
  }
  return { status: 'applied', created: !existing, row: await findByIdAny(pool, txn.id) }
}

async function updateGuarded(pool, id, patch) {
  const existing = await findByIdAny(pool, id)
  if (!existing || existing.deleted_at) return { status: 'not_found', row: null }
  if (!shouldApply(patch.updatedAt, existing.updated_at)) {
    return { status: 'skipped', row: existing }
  }
  await update(pool, id, patch)
  return { status: 'applied', row: await findByIdAny(pool, id) }
}

async function softDeleteGuarded(pool, id, updatedAt) {
  const existing = await findByIdAny(pool, id)
  if (!existing || existing.deleted_at) return { status: 'not_found', row: null }
  if (!shouldApply(updatedAt, existing.updated_at)) {
    return { status: 'skipped', row: existing }
  }
  await softDelete(pool, id, updatedAt)
  return { status: 'applied', row: await findByIdAny(pool, id) }
}

// Includes soft-deleted rows (tombstones) — see docs/TECH.md §6 pull sync.
async function findChangedSince(pool, since) {
  const [rows] = await pool.query('SELECT * FROM transactions WHERE updated_at > ?', [since])
  return rows
}

module.exports = {
  findById,
  findByIdAny,
  findByIdAnyForUpdate,
  findAll,
  create,
  update,
  softDelete,
  upsert,
  updateGuarded,
  softDeleteGuarded,
  findChangedSince,
}
