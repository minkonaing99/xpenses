#!/usr/bin/env node
// xpenses MCP server. Exposes read access to your finances plus a single
// write (log an expense) over stdio, for use in Claude Desktop / Claude Code.
//
// Config (env):
//   XPENSES_API_URL    e.g. https://your-host/api
//   XPENSES_API_TOKEN  the API_TOKEN set on the server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  ApiError,
  bahtToSatang,
  buildPlan,
  buildTransactions,
  createClient,
  matchByName,
  todayIn,
} from "./client.mjs";

const client = createClient({
  baseUrl: process.env.XPENSES_API_URL,
  token: process.env.XPENSES_API_TOKEN,
});

const monthArg = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM")
  .describe("Month as YYYY-MM");
const amountArg = z.union([z.number(), z.string()]).describe("Amount in baht, e.g. 120 or 12.50");
const requestIdArg = z.string().uuid().describe("Stable UUID for this request; reuse it unchanged when retrying");
const nameArg = z.string().trim().min(1).max(80);
const noteArg = z.string().max(255).optional();
const dateArg = z.string().date().optional().describe("Date YYYY-MM-DD; defaults to today in Bangkok");
const transactionArg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("expense"), amount_baht: amountArg, category: nameArg, account: nameArg, note: noteArg, date: dateArg }).strict(),
  z.object({ type: z.literal("income"), amount_baht: amountArg, account: nameArg, note: noteArg, date: dateArg }).strict(),
  z.object({ type: z.literal("transfer"), amount_baht: amountArg, from_account: nameArg, to_account: nameArg, note: noteArg, date: dateArg }).strict(),
]);

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// Wrap a handler so API/validation errors come back as tool errors, not crashes.
function tool(fn) {
  return async (args) => {
    try {
      return json(await fn(args));
    } catch (err) {
      if (err instanceof ApiError) return fail(err.message);
      throw err;
    }
  };
}

const server = new McpServer({ name: "xpenses", version: "0.2.0" });

server.registerTool(
  "list_transactions",
  { description: "List transactions for a month (YYYY-MM).", inputSchema: { month: monthArg } },
  tool(({ month }) => client.getAll(`/transactions?month=${month}`)),
);

server.registerTool(
  "get_balances",
  { description: "Current balance of every account plus net total.", inputSchema: {} },
  tool(() => client.get("/accounts")),
);

server.registerTool(
  "get_budgets",
  { description: "Per-category budget status (spent vs limit) for a month.", inputSchema: { month: monthArg } },
  tool(({ month }) => client.get(`/budgets?month=${month}`)),
);

server.registerTool(
  "get_forecast",
  { description: "Recurring-aware month-end spend/net projection.", inputSchema: { month: monthArg } },
  tool(({ month }) => client.get(`/insights/forecast?month=${month}`)),
);

server.registerTool(
  "get_anomalies",
  { description: "Spending heads-up flags (budget burn, velocity, duplicates).", inputSchema: { month: monthArg } },
  tool(({ month }) => client.get(`/insights/anomalies?month=${month}`)),
);

server.registerTool(
  "get_comparisons",
  { description: "Per-category spend vs last month and trailing average.", inputSchema: { month: monthArg } },
  tool(({ month }) => client.get(`/insights/comparisons?month=${month}`)),
);

server.registerTool(
  "get_plans",
  { description: "List planned purchases and forecast totals for a month.", inputSchema: { month: monthArg } },
  tool(({ month }) => client.get(`/plans?month=${month}`)),
);

server.registerTool(
  "create_expense",
  {
    description: "Log an expense. Amount is in baht; category and account are matched by name.",
    inputSchema: {
      request_id: requestIdArg,
      amount_baht: z.union([z.number(), z.string()]).describe("Expense amount in baht, e.g. 120 or 12.50"),
      category: z.string().describe("Category name (fuzzy-matched)"),
      account: z.string().describe("Account name (fuzzy-matched)"),
      note: z.string().optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Transaction date YYYY-MM-DD; defaults to today (Bangkok)"),
    },
  },
  tool(async ({ request_id, amount_baht, category, account, note, date }) => {
    const amount = bahtToSatang(amount_baht);
    if (amount === null) throw new ApiError(`Invalid amount: ${amount_baht}`);

    const [categories, accounts] = await Promise.all([client.get("/categories"), client.get("/accounts")]);
    const cat = matchByName(categories, category);
    if (!cat) throw new ApiError(`No category matching "${category}"`);
    const acc = matchByName(accounts, account);
    if (!acc) throw new ApiError(`No account matching "${account}"`);

    const txn = {
      id: request_id,
      type: "expense",
      amount,
      note: note ?? undefined, // schema wants string|omitted, not null
      categoryId: cat.id,
      accountId: acc.id,
      txnDate: date ?? todayIn("Asia/Bangkok"),
      updatedAt: new Date().toISOString(), // client-supplied LWW timestamp
    };
    const result = await client.post("/transactions/bulk", { transactions: [txn] });
    return { created: result.results[0]?.value, category: cat.name, account: acc.name };
  }),
);

server.registerTool(
  "create_transactions",
  {
    description: "Atomically log 1-20 mixed expenses, incomes, and transfers in one call.",
    inputSchema: { request_id: requestIdArg, transactions: z.array(transactionArg).min(1).max(20) },
  },
  tool(async ({ request_id, transactions }) => {
    const needsCategories = transactions.some((item) => item.type === "expense");
    const [accounts, categories] = await Promise.all([
      client.get("/accounts"),
      needsCategories ? client.get("/categories") : Promise.resolve([]),
    ]);
    const payload = buildTransactions(transactions, accounts, categories, { requestId: request_id });
    return client.post("/transactions/bulk", { transactions: payload });
  }),
);

server.registerTool(
  "create_plan",
  {
    description: "Create a planned purchase. Amount is in baht; category and account are matched by name.",
    inputSchema: {
      request_id: requestIdArg,
      name: z.string().trim().min(1).max(255),
      amount_baht: amountArg,
      category: nameArg,
      account: nameArg,
      planned_date: z.string().date(),
      wait_days: z.number().int().min(0).max(30).optional(),
    },
  },
  tool(async (input) => {
    const [categories, accounts] = await Promise.all([client.get("/categories"), client.get("/accounts")]);
    return client.post("/plans", buildPlan(input, accounts, categories, input.request_id));
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
