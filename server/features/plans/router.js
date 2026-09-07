'use strict'

const { randomUUID } = require('crypto')
const express = require('express')
const { z } = require('zod')
const { ok, ApiError } = require('../../lib/apiResponse')
const { rowToCamel } = require('../../lib/caseMap')
const { toMysqlDatetime } = require('../../lib/mysqlDate')
const { todayInBangkok } = require('../../cron/dateUtil')
const accountsRepo = require('../accounts/repo')
const { mapAccountRow } = require('../accounts/service')
const budgetsRepo = require('../budgets/repo')
const categoriesRepo = require('../categories/repo')
const transactionsRepo = require('../transactions/repo')
const { computeForecast, addWaitDays } = require('./service')
const repo = require('./repo')

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })
const planFields = {
  name: z.string().trim().min(1).max(255), amount: z.number().int().positive(),
  accountId: z.string().uuid(), categoryId: z.string().uuid(), plannedDate: z.string().date(),
  waitDays: z.number().int().min(0).max(30),
}
const planSchema = z.object({ id: z.string().uuid(), ...planFields, waitDays: planFields.waitDays.default(7) })
const patchSchema = z.object(planFields).partial().refine((value) => Object.keys(value).length > 0)
const reflectionSchema = z.object({
  reflection: z.enum(['worth_it', 'regret', 'not_sure']),
  reflectionNote: z.string().trim().max(255).nullable().optional(),
}).strict()

function mapPlan(row) { return rowToCamel(row) }
function maxDate(a, b) { return a > b ? a : b }

async function assertRefs(pool, plan) {
  const [account, category] = await Promise.all([accountsRepo.findById(pool, plan.accountId), categoriesRepo.findById(pool, plan.categoryId)])
  if (!account || !category) throw new ApiError('VALIDATION_ERROR', 'account and category must exist')
}

function normalizePlan(plan, today, resetWait) {
  const waitUntil = resetWait ? addWaitDays(today, plan.waitDays) : plan.waitUntil
  return { ...plan, waitUntil, plannedDate: maxDate(plan.plannedDate, waitUntil) }
}

function sameCreatedPlan(current, candidate) {
  return ['name', 'amount', 'accountId', 'categoryId', 'plannedDate', 'waitDays']
    .every((field) => current[field] === candidate[field])
}

function createPlansRouter(pool) {
  const router = express.Router()
  router.get('/', async (req, res, next) => {
    const parsed = monthSchema.safeParse(req.query)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    try {
      const [rows, confirmedRows, accounts, budgets] = await Promise.all([repo.findAll(pool), repo.findConfirmed(pool), accountsRepo.findAllWithSums(pool), budgetsRepo.findAllWithSpent(pool, parsed.data.month)])
      const plans = rows.map(mapPlan)
      res.json(ok({ plans, confirmedPurchases: confirmedRows.map(mapPlan), ...computeForecast({ accounts: accounts.map(mapAccountRow), budgets: budgets.map(rowToCamel), plans, month: parsed.data.month }) }))
    } catch (err) { next(err) }
  })
  router.post('/', async (req, res, next) => {
    const parsed = planSchema.safeParse(req.body)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    try {
      const plan = normalizePlan(parsed.data, todayInBangkok(), true)
      const existing = await repo.findById(pool, plan.id)
      if (existing) {
        const current = mapPlan(existing)
        if (!sameCreatedPlan(current, plan)) throw new ApiError('CONFLICT', 'plan id already used for different data')
        return res.json(ok(current))
      }
      await assertRefs(pool, plan)
      res.status(201).json(ok(mapPlan(await repo.create(pool, plan))))
    } catch (err) { next(err) }
  })
  router.patch('/:id', async (req, res, next) => {
    try {
      const current = await repo.findById(pool, req.params.id)
      if (!current) throw new ApiError('NOT_FOUND', 'purchase not found')
      if (current.status === 'confirmed') {
        const parsed = reflectionSchema.safeParse(req.body)
        if (!parsed.success) throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message)
        const note = parsed.data.reflectionNote === undefined
          ? current.reflection_note
          : parsed.data.reflectionNote?.trim() || null
        return res.json(ok(mapPlan(await repo.updateReflection(pool, req.params.id, parsed.data.reflection, note))))
      }
      if (current.status !== 'planned') throw new ApiError('NOT_FOUND', 'planned purchase not found')
      const parsed = patchSchema.safeParse(req.body)
      if (!parsed.success) throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message)
      const candidate = { ...mapPlan(current), ...parsed.data }
      await assertRefs(pool, candidate)
      const plan = normalizePlan(candidate, todayInBangkok(), parsed.data.amount !== undefined && parsed.data.amount > current.amount)
      res.json(ok(mapPlan(await repo.update(pool, req.params.id, plan))))
    } catch (err) { next(err) }
  })
  router.delete('/:id', async (req, res, next) => {
    try { await repo.remove(pool, req.params.id); res.json(ok({})) } catch (err) { next(err) }
  })
  router.post('/:id/confirm', async (req, res, next) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const plan = await repo.findByIdForUpdate(connection, req.params.id)
      const today = todayInBangkok()
      if (!plan || plan.status !== 'planned') throw new ApiError('CONFLICT', 'planned purchase already confirmed or deleted')
      if (today < plan.wait_until) throw new ApiError('CONFLICT', 'waiting period has not ended')
      const transactionId = randomUUID()
      await transactionsRepo.create(connection, { id: transactionId, type: 'expense', amount: plan.amount, note: plan.name, categoryId: plan.category_id, accountId: plan.account_id, txnDate: today, updatedAt: toMysqlDatetime(new Date().toISOString()) })
      const confirmed = await repo.confirm(connection, plan.id, transactionId)
      await connection.commit()
      res.json(ok(mapPlan(confirmed)))
    } catch (err) { await connection.rollback(); next(err) } finally { connection.release() }
  })
  return router
}

module.exports = { createPlansRouter }
