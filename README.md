# @pipeworx/polygon-io

[Massive](https://massive.com) (formerly Polygon.io) MCP — stock + options + crypto + forex data.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1856+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

Polygon.io rebranded to Massive on 2025-10-30: `polygon.io` 301s site-wide to `massive.com`
(site, docs, dashboard). The API host did not move — `api.polygon.io` still serves, and
`api.massive.com` is the same API under the new name.

Free **Basic** plan: $0/mo, 5 API calls/minute, end-of-day data, 2 years of history
(massive.com/pricing, checked 2026-08-21). Paid Stocks Starter is $29/mo.

## Auth

- Platform: `PLATFORM_POLYGON_KEY`. BYO: `?_apiKey=…`.

## Tools

- `tickers(search?, type?, market?, exchange?, active?, limit?, sort?, order?)` — ticker search
- `ticker_details(ticker)` — ticker reference detail
- `aggregates(ticker, multiplier, timespan, from, to, adjusted?, sort?, limit?)` — OHLC bars
- `daily_open_close(ticker, date, adjusted?)` — daily O/H/L/C + after-hours
- `previous_close(ticker, adjusted?)` — previous close
- `grouped_daily(date, adjusted?)` — all tickers OHLC for a day
- `news(ticker?, published_utc?, order?, limit?, sort?)` — Massive market news
- `splits(ticker?, execution_date?, limit?)` — splits
- `dividends(ticker?, ex_dividend_date?, limit?)` — dividends
- `market_holidays()` — upcoming market holidays
- `market_status()` — current market status
- `exchanges(asset_class?, locale?)` — exchanges

`timespan`: `minute`|`hour`|`day`|`week`|`month`|`quarter`|`year`.

## Data sources

- API: `https://api.polygon.io` (legacy host, still live; `https://api.massive.com` is the same API)
- Docs: <https://massive.com/docs>
- Keys: <https://massive.com/dashboard/keys>

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "polygon-io": {
      "url": "https://gateway.pipeworx.io/polygon-io/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/polygon-io/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1856+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/polygon_io_tickers \
  -H 'Content-Type: application/json' \
  -d '{"search":"Apple"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/polygon_io_tickers`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-polygon-io` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/polygon-io/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "polygon-io": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-polygon-io"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Polygon Io data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
