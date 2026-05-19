interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Polygon.io MCP.
 */


const BASE = 'https://api.polygon.io';
const UA = 'pipeworx-mcp-polygon-io/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'tickers',
    description: 'Ticker search.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        type: { type: 'string' },
        market: { type: 'string' },
        exchange: { type: 'string' },
        active: { type: 'boolean' },
        limit: { type: 'number' },
        sort: { type: 'string' },
        order: { type: 'string' },
      },
    },
  },
  { name: 'ticker_details', description: 'Ticker reference detail.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  {
    name: 'aggregates',
    description: 'OHLC bars.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string' },
        multiplier: { type: 'number' },
        timespan: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        adjusted: { type: 'boolean' },
        sort: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['ticker', 'multiplier', 'timespan', 'from', 'to'],
    },
  },
  {
    name: 'daily_open_close',
    description: 'Daily O/H/L/C + after-hours.',
    inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, date: { type: 'string' }, adjusted: { type: 'boolean' } }, required: ['ticker', 'date'] },
  },
  { name: 'previous_close', description: 'Previous close.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, adjusted: { type: 'boolean' } }, required: ['ticker'] } },
  { name: 'grouped_daily', description: 'All-ticker daily.', inputSchema: { type: 'object', properties: { date: { type: 'string' }, adjusted: { type: 'boolean' } }, required: ['date'] } },
  {
    name: 'news',
    description: 'News.',
    inputSchema: {
      type: 'object',
      properties: { ticker: { type: 'string' }, published_utc: { type: 'string' }, order: { type: 'string' }, limit: { type: 'number' }, sort: { type: 'string' } },
    },
  },
  { name: 'splits', description: 'Splits.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, execution_date: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'dividends', description: 'Dividends.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, ex_dividend_date: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'market_holidays', description: 'Upcoming holidays.', inputSchema: { type: 'object', properties: {} } },
  { name: 'market_status', description: 'Current market status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'exchanges', description: 'Exchanges.', inputSchema: { type: 'object', properties: { asset_class: { type: 'string' }, locale: { type: 'string' } } } },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = (args._apiKey as string | undefined)?.trim();
  if (!apiKey) throw new Error('Polygon.io requires an API key. Set PLATFORM_POLYGON_KEY or pass ?_apiKey=… (free at https://polygon.io/dashboard/keys).');
  const get = async (path: string, params?: URLSearchParams) => {
    const p = params ?? new URLSearchParams();
    p.set('apiKey', apiKey);
    const res = await fetch(`${BASE}${path}?${p}`, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (res.status === 401 || res.status === 403) throw new Error('Polygon.io: invalid API key.');
    if (res.status === 429) throw new Error('Polygon.io: 429 rate limit (free tier 5/min).');
    if (!res.ok) throw new Error(`Polygon.io: ${res.status}`);
    return res.json();
  };
  const buildParams = (a: Record<string, unknown>, except: string[] = []) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(a)) {
      if (k === '_apiKey' || except.includes(k) || v == null) continue;
      p.set(k, String(v));
    }
    return p;
  };
  switch (name) {
    case 'tickers':
      return get('/v3/reference/tickers', buildParams(args));
    case 'ticker_details':
      return get(`/v3/reference/tickers/${encodeURIComponent(reqStr(args, 'ticker', '"AAPL"'))}`);
    case 'aggregates': {
      const t = encodeURIComponent(reqStr(args, 'ticker', '"AAPL"'));
      const mult = Number(args.multiplier ?? 1);
      const span = reqStr(args, 'timespan', '"day"');
      const from = reqStr(args, 'from', '"2025-01-01"');
      const to = reqStr(args, 'to', '"2025-12-31"');
      const p = buildParams(args, ['ticker', 'multiplier', 'timespan', 'from', 'to']);
      return get(`/v2/aggs/ticker/${t}/range/${mult}/${encodeURIComponent(span)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, p);
    }
    case 'daily_open_close': {
      const t = encodeURIComponent(reqStr(args, 'ticker', '"AAPL"'));
      const d = encodeURIComponent(reqStr(args, 'date', '"2025-01-02"'));
      const p = buildParams(args, ['ticker', 'date']);
      return get(`/v1/open-close/${t}/${d}`, p);
    }
    case 'previous_close': {
      const t = encodeURIComponent(reqStr(args, 'ticker', '"AAPL"'));
      const p = buildParams(args, ['ticker']);
      return get(`/v2/aggs/ticker/${t}/prev`, p);
    }
    case 'grouped_daily': {
      const d = encodeURIComponent(reqStr(args, 'date', '"2025-01-02"'));
      const p = buildParams(args, ['date']);
      return get(`/v2/aggs/grouped/locale/us/market/stocks/${d}`, p);
    }
    case 'news':
      return get('/v2/reference/news', buildParams(args));
    case 'splits':
      return get('/v3/reference/splits', buildParams(args));
    case 'dividends':
      return get('/v3/reference/dividends', buildParams(args));
    case 'market_holidays':
      return get('/v1/marketstatus/upcoming');
    case 'market_status':
      return get('/v1/marketstatus/now');
    case 'exchanges':
      return get('/v3/reference/exchanges', buildParams(args));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
