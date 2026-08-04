# @pipeworx/polygon-io

[Polygon.io](https://polygon.io) MCP — stock + options + crypto + forex data. Free tier (5 req/min, end-of-day).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Auth

- Platform: `PLATFORM_POLYGON_KEY`. BYO: `?_apiKey=…`.

## Tools

- `tickers(search?, type?, market?, exchange?, active?, limit?, sort?, order?)` — ticker search
- `ticker_details(ticker)` — ticker reference detail
- `aggregates(ticker, multiplier, timespan, from, to, adjusted?, sort?, limit?)` — OHLC bars
- `daily_open_close(ticker, date, adjusted?)` — daily O/H/L/C + after-hours
- `previous_close(ticker, adjusted?)` — previous close
- `grouped_daily(date, adjusted?)` — all tickers OHLC for a day
- `news(ticker?, published_utc?, order?, limit?, sort?)` — Polygon news
- `splits(ticker?, execution_date?, limit?)` — splits
- `dividends(ticker?, ex_dividend_date?, limit?)` — dividends
- `market_holidays()` — upcoming market holidays
- `market_status()` — current market status
- `exchanges(asset_class?, locale?)` — exchanges

`timespan`: `minute`|`hour`|`day`|`week`|`month`|`quarter`|`year`.

## Data source

`https://api.polygon.io`

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Polygon Io data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
