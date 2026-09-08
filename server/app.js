'use strict'

const express = require('express')
const cookieParser = require('cookie-parser')
const { loadEnv } = require('./config/env')
const { getPool } = require('./db/pool')
const { getAuthMiddleware } = require('./middleware/auth')
const { createAuthRouter } = require('./features/auth/router')
const { createAccountsRouter } = require('./features/accounts/router')
const { createCategoriesRouter } = require('./features/categories/router')
const { createTransactionsRouter } = require('./features/transactions/router')
const { createSyncRouter } = require('./features/sync/router')
const { createBudgetsRouter } = require('./features/budgets/router')
const { createRecurringRouter } = require('./features/recurring/router')
const { createReportsRouter } = require('./features/reports/router')
const { createInsightsRouter } = require('./features/insights/router')
const { createPlansRouter } = require('./features/plans/router')
const { createSavingsPotsRouter } = require('./features/savingsPots/router')
const { createCronRouter } = require('./features/cron/router')
const { scheduleRecurringCron } = require('./cron')
const errorHandler = require('./middleware/error')
const { ApiError } = require('./lib/apiResponse')

const env = loadEnv()
const pool = getPool()
const requireAuth = getAuthMiddleware()

const app = express()

// Hostinger/Passenger sits in front as a reverse proxy — without this,
// express-rate-limit keys every request to the proxy's IP instead of the
// real client, collapsing the login rate limit for everyone (or no one).
if (env.nodeEnv === 'production') {
  app.set('trust proxy', 1)
}

app.use(express.json({ limit: '10kb' }))
app.use(cookieParser())

app.use(
  '/api/auth',
  createAuthRouter({ passwordHash: env.passwordHash, jwtSecret: env.jwtSecret, nodeEnv: env.nodeEnv }),
)

app.use('/api/accounts', requireAuth, createAccountsRouter(pool))
app.use('/api/categories', requireAuth, createCategoriesRouter(pool))
app.use('/api/transactions', requireAuth, createTransactionsRouter(pool))
app.use('/api/sync', requireAuth, createSyncRouter(pool))
app.use('/api/budgets', requireAuth, createBudgetsRouter(pool))
app.use('/api/recurring', requireAuth, createRecurringRouter(pool))
app.use('/api/reports', requireAuth, createReportsRouter(pool))
app.use('/api/insights', requireAuth, createInsightsRouter(pool))
app.use('/api/plans', requireAuth, createPlansRouter(pool))
app.use('/api/savings-pots', requireAuth, createSavingsPotsRouter(pool))
// Not behind requireAuth — Plan B cron has its own shared-secret check
// (an external Hostinger cron job has no browser session to authenticate).
app.use('/api/cron', createCronRouter(pool, env.cronSharedSecret))

// In-process cron only runs in production (Passenger-managed process) — a
// test run or `npm run dev` must never spin up a real background scheduler
// against the dev/test DB. Plan B (`POST /api/cron/run`) works in any env.
if (env.nodeEnv === 'production') {
  scheduleRecurringCron(pool)
}

// Production only: serve the built PWA from this same origin so the httpOnly
// auth cookie is first-party. Dev uses the Vite proxy instead.
if (env.nodeEnv === 'production') {
  const path = require('path')
  const webDist = path.join(__dirname, 'public')
  app.use(express.static(webDist))
  // SPA deep links (/ledger, /settings/...) fall back to index.html; /api excluded.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    res.sendFile(path.join(webDist, 'index.html'), (err) => (err ? next() : undefined))
  })
}

app.use((req, res, next) => {
  next(new ApiError('NOT_FOUND', 'route not found'))
})

app.use(errorHandler)

// No .listen() here — Passenger provides the HTTP server in production
// (see docs/TECH.md ADR). Local dev listens via dev-server.js instead.
module.exports = app
