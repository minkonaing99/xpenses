'use strict'

const { randomUUID } = require('crypto')
const express = require('express')
const request = require('supertest')
const { getPool } = require('../../../db/pool')
const { todayInBangkok } = require('../../../cron/dateUtil')
const accountsRepo = require('../../accounts/repo')
const categoriesRepo = require('../../categories/repo')
const { createPlansRouter } = require('../router')
const errorHandler = require('../../../middleware/error')

const pool = getPool()

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/plans', createPlansRouter(pool))
  app.use(errorHandler)
  return app
}

afterAll(async () => {
  await pool.end()
})

describe('plans router purchase reflections', () => {
  let app
  let accountId
  let categoryId
  let planId

  beforeEach(async () => {
    app = buildApp()
    accountId = randomUUID()
    categoryId = randomUUID()
    planId = randomUUID()
    await accountsRepo.create(pool, { id: accountId, name: `Plan Account ${accountId}`, type: 'cash' })
    await categoriesRepo.create(pool, { id: categoryId, name: `Plan Category ${categoryId}` })
  })

  async function createConfirmedPlan() {
    const today = todayInBangkok()
    await createPlan(today)
    await request(app).post(`/api/plans/${planId}/confirm`).expect(200)
    return today
  }

  async function createPlan(plannedDate = todayInBangkok()) {
    await request(app).post('/api/plans').send({
      id: planId,
      name: 'Headphones',
      amount: 3000,
      accountId,
      categoryId,
      plannedDate,
      waitDays: 0,
    }).expect(201)
  }

  afterEach(async () => {
    const [rows] = await pool.query('SELECT confirmed_transaction_id FROM planned_purchases WHERE id = ?', [planId])
    await pool.query('DELETE FROM planned_purchases WHERE id = ?', [planId])
    if (rows[0]?.confirmed_transaction_id) {
      await pool.query('DELETE FROM transactions WHERE id = ?', [rows[0].confirmed_transaction_id])
    }
    await pool.query('DELETE FROM categories WHERE id = ?', [categoryId])
    await pool.query('DELETE FROM accounts WHERE id = ?', [accountId])
  })

  it('saves reflection on confirmed purchase and returns it in purchase history', async () => {
    const today = await createConfirmedPlan()

    const reflected = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'worth_it', reflectionNote: 'Used every day' })

    expect(reflected.status).toBe(200)
    expect(reflected.body.data).toMatchObject({
      id: planId,
      reflection: 'worth_it',
      reflectionNote: 'Used every day',
    })

    const history = await request(app).get('/api/plans').query({ month: today.slice(0, 7) })
    expect(history.status).toBe(200)
    expect(history.body.data.confirmedPurchases).toContainEqual(expect.objectContaining({
      id: planId,
      name: 'Headphones',
      purchaseDate: today,
      reflection: 'worth_it',
    }))
  })

  it('rejects an unknown reflection rating', async () => {
    await createConfirmedPlan()

    const response = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'maybe' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rejects reflection notes longer than 255 characters', async () => {
    await createConfirmedPlan()

    const response = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'regret', reflectionNote: 'x'.repeat(256) })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('accepts not_sure without a note', async () => {
    await createConfirmedPlan()

    const response = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'not_sure' })

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ reflection: 'not_sure', reflectionNote: null })
  })

  it('does not accept reflections for unconfirmed plans', async () => {
    await createPlan()

    const response = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'worth_it' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('keeps accepting planned updates that contain an extra field', async () => {
    await createPlan()

    const response = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ name: 'Better headphones', extra: true })

    expect(response.status).toBe(200)
    expect(response.body.data.name).toBe('Better headphones')
  })

  it('updates the same reflection when an opinion changes', async () => {
    const today = await createConfirmedPlan()
    await request(app).patch(`/api/plans/${planId}`).send({ reflection: 'worth_it' }).expect(200)
    await request(app).patch(`/api/plans/${planId}`).send({ reflection: 'regret' }).expect(200)

    const history = await request(app).get('/api/plans').query({ month: today.slice(0, 7) })
    const matches = history.body.data.confirmedPurchases.filter((purchase) => purchase.id === planId)

    expect(matches).toHaveLength(1)
    expect(matches[0].reflection).toBe('regret')
  })

  it('keeps the existing note when a rating-only update omits it', async () => {
    await createConfirmedPlan()
    await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'worth_it', reflectionNote: 'Still useful' })
      .expect(200)

    const response = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ reflection: 'not_sure' })

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ reflection: 'not_sure', reflectionNote: 'Still useful' })
  })
})
