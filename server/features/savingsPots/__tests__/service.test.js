'use strict'

const { summarizePot, summarizeAccount } = require('../service')

describe('savings pots service', () => {
  it('derives reserve and available money without changing account balance', () => {
    const pot = summarizePot({
      id: 'p1',
      targetAmount: 100000,
      allocated: 60000,
      released: 10000,
      spent: 20000,
    })
    const account = summarizeAccount({ balance: 120000, reserved: pot.reserved })

    expect(pot).toMatchObject({ reserved: 30000, progress: 30 })
    expect(account).toEqual({ balance: 120000, reserved: 30000, available: 90000, shortfall: 0 })
  })
})
