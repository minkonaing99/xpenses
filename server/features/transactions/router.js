'use strict'

const express = require('express')
const { z } = require('zod')
const { ok, ApiError } = require('../../lib/apiResponse')
const { rowToCamel } = require('../../lib/caseMap')
const { writeEntity } = require('../entityWrites/writer')
const { transactionCreateSchema } = require('../entityWrites/schemas')
const repo = require('./repo')

const TXN_TYPES = ['expense', 'income', 'transfer']

const listQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  type: z.enum(TXN_TYPES).optional(),
  accountId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
})
const bulkCreateSchema = z.object({
  transactions: z.array(transactionCreateSchema).min(1).max(20),
}).strict()
const CREATE_FIELDS = ['type', 'amount', 'note', 'categoryId', 'accountId', 'fromAccountId', 'toAccountId', 'txnDate']

function sameCreatedTransaction(current, candidate) {
  return CREATE_FIELDS.every((field) => (current[field] ?? null) === (candidate[field] ?? null))
}

function createTransactionsRouter(pool) {
  const router = express.Router()

  router.get('/', async (req, res, next) => {
    const parsed = listQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
      return
    }

    try {
      const { rows, nextCursor } = await repo.findAll(pool, parsed.data)
      res.json(ok(rows.map(rowToCamel), { nextCursor }))
    } catch (err) {
      next(err)
    }
  })

  router.get('/:id', async (req, res, next) => {
    try {
      const found = await repo.findById(pool, req.params.id)
      if (!found) {
        next(new ApiError('NOT_FOUND', 'transaction not found'))
        return
      }
      res.json(ok(rowToCamel(found)))
    } catch (err) {
      next(err)
    }
  })

  router.post('/', async (req, res, next) => {
    try {
      const result = await writeEntity(pool, {
        entity: 'transactions',
        action: 'create',
        payload: req.body,
      })
      const status = result.created ? 201 : 200
      res.status(status).json(ok(result.value, { syncStatus: result.status }))
    } catch (err) {
      next(err)
    }
  })

  router.post('/bulk', async (req, res, next) => {
    const parsed = bulkCreateSchema.safeParse(req.body)
    if (!parsed.success) return next(new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message))
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const results = []
      for (const payload of parsed.data.transactions) {
        const existing = await repo.findByIdAnyForUpdate(connection, payload.id)
        if (existing) {
          const current = rowToCamel(existing)
          if (existing.deleted_at || !sameCreatedTransaction(current, payload)) {
            throw new ApiError('CONFLICT', 'transaction id already used for different data')
          }
          results.push({ id: payload.id, status: 'applied', value: current, created: false })
        } else {
          results.push(await writeEntity(connection, { entity: 'transactions', action: 'create', payload }))
        }
      }
      await connection.commit()
      res.status(results.some((result) => result.created) ? 201 : 200).json(ok({ results }))
    } catch (err) {
      await connection.rollback()
      next(err)
    } finally {
      connection.release()
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const result = await writeEntity(pool, {
        entity: 'transactions',
        action: 'update',
        id: req.params.id,
        payload: req.body,
      })
      res.json(ok(result.value, { syncStatus: result.status }))
    } catch (err) {
      next(err)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const result = await writeEntity(pool, {
        entity: 'transactions',
        action: 'delete',
        id: req.params.id,
        payload: req.body,
      })
      res.json(ok({}, { syncStatus: result.status }))
    } catch (err) {
      next(err)
    }
  })

  return router
}

module.exports = { createTransactionsRouter }
