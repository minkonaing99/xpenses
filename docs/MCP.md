# xpenses — MCP Server

Talk to your finances from Claude Desktop or Claude Code. The `mcp/` package is
a local stdio [MCP](https://modelcontextprotocol.io) server that wraps the
xpenses REST API over HTTPS with a bearer token.

## What Claude can do

The server exposes 10 tools. Read: `list_transactions`, `get_balances`,
`get_budgets`, `get_forecast`, `get_anomalies`, `get_comparisons`, and
`get_plans`. Create: `create_expense`, `create_transactions`, and `create_plan`.
No update, delete, plan confirmation, or reflection tools by design. Fix
mistakes and confirm purchases in the app.

## Usage (talking to it)

After the client is registered (below) and approved, you don't call tools by
name — just talk. Claude reads the request and picks the tool. Examples:

| You say | Tool |
| --- | --- |
| "what are my account balances?" | `get_balances` |
| "am I on track this month?" / "projected spend by end of July?" | `get_forecast` |
| "how are my budgets doing?" | `get_budgets` |
| "anything unusual in my spending?" | `get_anomalies` |
| "what am I spending more on vs last month?" | `get_comparisons` |
| "list my July transactions" | `list_transactions` |
| "log ฿120 lunch to Cash under Food" | `create_expense` |
| "log lunch, salary, and a transfer" | `create_transactions` |
| "show my September purchase plans" | `get_plans` |
| "plan a ฿30,000 laptop for October" | `create_plan` |

Notes:
- **Months** default to the current one; name another ("in June", "2026-05").
- **Complete transaction lists:** `list_transactions` follows every API cursor,
  so months with more than 200 transactions are returned in full.
- **Logging an expense**: amount in baht (auto-converted to satang); category
  and account are matched by name (exact first, then partial); date defaults to
  today (Bangkok), or say "...on 2026-07-09".
- **Safe retries:** every create tool requires a `request_id` UUID. Generate it
  once and reuse the same value if the call is retried; the API will not create
  duplicates for that request.
- **Bulk logging:** `create_transactions` accepts 1-20 mixed expenses, incomes,
  and transfers. It validates every item and commits them atomically, so one
  failure rolls back the whole batch.
- **Plans:** plans can be listed and created. Confirming, editing, deleting,
  and purchase reflections remain app-only.
- **Create-only writes.** No edit or delete through Claude. A model misread
  cannot overwrite or wipe existing data.
- If it logs to the wrong category/account, restate the exact name.

Troubleshooting: tools missing -> restart the client and approve the server;
`authentication required` -> the server lacks the deployed Bearer-auth code or
the `API_TOKEN`/`XPENSES_API_TOKEN` pair doesn't match.

## Server setup (one time)

1. Generate a token and set it on the API server's `.env`:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Put it in `API_TOKEN=` (min 24 chars). When set, requests with
   `Authorization: Bearer <token>` authenticate without a cookie. Leave unset to
   disable programmatic access entirely.
2. Redeploy / restart the server so it picks up the new env.

## Client setup

Install deps once:

```
cd mcp && npm install
```

Register with Claude Desktop (`claude_desktop_config.json`) or Claude Code
(`.mcp.json`):

```json
{
  "mcpServers": {
    "xpenses": {
      "command": "node",
      "args": ["/absolute/path/to/xpenses/mcp/src/index.mjs"],
      "env": {
        "XPENSES_API_URL": "https://your-host/api",
        "XPENSES_API_TOKEN": "the-same-token-as-API_TOKEN"
      }
    }
  }
}
```

`XPENSES_API_URL` is the API root (ends in `/api`). Both env vars are required;
the server refuses to start without them.

## Security notes

- The token is compared in constant time (`lib/safeCompare.js`); a mismatch
  falls through to cookie auth and then 401.
- The token grants the same access as a logged-in session — treat it like a
  password. Rotate by changing `API_TOKEN` on the server and the client config.
- MCP writes can only create transactions and plans; they cannot delete,
  overwrite, confirm purchases, or save reflections.

## Self-check

```
cd mcp && npm test
```

Covers the pure helpers (baht->satang truncation, name matching, envelope
unwrapping, error surfacing) without network or the SDK.
