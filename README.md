# allunits-mcp

Unit conversion for AI agents — 30 pairs, computed locally, no API key, no network.

## Why this one

Every result carries the exact factor, the offset, the display precision and the page that documents the definition. When an agent says a marathon is 26.219 mi, it can also show where 0.6213711922 comes from.

## Install

Any MCP client (Claude Desktop, Cursor, Cline, Windsurf):

```json
{
  "mcpServers": {
    "allunits": { "command": "npx", "args": ["-y", "allunits-mcp"] }
  }
}
```

Or clone and point at the file:

```json
{
  "mcpServers": {
    "allunits": { "command": "node", "args": ["/absolute/path/to/allunits-api/mcp-server/server.mjs"] }
  }
}
```

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `convert_unit` | `from`, `to`, `value`, optional `decimals` | rounded result, `unrounded`, factor, offset, definition page |
| `list_units` | optional `category` | the 30 pairs with slugs and pages |
| `get_factor` | `from`, `to` | factor, offset, precision, formula — no conversion |

Symbols and names both work: `km`, `kilometers`, `lb`, `pounds`, `°F`, `fahrenheit`. The reverse direction needs no second pair.

## Coverage

length 7 · weight 4 · pressure 4 · volume 4 · data 3 · temperature 2 · speed 2 · time 2 · area 2

## Bulk

For 100+ conversions per call, or a hard SLA, use the HTTP API: https://api.allunits.org/docs
Free 100 requests/day without a key; keys from $9/month.

## Licence

MIT for the server code. Conversion data is CC BY 4.0 — attribution: AllUnits.org — https://allunits.org/
