'use strict'

const FIELDS = {
  name: 'name', amount: 'amount', accountId: 'account_id', categoryId: 'category_id',
  plannedDate: 'planned_date', waitDays: 'wait_days', waitUntil: 'wait_until',
}

async function findAll(pool) {
  const [rows] = await pool.query("SELECT * FROM planned_purchases WHERE status = 'planned' ORDER BY wait_until, planned_date, created_at")
  return rows
}

async function findById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM planned_purchases WHERE id = ?', [id])
  return rows[0] || null
}

async function findByIdForUpdate(pool, id) {
  const [rows] = await pool.query('SELECT * FROM planned_purchases WHERE id = ? FOR UPDATE', [id])
  return rows[0] || null
}

async function create(pool, plan) {
  await pool.query(
    'INSERT INTO planned_purchases (id, name, amount, account_id, category_id, planned_date, wait_days, wait_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [plan.id, plan.name, plan.amount, plan.accountId, plan.categoryId, plan.plannedDate, plan.waitDays, plan.waitUntil],
  )
  return findById(pool, plan.id)
}

async function update(pool, id, patch) {
  const keys = Object.keys(patch).filter((key) => key in FIELDS)
  if (keys.length === 0) return findById(pool, id)
  const values = keys.map((key) => patch[key])
  await pool.query(`UPDATE planned_purchases SET ${keys.map((key) => `${FIELDS[key]} = ?`).join(', ')} WHERE id = ? AND status = 'planned'`, [...values, id])
  return findById(pool, id)
}

async function remove(pool, id) {
  await pool.query("DELETE FROM planned_purchases WHERE id = ? AND status = 'planned'", [id])
}

async function confirm(pool, id, transactionId) {
  await pool.query("UPDATE planned_purchases SET status = 'confirmed', confirmed_transaction_id = ? WHERE id = ? AND status = 'planned'", [transactionId, id])
  return findById(pool, id)
}

module.exports = { findAll, findById, findByIdForUpdate, create, update, remove, confirm }
