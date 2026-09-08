'use strict'

const express = require('express')
const { z } = require('zod')
const { ApiError, ok } = require('../../lib/apiResponse')
const { rowToCamel } = require('../../lib/caseMap')
const { toMysqlDatetime } = require('../../lib/mysqlDate')
const accountsRepo = require('../accounts/repo')
const categoriesRepo = require('../categories/repo')
const { mapAccountRow } = require('../accounts/service')
const transactionsRepo = require('../transactions/repo')
const { summarizePot } = require('./service')
const repo = require('./repo')

const createSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  targetAmount: z.number().int().positive(),
  accountId: z.string().uuid(),
}).strict()
const movementSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['allocate', 'release']),
  amount: z.number().int().positive(),
  note: z.string().trim().max(255).optional(),
}).strict()
const spendSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().int().positive(),
  categoryId: z.string().uuid(),
  note: z.string().trim().max(255).nullable().optional(),
  txnDate: z.string().date(),
  updatedAt: z.string().datetime(),
}).strict()
const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetAmount: z.number().int().positive().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: 'at least one field is required' })

function present(row, account) {
  const pot = mapPot(row)
  const accountBalance = account?.balance ?? 0
  const accountAvailable = accountBalance - (account?.reserved ?? 0)
  return {
    ...pot,
    accountName: account?.name ?? 'Unavailable account',
    accountBalance,
    accountAvailable,
    shortfall: Math.max(0, -accountAvailable),
  }
}

function mapPot(row) {
  return summarizePot({
    ...rowToCamel(row),
    targetAmount: Number(row.target_amount),
    allocated: Number(row.allocated),
    released: Number(row.released),
    spent: Number(row.spent),
  })
}

function sameMovement(row, potId, movement) {
  return row.pot_id === potId && row.type === movement.type
    && Number(row.amount) === movement.amount && (row.note ?? undefined) === movement.note
}

function sameExpense(row, accountId, expense) {
  return row.type === 'expense' && row.deleted_at === null
    && Number(row.amount) === expense.amount && row.category_id === expense.categoryId
    && row.account_id === accountId && (row.note ?? null) === (expense.note ?? null)
    && row.txn_date === expense.txnDate
}

function samePot(row, pot) {
  return row.name === pot.name && Number(row.target_amount) === pot.targetAmount
    && row.account_id === pot.accountId
}

async function list(pool) {
  const [rows, accountRows, historyRows] = await Promise.all([
    repo.findAll(pool), accountsRepo.findAllWithSums(pool), repo.findHistory(pool),
  ])
  const pots = rows.map(mapPot)
  const reservedByAccount = new Map()
  pots.filter((pot) => !pot.archivedAt).forEach((pot) => {
    reservedByAccount.set(pot.accountId, (reservedByAccount.get(pot.accountId) ?? 0) + pot.reserved)
  })
  const accounts = new Map(accountRows.map((row) => {
    const account = mapAccountRow(row)
    return [account.id, { ...account, reserved: reservedByAccount.get(account.id) ?? 0 }]
  }))
  const history = new Map()
  historyRows.forEach((row) => {
    const items = history.get(row.pot_id) ?? []
    history.set(row.pot_id, [...items, rowToCamel(row)])
  })
  const presented = rows.map((row) => ({
    ...present(row, accounts.get(row.account_id)),
    history: history.get(row.id) ?? [],
  }))
  return {
    active: presented.filter((pot) => !pot.archivedAt),
    archived: presented.filter((pot) => pot.archivedAt),
  }
}

async function writeMovement(pool, potId, movement) {
  const existing = await repo.findMovementById(pool, movement.id)
  if (existing) {
    if (!sameMovement(existing, potId, movement)) throw new ApiError('CONFLICT', 'movement id already used')
    return { created: false, value: { ...movement, potId } }
  }
  const candidate = await repo.findById(pool, potId)
  if (!candidate || candidate.archived_at) throw new ApiError('NOT_FOUND', 'active savings pot not found')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await accountsRepo.findByIdForUpdate(connection, candidate.account_id)
    const locked = await repo.findByIdForUpdate(connection, potId)
    if (!locked || locked.archived_at || locked.account_id !== candidate.account_id) {
      throw new ApiError('CONFLICT', 'savings pot changed; try again')
    }
    const account = mapAccountRow(await accountsRepo.findByIdWithSums(connection, locked.account_id))
    const pots = (await repo.findAll(connection)).map(mapPot)
    const reserved = pots.filter((pot) => !pot.archivedAt && pot.accountId === locked.account_id)
      .reduce((total, pot) => total + pot.reserved, 0)
    const current = pots.find((pot) => pot.id === locked.id)
    if (movement.type === 'allocate' && movement.amount > account.balance - reserved) {
      throw new ApiError('CONFLICT', 'allocation exceeds available account money')
    }
    if (movement.type === 'release' && movement.amount > current.reserved) {
      throw new ApiError('CONFLICT', 'release exceeds pot reserve')
    }
    await repo.createMovement(connection, { ...movement, potId: locked.id })
    await connection.commit()
    return { created: true, value: { ...movement, potId: locked.id } }
  } catch (err) {
    await connection.rollback()
    if (err.code === 'ER_DUP_ENTRY') {
      const replay = await repo.findMovementById(pool, movement.id)
      if (replay && sameMovement(replay, potId, movement)) return { created: false, value: { ...movement, potId } }
      throw new ApiError('CONFLICT', 'movement id already used')
    }
    throw err
  } finally { connection.release() }
}

async function spendFromPot(pool, potId, expense) {
  const [existingLink, existingTxn] = await Promise.all([
    repo.findPurchaseByTransactionId(pool, expense.id),
    transactionsRepo.findByIdAny(pool, expense.id),
  ])
  if (existingLink || existingTxn) {
    if (existingLink?.pot_id === potId && existingTxn && sameExpense(existingTxn, existingTxn.account_id, expense)) {
      return { created: false, value: { ...expense, type: 'expense', accountId: existingTxn.account_id, potId } }
    }
    throw new ApiError('CONFLICT', 'transaction id already used')
  }
  const candidate = await repo.findById(pool, potId)
  if (!candidate || candidate.archived_at) throw new ApiError('NOT_FOUND', 'active savings pot not found')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await accountsRepo.findByIdForUpdate(connection, candidate.account_id)
    const pot = await repo.findByIdForUpdate(connection, potId)
    if (!pot || pot.archived_at || pot.account_id !== candidate.account_id) {
      throw new ApiError('CONFLICT', 'savings pot changed; try again')
    }
    const current = mapPot(await repo.findById(connection, potId))
    if (expense.amount > current.reserved) throw new ApiError('CONFLICT', 'expense exceeds pot reserve')
    if (!await categoriesRepo.findById(connection, expense.categoryId)) {
      throw new ApiError('VALIDATION_ERROR', 'category must exist')
    }
    const transaction = {
      ...expense,
      type: 'expense',
      accountId: pot.account_id,
      updatedAt: toMysqlDatetime(expense.updatedAt),
    }
    await transactionsRepo.create(connection, transaction)
    await repo.createPurchase(connection, pot.id, expense.id)
    await connection.commit()
    return { created: true, value: { ...expense, type: 'expense', accountId: pot.account_id, potId: pot.id } }
  } catch (err) {
    await connection.rollback()
    if (err.code === 'ER_DUP_ENTRY') {
      const [link, transaction] = await Promise.all([
        repo.findPurchaseByTransactionId(pool, expense.id),
        transactionsRepo.findByIdAny(pool, expense.id),
      ])
      if (link?.pot_id === potId && transaction && sameExpense(transaction, transaction.account_id, expense)) {
        return { created: false, value: { ...expense, type: 'expense', accountId: transaction.account_id, potId } }
      }
      throw new ApiError('CONFLICT', 'transaction id already used')
    }
    throw err
  } finally { connection.release() }
}

async function archivePot(pool, potId) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const locked = await repo.findByIdForUpdate(connection, potId)
    if (!locked) throw new ApiError('NOT_FOUND', 'savings pot not found')
    if (locked.archived_at) {
      await connection.commit()
      return
    }
    const current = mapPot(await repo.findById(connection, potId))
    if (current.reserved !== 0) throw new ApiError('CONFLICT', 'release all reserved money before archiving')
    await repo.archive(connection, potId)
    await connection.commit()
  } catch (err) {
    await connection.rollback()
    throw err
  } finally { connection.release() }
}

function createSavingsPotsRouter(pool) {
  const router = express.Router()

  router.param('id', (req, _res, next, id) => {
    const parsed = z.string().uuid().safeParse(id)
    next(parsed.success ? undefined : new ApiError('VALIDATION_ERROR', 'invalid savings pot id'))
  })

  router.get('/', async (_req, res, next) => {
    try { res.json(ok(await list(pool))) } catch (err) { next(err) }
  })

  router.post('/', async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    try {
      const existing = await repo.findById(pool, parsed.data.id)
      if (existing) {
        if (!samePot(existing, parsed.data)) throw new ApiError('CONFLICT', 'savings pot id already used')
        const data = await list(pool)
        const pot = [...data.active, ...data.archived].find((item) => item.id === parsed.data.id)
        return res.json(ok(pot))
      }
      const account = await accountsRepo.findById(pool, parsed.data.accountId)
      if (!account) throw new ApiError('VALIDATION_ERROR', 'account must exist')
      await repo.create(pool, parsed.data)
      const data = await list(pool)
      res.status(201).json(ok(data.active.find((pot) => pot.id === parsed.data.id)))
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return next(new ApiError('CONFLICT', 'savings pot already exists'))
      next(err)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    try {
      const current = await repo.findById(pool, req.params.id)
      if (!current || current.archived_at) throw new ApiError('NOT_FOUND', 'active savings pot not found')
      res.json(ok(mapPot(await repo.update(pool, req.params.id, parsed.data))))
    } catch (err) { next(err) }
  })

  router.post('/:id/movements', async (req, res, next) => {
    const parsed = movementSchema.safeParse(req.body)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    try {
      const result = await writeMovement(pool, req.params.id, parsed.data)
      res.status(result.created ? 201 : 200).json(ok(result.value))
    } catch (err) { next(err) }
  })

  router.post('/:id/spend', async (req, res, next) => {
    const parsed = spendSchema.safeParse(req.body)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    try {
      const result = await spendFromPot(pool, req.params.id, parsed.data)
      res.status(result.created ? 201 : 200).json(ok(result.value))
    } catch (err) { next(err) }
  })

  router.post('/:id/archive', async (req, res, next) => {
    try {
      await archivePot(pool, req.params.id)
      res.json(ok({}))
    } catch (err) { next(err) }
  })

  return router
}

module.exports = { createSavingsPotsRouter }
