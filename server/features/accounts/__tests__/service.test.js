'use strict'

const { computeBalance, mapAccountRow } = require('../service')

describe('computeBalance', () => {
  it('starts from startingBalance when there is no activity', () => {
    expect(computeBalance({ startingBalance: 10000, expenseOut: 0, incomeIn: 0, transferOut: 0, transferIn: 0 })).toBe(
      10000,
    )
  })

  it('subtracts expenses and adds income', () => {
    expect(
      computeBalance({ startingBalance: 0, expenseOut: 3000, incomeIn: 5000, transferOut: 0, transferIn: 0 }),
    ).toBe(2000)
  })

  it('subtracts transfers out and adds transfers in', () => {
    expect(
      computeBalance({ startingBalance: 1000, expenseOut: 0, incomeIn: 0, transferOut: 400, transferIn: 100 }),
    ).toBe(700)
  })

  it('combines all four activity types', () => {
    expect(
      computeBalance({ startingBalance: 10000, expenseOut: 2000, incomeIn: 5000, transferOut: 1000, transferIn: 500 }),
    ).toBe(12500)
  })
})

describe('mapAccountRow', () => {
  it('maps a raw DB row (with sum columns) to the API shape with a computed balance', () => {
    const row = {
      id: 'a1',
      name: 'Cash',
      type: 'cash',
      starting_balance: 10000,
      sort_order: 0,
      created_at: '2026-07-01 00:00:00',
      updated_at: '2026-07-01 00:00:00',
      expense_out: 2000,
      income_in: 5000,
      transfer_out: 1000,
      transfer_in: 500,
      pot_reserved: 3000,
    }
    expect(mapAccountRow(row)).toEqual({
      id: 'a1',
      name: 'Cash',
      type: 'cash',
      startingBalance: 10000,
      balance: 12500,
      reserved: 3000,
      available: 9500,
      sortOrder: 0,
      createdAt: '2026-07-01 00:00:00',
      updatedAt: '2026-07-01 00:00:00',
    })
  })

  it('coerces DECIMAL-string sum columns (as returned by mysql2 for SUM()) to numbers', () => {
    const row = {
      id: 'a1',
      name: 'Cash',
      type: 'cash',
      starting_balance: 10000,
      sort_order: 0,
      created_at: '2026-07-01 00:00:00',
      updated_at: '2026-07-01 00:00:00',
      expense_out: '2000',
      income_in: '5000',
      transfer_out: '1000',
      transfer_in: '500',
    }
    expect(mapAccountRow(row).balance).toBe(12500)
  })
})
