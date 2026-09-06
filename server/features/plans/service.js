'use strict'

function addWaitDays(date, days) {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

function computeForecast({ accounts, budgets, plans, month }) {
  const accountPlans = new Map()
  const budgetPlans = new Map()
  for (const plan of plans) {
    accountPlans.set(plan.accountId, (accountPlans.get(plan.accountId) ?? 0) + plan.amount)
    if (plan.plannedDate.startsWith(month)) {
      budgetPlans.set(plan.categoryId, (budgetPlans.get(plan.categoryId) ?? 0) + plan.amount)
    }
  }
  return {
    accounts: accounts.map((account) => {
      const planned = accountPlans.get(account.id) ?? 0
      return { ...account, planned, forecastBalance: account.balance - planned }
    }),
    budgets: budgets.map((budget) => {
      const planned = budgetPlans.get(budget.categoryId) ?? 0
      const forecastSpent = budget.spent + planned
      return { ...budget, planned, forecastSpent, overForecast: forecastSpent > budget.limitAmount }
    }),
  }
}

module.exports = { addWaitDays, computeForecast }
