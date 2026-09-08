'use strict'

const { randomUUID } = require('crypto')
const express = require('express')
const request = require('supertest')
const { getPool } = require('../../../db/pool')
const accountsRepo = require('../../accounts/repo')
const { createAccountsRouter } = require('../../accounts/router')
const categoriesRepo = require('../../categories/repo')
const { createTransactionsRouter } = require('../../transactions/router')
const { createSavingsPotsRouter } = require('../router')
const errorHandler = require('../../../middleware/error')

const pool = getPool()

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/savings-pots', createSavingsPotsRouter(pool))
  app.use('/api/accounts', createAccountsRouter(pool))
  app.use('/api/transactions', createTransactionsRouter(pool))
  app.use(errorHandler)
  return app
}

describe('savings pots router', () => {
  let app
  let accountId
  let categoryId
  let potId
  let transactionId

  beforeEach(async () => {
    app = buildApp()
    accountId = randomUUID()
    categoryId = randomUUID()
    potId = randomUUID()
    transactionId = randomUUID()
    await accountsRepo.create(pool, {
      id: accountId,
      name: `Pot account ${accountId}`,
      type: 'bank',
      startingBalance: 100000,
    })
    await categoriesRepo.create(pool, { id: categoryId, name: `Pot category ${categoryId}` })
  })

  afterEach(async () => {
    await pool.query('DELETE FROM savings_pot_purchases WHERE pot_id = ?', [potId])
    await pool.query('DELETE FROM transactions WHERE id = ?', [transactionId])
    await pool.query('DELETE FROM savings_pot_movements WHERE pot_id = ?', [potId])
    await pool.query('DELETE FROM savings_pots WHERE id = ?', [potId])
    await pool.query('DELETE FROM categories WHERE id = ?', [categoryId])
    await pool.query('DELETE FROM accounts WHERE id = ?', [accountId])
  })

  afterAll(async () => pool.end())

  it('creates a pot and lists its unchanged balance as available', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId,
      name: 'Emergency',
      targetAmount: 500000,
      accountId,
    }).expect(201)

    const response = await request(app).get('/api/savings-pots').expect(200)

    expect(response.body.data.active).toContainEqual(expect.objectContaining({
      id: potId,
      name: 'Emergency',
      reserved: 0,
      accountBalance: 100000,
      accountAvailable: 100000,
      shortfall: 0,
    }))
  })

  it('rejects an invalid pot id before a write', async () => {
    await request(app).post('/api/savings-pots/not-a-uuid/movements').send({
      id: randomUUID(), type: 'allocate', amount: 10000,
    }).expect(400)
  })

  it('allocates existing account money without changing its balance', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Trip', targetAmount: 100000, accountId,
    }).expect(201)

    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 40000,
    }).expect(201)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0]).toMatchObject({
      reserved: 40000,
      accountBalance: 100000,
      accountAvailable: 60000,
    })
    const accounts = await request(app).get('/api/accounts').expect(200)
    expect(accounts.body.data.find((account) => account.id === accountId)).toMatchObject({
      balance: 100000, reserved: 40000, available: 60000,
    })
  })

  it('releases only money currently reserved by the pot', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Trip', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 40000,
    }).expect(201)

    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'release', amount: 15000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'release', amount: 30000,
    }).expect(409)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0]).toMatchObject({ reserved: 25000, accountAvailable: 75000 })
  })

  it('replays a movement id once and rejects changed data', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Trip', targetAmount: 100000, accountId,
    }).expect(201)
    const movement = { id: randomUUID(), type: 'allocate', amount: 40000, note: 'First deposit' }

    await request(app).post(`/api/savings-pots/${potId}/movements`).send(movement).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send(movement).expect(200)
    await request(app).post(`/api/savings-pots/${potId}/movements`)
      .send({ ...movement, amount: 30000 }).expect(409)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0].reserved).toBe(40000)
  })

  it('spends reserved money as one linked expense', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)

    await request(app).post(`/api/savings-pots/${potId}/spend`).send({
      id: transactionId,
      amount: 30000,
      categoryId,
      note: 'Keyboard',
      txnDate: '2026-09-08',
      updatedAt: '2026-09-08T12:00:00.000Z',
    }).expect(201)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0]).toMatchObject({
      reserved: 50000,
      accountBalance: 70000,
      accountAvailable: 20000,
    })
    expect(response.body.data.active[0].history.map((item) => item.type)).toEqual([
      'purchase', 'allocate',
    ])
  })

  it('archives only a zero-reserve pot', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Old goal', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 10000,
    }).expect(201)

    await request(app).post(`/api/savings-pots/${potId}/archive`).send({}).expect(409)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'release', amount: 10000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/archive`).send({}).expect(200)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active).toHaveLength(0)
    expect(response.body.data.archived[0].id).toBe(potId)
  })

  it('rejects reserve-changing edits after a pot is archived', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Old goal', targetAmount: 30000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 30000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/spend`).send({
      id: transactionId, amount: 30000, categoryId, note: 'Bought',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/archive`).send({}).expect(200)

    await request(app).patch(`/api/transactions/${transactionId}`).send({
      amount: 20000, updatedAt: '2026-09-08T13:00:00.000Z',
    }).expect(409)
    await request(app).delete(`/api/transactions/${transactionId}`).send({
      updatedAt: '2026-09-08T13:00:00.000Z',
    }).expect(409)
  })

  it('edits a pot name and target without changing its reserve', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)

    await request(app).patch(`/api/savings-pots/${potId}`).send({
      name: 'Work laptop', targetAmount: 150000,
    }).expect(200)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0]).toMatchObject({
      name: 'Work laptop', targetAmount: 150000, reserved: 0,
    })
  })

  it('replays a pot-funded expense without duplicating it', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)
    const expense = {
      id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }

    await request(app).post(`/api/savings-pots/${potId}/spend`).send(expense).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/spend`).send(expense).expect(200)
    await request(app).post(`/api/savings-pots/${potId}/spend`)
      .send({ ...expense, amount: 20000 }).expect(409)

    const [rows] = await pool.query('SELECT id FROM transactions WHERE id = ?', [transactionId])
    expect(rows).toHaveLength(1)
  })

  it('accepts concurrent identical pot-funded expense retries once', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)
    const expense = {
      id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }

    const responses = await Promise.all([
      request(app).post(`/api/savings-pots/${potId}/spend`).send(expense),
      request(app).post(`/api/savings-pots/${potId}/spend`).send(expense),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
  })

  it('recalculates reserve when a linked expense amount changes', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/spend`).send({
      id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }).expect(201)

    await request(app).patch(`/api/transactions/${transactionId}`).send({
      amount: 40000, updatedAt: '2026-09-08T13:00:00.000Z',
    }).expect(200)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0].reserved).toBe(40000)
  })

  it('serializes release against a linked expense increase', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/spend`).send({
      id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }).expect(201)

    const responses = await Promise.all([
      request(app).post(`/api/savings-pots/${potId}/movements`).send({
        id: randomUUID(), type: 'release', amount: 50000,
      }),
      request(app).patch(`/api/transactions/${transactionId}`).send({
        amount: 60000, updatedAt: '2026-09-08T13:00:00.000Z',
      }),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    const listed = await request(app).get('/api/savings-pots').expect(200)
    expect(listed.body.data.active[0].reserved).toBeGreaterThanOrEqual(0)
  })

  it('restores reserve when a linked expense is deleted', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/spend`).send({
      id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }).expect(201)

    await request(app).delete(`/api/transactions/${transactionId}`).send({
      updatedAt: '2026-09-08T13:00:00.000Z',
    }).expect(200)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active[0].reserved).toBe(80000)
  })

  it('rejects moving a linked expense to another account', async () => {
    const otherAccountId = randomUUID()
    await accountsRepo.create(pool, {
      id: otherAccountId, name: `Other account ${otherAccountId}`, type: 'bank', startingBalance: 100000,
    })
    try {
      await request(app).post('/api/savings-pots').send({
        id: potId, name: 'Laptop', targetAmount: 100000, accountId,
      }).expect(201)
      await request(app).post(`/api/savings-pots/${potId}/movements`).send({
        id: randomUUID(), type: 'allocate', amount: 80000,
      }).expect(201)
      await request(app).post(`/api/savings-pots/${potId}/spend`).send({
        id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
        txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
      }).expect(201)

      await request(app).patch(`/api/transactions/${transactionId}`).send({
        accountId: otherAccountId, updatedAt: '2026-09-08T13:00:00.000Z',
      }).expect(409)
    } finally {
      await pool.query('UPDATE transactions SET account_id = ? WHERE id = ?', [accountId, transactionId])
      await pool.query('DELETE FROM accounts WHERE id = ?', [otherAccountId])
    }
  })

  it('keeps a replayed linked purchase as an expense', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Laptop', targetAmount: 100000, accountId,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/movements`).send({
      id: randomUUID(), type: 'allocate', amount: 80000,
    }).expect(201)
    await request(app).post(`/api/savings-pots/${potId}/spend`).send({
      id: transactionId, amount: 30000, categoryId, note: 'Keyboard',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T12:00:00.000Z',
    }).expect(201)

    await request(app).post('/api/transactions').send({
      id: transactionId, type: 'income', amount: 30000, accountId,
      categoryId: null, fromAccountId: null, toAccountId: null, note: 'Refund',
      txnDate: '2026-09-08', updatedAt: '2026-09-08T13:00:00.000Z',
    }).expect(409)
  })

  it('does not allocate the same available account money twice', async () => {
    const secondPotId = randomUUID()
    try {
      await request(app).post('/api/savings-pots').send({
        id: potId, name: 'Trip', targetAmount: 100000, accountId,
      }).expect(201)
      await request(app).post('/api/savings-pots').send({
        id: secondPotId, name: 'Emergency', targetAmount: 100000, accountId,
      }).expect(201)

      const responses = await Promise.all([
        request(app).post(`/api/savings-pots/${potId}/movements`).send({
          id: randomUUID(), type: 'allocate', amount: 60000,
        }),
        request(app).post(`/api/savings-pots/${secondPotId}/movements`).send({
          id: randomUUID(), type: 'allocate', amount: 60000,
        }),
      ])

      expect(responses.map((response) => response.status).sort()).toEqual([201, 409])
    } finally {
      await pool.query('DELETE FROM savings_pot_movements WHERE pot_id = ?', [secondPotId])
      await pool.query('DELETE FROM savings_pots WHERE id = ?', [secondPotId])
    }
  })

  it('keeps an account that is referenced by a pot', async () => {
    await request(app).post('/api/savings-pots').send({
      id: potId, name: 'Emergency', targetAmount: 100000, accountId,
    }).expect(201)

    const response = await request(app).delete(`/api/accounts/${accountId}`)

    expect(response.status).toBe(409)
  })

  it('replays the same pot id and rejects changed data', async () => {
    const body = { id: potId, name: 'Emergency', targetAmount: 100000, accountId }

    await request(app).post('/api/savings-pots').send(body).expect(201)
    await request(app).post('/api/savings-pots').send(body).expect(200)
    await request(app).post('/api/savings-pots').send({ ...body, name: 'Trip' }).expect(409)

    const response = await request(app).get('/api/savings-pots').expect(200)
    expect(response.body.data.active).toHaveLength(1)
  })
})
