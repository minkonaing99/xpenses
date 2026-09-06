'use strict'

const express = require('express')
const { z } = require('zod')
const { ok, ApiError } = require('../../lib/apiResponse')
const accountsRepo = require('../accounts/repo')
const { mapAccountRow } = require('../accounts/service')
const { computeNet } = require('./service')
const { toCsv, toJson } = require('./csv')
const repo = require('./repo')

const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })
const rangeSchema = z.object({ from: z.string().date(), to: z.string().date() })
const exportSchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    format: z.enum(['csv', 'json']).default('csv'),
  })
  .refine((q) => q.month || (q.from && q.to), { message: 'month or from+to is required' })

function createReportsRouter(pool) {
  const router = express.Router()

  router.get('/category-spend', async (req, res, next) => {
    const parsed = monthQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
      return
    }

    try {
      const rows = await repo.categorySpend(pool, parsed.data.month)
      res.json(
        ok(
          rows.map((row) => ({
            categoryId: row.category_id,
            name: row.name,
            total: Number(row.total),
          })),
        ),
      )
    } catch (err) {
      next(err)
    }
  })

  router.get('/summary', async (req, res, next) => {
    const parsed = monthQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
      return
    }

    try {
      const [accountRows, totals] = await Promise.all([
        accountsRepo.findAllWithSums(pool),
        repo.monthlyTotals(pool, parsed.data.month),
      ])

      res.json(
        ok({
          accounts: accountRows.map(mapAccountRow),
          monthIncome: totals.income,
          monthExpense: totals.expense,
          monthNet: computeNet(totals.income, totals.expense),
        }),
      )
    } catch (err) {
      next(err)
    }
  })

  router.get('/daily-spend', async (req, res, next) => {
    const parsed = rangeSchema.safeParse(req.query)
    if (!parsed.success) {
      next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
      return
    }

    try {
      const rows = await repo.dailySpend(pool, parsed.data.from, parsed.data.to)
      res.json(ok(rows.map((row) => ({
        date: row.txn_date,
        total: Number(row.total),
        topCategoryName: row.top_category_name,
      }))))
    } catch (err) {
      next(err)
    }
  })

  router.get('/export', async (req, res, next) => {
    const parsed = exportSchema.safeParse(req.query)
    if (!parsed.success) {
      next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
      return
    }

    const { month, from, to, format } = parsed.data
    try {
      const rows = month
        ? await repo.monthTransactions(pool, month)
        : await repo.rangeTransactions(pool, from, to)
      const label = month ?? `${from}_${to}`
      const body = format === 'json' ? toJson(rows) : toCsv(rows)
      const contentType = format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8'
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Disposition', `attachment; filename="xpenses-${label}.${format}"`)
      res.send(body)
    } catch (err) {
      next(err)
    }
  })

  return router
}

module.exports = { createReportsRouter }
