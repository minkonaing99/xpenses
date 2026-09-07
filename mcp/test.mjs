// Runnable self-check for the pure helpers (no SDK, no network).
// Run: node test.mjs
import assert from "node:assert/strict";
import { bahtToSatang, buildPlan, buildTransactions, matchByName, todayIn, createClient } from "./src/client.mjs";

// bahtToSatang
assert.equal(bahtToSatang(120), 12000);
assert.equal(bahtToSatang("12.50"), 1250);
assert.equal(bahtToSatang("1,299.9"), 129990);
assert.equal(bahtToSatang("12.999"), 1299); // truncates, never rounds up
assert.equal(bahtToSatang(0), null); // must be > 0
assert.equal(bahtToSatang("abc"), null);
assert.equal(bahtToSatang("90071992547409.92"), null); // unsafe integer must never round

// matchByName
const cats = [{ name: "Food" }, { name: "Fuel" }, { name: "Fun money" }];
assert.equal(matchByName(cats, "food").name, "Food");
assert.equal(matchByName(cats, "fu").name, "Fuel"); // prefix beats substring order
assert.equal(matchByName(cats, "money").name, "Fun money"); // substring
assert.equal(matchByName(cats, "zzz"), null);

const bulk = buildTransactions(
  [
    { type: "expense", amount_baht: "12.50", category: "Food", account: "Cash", note: "Lunch" },
    { type: "income", amount_baht: 500, account: "Bank" },
    { type: "transfer", amount_baht: 100, from_account: "Cash", to_account: "Bank" },
  ],
  [{ id: "a1", name: "Cash" }, { id: "a2", name: "Bank" }],
  [{ id: "c1", name: "Food" }],
  { date: "2026-09-08", updatedAt: "2026-09-08T00:00:00.000Z", ids: ["t1", "t2", "t3"] },
);
assert.deepEqual(bulk, [
  { id: "t1", type: "expense", amount: 1250, note: "Lunch", categoryId: "c1", accountId: "a1", txnDate: "2026-09-08", updatedAt: "2026-09-08T00:00:00.000Z" },
  { id: "t2", type: "income", amount: 50000, note: undefined, accountId: "a2", txnDate: "2026-09-08", updatedAt: "2026-09-08T00:00:00.000Z" },
  { id: "t3", type: "transfer", amount: 10000, note: undefined, fromAccountId: "a1", toAccountId: "a2", txnDate: "2026-09-08", updatedAt: "2026-09-08T00:00:00.000Z" },
]);
assert.throws(
  () => buildTransactions(
    [{ type: "transfer", amount_baht: 10, from_account: "Cash", to_account: "Cash" }],
    [{ id: "a1", name: "Cash" }],
    [],
  ),
  /must be different/,
);
assert.throws(
  () => buildTransactions(
    [{ type: "income", amount_baht: 10, account: "Sa" }],
    [{ id: "a1", name: "Savings" }, { id: "a2", name: "Salary" }],
    [],
  ),
  /No unique account/,
);
const repeatedBulkInput = [{ type: "income", amount_baht: 10, account: "Cash" }];
const repeatedBulkOptions = { requestId: "3d7feaac-bacd-4f9e-a214-3eb0f572c945", date: "2026-09-08", updatedAt: "2026-09-08T00:00:00.000Z" };
assert.deepEqual(
  buildTransactions(repeatedBulkInput, [{ id: "a1", name: "Cash" }], [], repeatedBulkOptions),
  buildTransactions(repeatedBulkInput, [{ id: "a1", name: "Cash" }], [], repeatedBulkOptions),
);

assert.deepEqual(
  buildPlan(
    { name: "Laptop", amount_baht: "45,000", category: "Food", account: "Cash", planned_date: "2026-10-01", wait_days: 5 },
    [{ id: "a1", name: "Cash" }],
    [{ id: "c1", name: "Food" }],
    "p1",
  ),
  { id: "p1", name: "Laptop", amount: 4500000, categoryId: "c1", accountId: "a1", plannedDate: "2026-10-01", waitDays: 5 },
);

// todayIn
assert.match(todayIn("Asia/Bangkok", new Date("2026-07-11T20:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);

// createClient: unwraps the envelope and sends the bearer token
let seen;
const client = createClient({
  baseUrl: "https://x.test/api/",
  token: "tok",
  fetchImpl: async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: [{ id: "a" }] }) };
  },
});
const data = await client.get("/accounts");
assert.deepEqual(data, [{ id: "a" }]);
assert.equal(seen.url, "https://x.test/api/accounts"); // trailing slash trimmed
assert.equal(seen.opts.headers.Authorization, "Bearer tok");

// createClient: surfaces API error envelope
const failing = createClient({
  baseUrl: "https://x.test",
  token: "tok",
  fetchImpl: async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ ok: false, error: { code: "VALIDATION_ERROR", message: "bad" } }),
  }),
});
await assert.rejects(() => failing.get("/x"), /bad/);

// createClient: follows every cursor while preserving the existing array result
let pagedPaths = [];
const firstPage = Array.from({ length: 200 }, (_, index) => ({ id: `t${index}` }));
const paging = createClient({
  baseUrl: "https://x.test/api",
  token: "tok",
  fetchImpl: async (url) => {
    pagedPaths = [...pagedPaths, url];
    const secondPage = url.includes("cursor=");
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          ok: true,
          data: secondPage ? [{ id: "t200" }] : firstPage,
          meta: { nextCursor: secondPage ? null : "cursor+/=" },
        }),
    };
  },
});
const allTransactions = await paging.getAll("/transactions?month=2026-07");
assert.equal(allTransactions.length, 201);
assert.equal(pagedPaths[0], "https://x.test/api/transactions?month=2026-07&limit=200");
assert.equal(
  pagedPaths[1],
  "https://x.test/api/transactions?month=2026-07&limit=200&cursor=cursor%2B%2F%3D",
);

// createClient: rejects a repeated server cursor instead of looping forever
let repeatedPaths = [];
const repeating = createClient({
  baseUrl: "https://x.test/api",
  token: "tok",
  fetchImpl: async (url) => {
    repeatedPaths = [...repeatedPaths, url];
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, data: [], meta: { nextCursor: "same" } }),
    };
  },
});
await assert.rejects(() => repeating.getAll("/transactions?month=2026-07"), /repeated pagination cursor/i);
assert.equal(repeatedPaths.length, 2);

const malformedCursor = createClient({
  baseUrl: "https://x.test/api",
  token: "tok",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, data: [], meta: { nextCursor: 42 } }),
  }),
});
await assert.rejects(() => malformedCursor.getAll("/transactions?month=2026-07"), /invalid pagination cursor/i);

console.log("ok - all mcp client self-checks passed");
