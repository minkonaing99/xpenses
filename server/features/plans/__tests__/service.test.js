'use strict'

const { addWaitDays, computeForecast } = require('../service')

describe('plans service', () => {
  it('sets readiness after calendar wait days', () => {
    expect(addWaitDays('2026-09-06', 7)).toBe('2026-09-13')
  })

  it('keeps all plans in account forecasts but only month plans in budget forecasts', () => {
    const result = computeForecast({
      accounts: [{ id: 'a1', balance: 10000 }],
      budgets: [{ id: 'b1', categoryId: 'c1', spent: 2000, limitAmount: 5000 }],
      plans: [
        { accountId: 'a1', categoryId: 'c1', amount: 3000, plannedDate: '2026-09-10' },
        { accountId: 'a1', categoryId: 'c1', amount: 4000, plannedDate: '2026-10-10' },
      ],
      month: '2026-09',
    })

    expect(result.accounts).toEqual([{ id: 'a1', balance: 10000, planned: 7000, forecastBalance: 3000 }])
    expect(result.budgets).toEqual([
      { id: 'b1', categoryId: 'c1', spent: 2000, limitAmount: 5000, planned: 3000, forecastSpent: 5000, overForecast: false },
    ])
  })
})
