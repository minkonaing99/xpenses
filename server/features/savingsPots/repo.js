'use strict'

const POT_TOTALS = `
  SELECT p.*,
    COALESCE(m.allocated, 0) AS allocated,
    COALESCE(m.released, 0) AS released,
    COALESCE(s.spent, 0) AS spent
  FROM savings_pots p
  LEFT JOIN (
    SELECT pot_id,
      SUM(CASE WHEN type = 'allocate' THEN amount ELSE 0 END) AS allocated,
      SUM(CASE WHEN type = 'release' THEN amount ELSE 0 END) AS released
    FROM savings_pot_movements GROUP BY pot_id
  ) m ON m.pot_id = p.id
  LEFT JOIN (
    SELECT pp.pot_id, SUM(t.amount) AS spent
    FROM savings_pot_purchases pp
    JOIN transactions t ON t.id = pp.transaction_id
      AND t.type = 'expense' AND t.deleted_at IS NULL
    GROUP BY pp.pot_id
  ) s ON s.pot_id = p.id
`

async function findAll(pool) {
  const [rows] = await pool.query(`${POT_TOTALS} ORDER BY p.archived_at IS NOT NULL, p.created_at`)
  return rows
}

async function findById(pool, id) {
  const [rows] = await pool.query(`${POT_TOTALS} WHERE p.id = ?`, [id])
  return rows[0] || null
}

async function findByIdForUpdate(connection, id) {
  const [rows] = await connection.query('SELECT * FROM savings_pots WHERE id = ? FOR UPDATE', [id])
  return rows[0] || null
}

async function create(pool, pot) {
  await pool.query(
    'INSERT INTO savings_pots (id, name, target_amount, account_id) VALUES (?, ?, ?, ?)',
    [pot.id, pot.name, pot.targetAmount, pot.accountId],
  )
  return findById(pool, pot.id)
}

async function createMovement(connection, movement) {
  await connection.query(
    'INSERT INTO savings_pot_movements (id, pot_id, type, amount, note) VALUES (?, ?, ?, ?, ?)',
    [movement.id, movement.potId, movement.type, movement.amount, movement.note ?? null],
  )
}

async function findMovementById(pool, id) {
  const [rows] = await pool.query('SELECT * FROM savings_pot_movements WHERE id = ?', [id])
  return rows[0] || null
}

async function createPurchase(connection, potId, transactionId) {
  await connection.query(
    'INSERT INTO savings_pot_purchases (transaction_id, pot_id) VALUES (?, ?)',
    [transactionId, potId],
  )
}

async function findPurchaseByTransactionId(pool, transactionId) {
  const [rows] = await pool.query(
    'SELECT * FROM savings_pot_purchases WHERE transaction_id = ?',
    [transactionId],
  )
  return rows[0] || null
}

async function findHistory(pool) {
  const [rows] = await pool.query(`
    SELECT m.id, m.pot_id, m.type, m.amount, m.note, NULL AS txn_date,
      NULL AS deleted_at, m.created_at, 0 AS kind_order
    FROM savings_pot_movements m
    UNION ALL
    SELECT t.id, pp.pot_id, 'purchase' AS type, t.amount, t.note, t.txn_date,
      t.deleted_at, pp.created_at, 1 AS kind_order
    FROM savings_pot_purchases pp
    JOIN transactions t ON t.id = pp.transaction_id
    ORDER BY created_at DESC, kind_order DESC
  `)
  return rows
}

async function archive(connection, id) {
  await connection.query(
    'UPDATE savings_pots SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id],
  )
}

async function update(pool, id, patch) {
  const fields = { name: 'name', targetAmount: 'target_amount' }
  const keys = Object.keys(patch).filter((key) => fields[key])
  const set = keys.map((key) => `${fields[key]} = ?`).join(', ')
  await pool.query(
    `UPDATE savings_pots SET ${set}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL`,
    [...keys.map((key) => patch[key]), id],
  )
  return findById(pool, id)
}

module.exports = {
  findAll,
  findById,
  findByIdForUpdate,
  create,
  createMovement,
  findMovementById,
  createPurchase,
  findPurchaseByTransactionId,
  findHistory,
  archive,
  update,
}
