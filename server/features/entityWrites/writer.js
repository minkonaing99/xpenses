'use strict'

const { ApiError } = require('../../lib/apiResponse')
const { rowToCamel } = require('../../lib/caseMap')
const { toMysqlDatetime } = require('../../lib/mysqlDate')
const accountsRepo = require('../accounts/repo')
const { mapAccountRow } = require('../accounts/service')
const budgetsRepo = require('../budgets/repo')
const { currentMonth, mapBudgetRow } = require('../budgets/service')
const categoriesRepo = require('../categories/repo')
const recurringRepo = require('../recurring/repo')
const savingsPotsRepo = require('../savingsPots/repo')
const { normalizeResumePatch } = require('../recurring/scheduler')
const transactionsRepo = require('../transactions/repo')
const { shouldApply, validateTransactionFields } = require('../transactions/service')
const { todayInBangkok } = require('../../cron/dateUtil')
const {
  accountCreateSchema,
  accountUpdateSchema,
  budgetCreateSchema,
  budgetUpdateSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  entityIdSchema,
  recurringCreateSchema,
  recurringUpdateSchema,
  transactionCreateSchema,
  transactionUpdateSchema,
  transactionDeleteSchema,
} = require('./schemas')

function parse(schema, payload) {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0].message)
  }
  return parsed.data
}

function outcome(id, value = null, details = {}) {
  return { id, status: 'applied', value, ...details }
}

function validateTransactionShape(value) {
  const fieldError = validateTransactionFields(value)
  if (fieldError) throw new ApiError('VALIDATION_ERROR', fieldError)
}

function mapRecurring(row) {
  return { ...rowToCamel(row), active: Boolean(row.active) }
}

async function createAccount(pool, payload, replay) {
  const account = parse(accountCreateSchema, payload)
  if (replay) {
    const existing = await accountsRepo.findById(pool, account.id)
    if (existing) {
      const current = await accountsRepo.findByIdWithSums(pool, account.id)
      return outcome(account.id, mapAccountRow(current), { created: false })
    }
  }

  try {
    await accountsRepo.create(pool, account)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      if (replay) return outcome(account.id, null, { created: false })
      throw new ApiError('CONFLICT', 'account already exists')
    }
    throw err
  }

  const created = await accountsRepo.findByIdWithSums(pool, account.id)
  return outcome(account.id, mapAccountRow(created), { created: true })
}

async function updateAccount(pool, id, payload) {
  const patch = parse(accountUpdateSchema, payload)
  const existing = await accountsRepo.findById(pool, id)
  if (!existing) throw new ApiError('NOT_FOUND', 'account not found')

  await accountsRepo.update(pool, id, patch)
  const updated = await accountsRepo.findByIdWithSums(pool, id)
  return outcome(id, mapAccountRow(updated))
}

async function deleteAccount(pool, id, replay) {
  const existing = await accountsRepo.findById(pool, id)
  if (!existing) {
    if (replay) return outcome(id)
    throw new ApiError('NOT_FOUND', 'account not found')
  }

  const referenceCount = await accountsRepo.countReferences(pool, id)
  if (referenceCount > 0) {
    throw new ApiError('CONFLICT', 'account is referenced by existing transactions')
  }

  await accountsRepo.softDelete(pool, id)
  return outcome(id)
}

async function writeAccount(pool, { action, id, payload, replay }) {
  if (action === 'create') return createAccount(pool, payload, replay)
  if (action === 'update') return updateAccount(pool, id, payload)
  if (action === 'delete') return deleteAccount(pool, id, replay)
  throw new ApiError('VALIDATION_ERROR', 'unknown write action')
}

async function createBudget(pool, payload, replay) {
  const budget = parse(budgetCreateSchema, payload)
  if (replay) {
    const existing = await budgetsRepo.findByIdAny(pool, budget.id)
    if (existing) return outcome(budget.id, rowToCamel(existing), { created: false })
  }

  const conflict = await budgetsRepo.findActiveByCategoryId(pool, budget.categoryId)
  if (conflict) throw new ApiError('CONFLICT', 'a budget already exists for this category')

  try {
    await budgetsRepo.create(pool, budget)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      if (replay) return outcome(budget.id, null, { created: false })
      throw new ApiError('CONFLICT', 'budget already exists')
    }
    throw err
  }

  const created = await budgetsRepo.findByIdWithSpent(pool, budget.id, currentMonth())
  return outcome(budget.id, mapBudgetRow(created), { created: true })
}

async function updateBudget(pool, id, payload) {
  const patch = parse(budgetUpdateSchema, payload)
  const existing = await budgetsRepo.findById(pool, id)
  if (!existing) throw new ApiError('NOT_FOUND', 'budget not found')

  await budgetsRepo.update(pool, id, patch)
  const updated = await budgetsRepo.findById(pool, id)
  return outcome(id, rowToCamel(updated))
}

async function deleteBudget(pool, id, replay) {
  const existing = await budgetsRepo.findById(pool, id)
  if (!existing) {
    if (replay) return outcome(id)
    throw new ApiError('NOT_FOUND', 'budget not found')
  }

  await budgetsRepo.softDelete(pool, id)
  return outcome(id)
}

async function writeBudget(pool, { action, id, payload, replay }) {
  if (action === 'create') return createBudget(pool, payload, replay)
  if (action === 'update') return updateBudget(pool, id, payload)
  if (action === 'delete') return deleteBudget(pool, id, replay)
  throw new ApiError('VALIDATION_ERROR', 'unknown write action')
}

async function createCategory(pool, payload, replay) {
  const category = parse(categoryCreateSchema, payload)
  if (replay) {
    const existing = await categoriesRepo.findByIdAny(pool, category.id)
    if (existing) return outcome(category.id, rowToCamel(existing), { created: false })
  }

  const nameTaken = await categoriesRepo.findActiveByName(pool, category.name)
  if (nameTaken) throw new ApiError('CONFLICT', 'category name already in use')

  try {
    await categoriesRepo.create(pool, category)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      if (replay) return outcome(category.id, null, { created: false })
      throw new ApiError('CONFLICT', 'category already exists')
    }
    throw err
  }

  const created = await categoriesRepo.findById(pool, category.id)
  return outcome(category.id, rowToCamel(created), { created: true })
}

async function updateCategory(pool, id, payload) {
  const patch = parse(categoryUpdateSchema, payload)
  const existing = await categoriesRepo.findById(pool, id)
  if (!existing) throw new ApiError('NOT_FOUND', 'category not found')

  if (patch.name) {
    const nameTaken = await categoriesRepo.findActiveByName(pool, patch.name, id)
    if (nameTaken) throw new ApiError('CONFLICT', 'category name already in use')
  }

  await categoriesRepo.update(pool, id, patch)
  const updated = await categoriesRepo.findById(pool, id)
  return outcome(id, rowToCamel(updated))
}

async function deleteCategory(pool, id, replay) {
  const existing = await categoriesRepo.findById(pool, id)
  if (!existing) {
    if (replay) return outcome(id)
    throw new ApiError('NOT_FOUND', 'category not found')
  }

  const referenceCount = await categoriesRepo.countReferences(pool, id)
  if (referenceCount > 0) {
    throw new ApiError('CONFLICT', 'category is referenced by existing transactions or budgets')
  }

  await categoriesRepo.softDelete(pool, id)
  return outcome(id)
}

async function writeCategory(pool, { action, id, payload, replay }) {
  if (action === 'create') return createCategory(pool, payload, replay)
  if (action === 'update') return updateCategory(pool, id, payload)
  if (action === 'delete') return deleteCategory(pool, id, replay)
  throw new ApiError('VALIDATION_ERROR', 'unknown write action')
}

async function createRecurring(pool, payload, replay) {
  const rule = parse(recurringCreateSchema, payload)
  validateTransactionShape(rule)
  if (replay) {
    const existing = await recurringRepo.findById(pool, rule.id)
    if (existing) return outcome(rule.id, mapRecurring(existing), { created: false })
  }

  try {
    await recurringRepo.create(pool, rule)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      if (replay) return outcome(rule.id, null, { created: false })
      throw new ApiError('CONFLICT', 'recurring rule already exists')
    }
    throw err
  }

  const created = await recurringRepo.findById(pool, rule.id)
  return outcome(rule.id, mapRecurring(created), { created: true })
}

async function updateRecurring(pool, id, payload) {
  const parsedPatch = parse(recurringUpdateSchema, payload)
  const existing = await recurringRepo.findById(pool, id)
  if (!existing) throw new ApiError('NOT_FOUND', 'recurring rule not found')

  const current = mapRecurring(existing)
  const patch = normalizeResumePatch(current, parsedPatch, todayInBangkok())
  validateTransactionShape({ ...current, ...patch })
  await recurringRepo.update(pool, id, patch)
  const updated = await recurringRepo.findById(pool, id)
  return outcome(id, mapRecurring(updated))
}

async function deleteRecurring(pool, id, replay) {
  const existing = await recurringRepo.findById(pool, id)
  if (!existing) {
    if (replay) return outcome(id)
    throw new ApiError('NOT_FOUND', 'recurring rule not found')
  }

  await recurringRepo.softDelete(pool, id)
  return outcome(id)
}

async function writeRecurring(pool, { action, id, payload, replay }) {
  if (action === 'create') return createRecurring(pool, payload, replay)
  if (action === 'update') return updateRecurring(pool, id, payload)
  if (action === 'delete') return deleteRecurring(pool, id, replay)
  throw new ApiError('VALIDATION_ERROR', 'unknown write action')
}

function validateLinkedPotExpense(existing, pot, patch) {
  const incomingUpdatedAt = toMysqlDatetime(patch.updatedAt)
  if (!shouldApply(incomingUpdatedAt, existing.updated_at)) return
  if ((patch.type ?? existing.type) !== 'expense') {
    throw new ApiError('CONFLICT', 'pot-funded transaction must remain an expense')
  }
  const accountId = Object.hasOwn(patch, 'accountId') ? patch.accountId : existing.account_id
  if (accountId !== pot.account_id) {
    throw new ApiError('CONFLICT', 'pot-funded expense must stay in its savings pot account')
  }
  const amount = patch.amount ?? Number(existing.amount)
  if (pot.archived_at && (patch.deleted || amount !== Number(existing.amount))) {
    throw new ApiError('CONFLICT', 'archived savings pot purchases cannot change reserved money')
  }
  const reserveBeforeExpense = Number(pot.allocated) - Number(pot.released)
    - Number(pot.spent) + Number(existing.amount)
  if (amount > reserveBeforeExpense) {
    throw new ApiError('CONFLICT', 'expense exceeds pot reserve')
  }
}

async function writeLinkedPotExpense(pool, existing, patch, write) {
  const link = await savingsPotsRepo.findPurchaseByTransactionId(pool, existing.id)
  if (!link) return write(pool)
  const candidate = await savingsPotsRepo.findById(pool, link.pot_id)
  if (!candidate) throw new ApiError('CONFLICT', 'linked savings pot not found')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await accountsRepo.findByIdForUpdate(connection, candidate.account_id)
    const pot = await savingsPotsRepo.findByIdForUpdate(connection, link.pot_id)
    const locked = await transactionsRepo.findByIdAnyForUpdate(connection, existing.id)
    if (!pot || !locked) throw new ApiError('CONFLICT', 'linked savings pot changed; try again')
    validateLinkedPotExpense(locked, await savingsPotsRepo.findById(connection, pot.id), patch)
    const result = await write(connection)
    await connection.commit()
    return result
  } catch (err) {
    await connection.rollback()
    throw err
  } finally { connection.release() }
}

async function createTransaction(pool, payload) {
  const transaction = parse(transactionCreateSchema, payload)
  validateTransactionShape(transaction)
  const saved = { ...transaction, updatedAt: toMysqlDatetime(transaction.updatedAt) }
  const existing = await transactionsRepo.findByIdAny(pool, transaction.id)
  const result = existing
    ? await writeLinkedPotExpense(pool, existing, transaction, (target) => transactionsRepo.upsert(target, saved))
    : await transactionsRepo.upsert(pool, saved)
  return outcome(transaction.id, rowToCamel(result.row), { status: result.status, created: result.created })
}

async function updateTransaction(pool, id, payload) {
  const patch = parse(transactionUpdateSchema, payload)
  const existing = await transactionsRepo.findById(pool, id)
  if (!existing) throw new ApiError('NOT_FOUND', 'transaction not found')

  validateTransactionShape({ ...rowToCamel(existing), ...patch })
  const saved = { ...patch, updatedAt: toMysqlDatetime(patch.updatedAt) }
  const result = await writeLinkedPotExpense(
    pool, existing, patch, (target) => transactionsRepo.updateGuarded(target, id, saved),
  )
  if (result.status === 'not_found') throw new ApiError('NOT_FOUND', 'transaction not found')
  return outcome(id, rowToCamel(result.row), { status: result.status })
}

async function deleteTransaction(pool, id, payload) {
  const body = parse(transactionDeleteSchema, payload)
  const existing = await transactionsRepo.findById(pool, id)
  if (!existing) throw new ApiError('NOT_FOUND', 'transaction not found')

  const result = await writeLinkedPotExpense(
    pool, existing, { ...body, deleted: true },
    (target) => transactionsRepo.softDeleteGuarded(target, id, toMysqlDatetime(body.updatedAt)),
  )
  if (result.status === 'not_found') throw new ApiError('NOT_FOUND', 'transaction not found')
  return outcome(id, null, { status: result.status })
}

async function writeTransaction(pool, { action, id, payload }) {
  if (action === 'create') return createTransaction(pool, payload)
  if (action === 'update') return updateTransaction(pool, id, payload)
  if (action === 'delete') return deleteTransaction(pool, id, payload)
  throw new ApiError('VALIDATION_ERROR', 'unknown write action')
}

async function writeEntity(pool, command) {
  const writers = {
    accounts: writeAccount,
    budgets: writeBudget,
    categories: writeCategory,
    recurring: writeRecurring,
    transactions: writeTransaction,
  }
  const writer = writers[command.entity]
  if (!writer) throw new ApiError('VALIDATION_ERROR', 'unknown write entity')
  if (!['create', 'update', 'delete'].includes(command.action)) {
    throw new ApiError('VALIDATION_ERROR', 'unknown write action')
  }

  const normalized = command.action === 'create'
    ? { ...command }
    : { ...command, id: parse(entityIdSchema, command.id) }
  return writer(pool, normalized)
}

module.exports = { writeEntity }
