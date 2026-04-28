# @calendar-automations/mcp-server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) server
that exposes public Calendar Automations product facts to AI agents. Stdio
transport. No user data, no calendar access, no tokens.

## Tools

- `get_product_summary` — name, description, features, canonical URLs, pricing
  note, articles, FAQ.
- `get_integration_steps` — ordered steps to subscribe a Calendar Automations
  iCal feed in Google Calendar or Apple Calendar.
- `get_security_model` — OAuth scopes, feed behavior, retention summary, and
  non-goals.

## Run locally

From the workspace root:

```bash
pnpm --filter @calendar-automations/mcp-server build
pnpm --filter @calendar-automations/mcp-server start
```

For development with live reload:

```bash
pnpm --filter @calendar-automations/mcp-server dev
```

The server reads `CALENDAR_AUTOMATIONS_SITE_URL` to build canonical URLs in
responses (defaults to `https://calendar-automations.app`).

## Wiring an MCP client

Most MCP-aware tools (Claude Desktop, Cursor, etc.) accept a stdio command
in their config. Example:

```json
{
  "mcpServers": {
    "calendar-automations": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "CALENDAR_AUTOMATIONS_SITE_URL": "https://calendar-automations.app"
      }
    }
  }
}
```

## Source of truth

All payloads are derived from `@calendar-automations/marketing`, which is also
the source for the web app's `/llms.txt`, `/llms-full.txt`, JSON-LD, FAQ, and
landing copy. Changes there propagate to every surface.
