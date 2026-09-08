'use strict'

function summarizePot(pot) {
  const reserved = Number(pot.allocated) - Number(pot.released) - Number(pot.spent)
  const progress = pot.targetAmount > 0 ? Math.round((reserved / pot.targetAmount) * 100) : 0
  return { ...pot, reserved, progress }
}

function summarizeAccount(account) {
  const available = Number(account.balance) - Number(account.reserved)
  return { ...account, available, shortfall: Math.max(0, -available) }
}

module.exports = { summarizePot, summarizeAccount }
