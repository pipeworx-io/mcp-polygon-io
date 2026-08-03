interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */
const MAX_DETAIL = 300;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(`${name}: ${res.status}${detailSuffix(await readDetail(res))}`);
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  return `${name}: ${res.status}${detailSuffix(await readDetail(res))}`;
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an HTML page instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. First 120 chars: ${collapse(raw).slice(0, 120)}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `First 120 chars: ${collapse(raw).slice(0, 120)}`,
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  if (!raw) return '';

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) carries no API-level explanation, only markup that would crowd out
  // the status. Recognising it is worth more than stripping it: dropping it
  // keeps the message honest instead of filling it with `<!DOCTYPE html><html>`.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml')) return '';

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return collapse(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}


/**
 * Polygon.io MCP.
 */


const BASE = 'https://api.polygon.io';
const UA = 'pipeworx-mcp-polygon-io/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'tickers',
    description: 'Search Polygon.io reference universe for US stocks, options, indices, forex, and crypto tickers. Returns symbol, name, market, asset class, primary exchange, currency. Use to resolve a company name to a tradable symbol.',
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
  { name: 'ticker_details', description: 'Fetch full Polygon.io reference details for a single ticker: company name, description, SIC code, primary exchange, locale, market cap, phone, address, homepage URL, and logo.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' } }, required: ['ticker'] } },
  {
    name: 'aggregates',
    description: 'Polygon.io OHLC price bars for a US stock ticker — 1 minute through quarterly granularity. Returns timestamped open/high/low/close + volume + VWAP. Use for charting equities, intraday analysis, backtesting historical prices.',
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
    description: 'Fetch official open, high, low, close, volume, and after-hours/pre-market prices for a US stock ticker on a specific date (YYYY-MM-DD) from Polygon.io.',
    inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, date: { type: 'string' }, adjusted: { type: 'boolean' } }, required: ['ticker', 'date'] },
  },
  { name: 'previous_close', description: 'Fetch the previous trading session\'s open, high, low, close, and volume for a US stock ticker from Polygon.io.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, adjusted: { type: 'boolean' } }, required: ['ticker'] } },
  { name: 'grouped_daily', description: 'Fetch OHLCV bars for all US stocks on a given date (YYYY-MM-DD) from Polygon.io in a single call; useful for market-wide snapshot or screening.', inputSchema: { type: 'object', properties: { date: { type: 'string' }, adjusted: { type: 'boolean' } }, required: ['date'] } },
  {
    name: 'news',
    description: 'Polygon.io financial news: ticker-tagged US stock market headlines with publisher, article URL, image, summary, and per-ticker sentiment insights. Use for "what is the news on $TICKER" or "market-moving headlines today". Prefer over web search for equity-focused news.',
    inputSchema: {
      type: 'object',
      properties: { ticker: { type: 'string' }, published_utc: { type: 'string' }, order: { type: 'string' }, limit: { type: 'number' }, sort: { type: 'string' } },
    },
  },
  { name: 'splits', description: 'Historical stock splits for a US-listed Polygon.io ticker: split ratio, execution date, ticker. Use to adjust historical price comparisons across split events.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, execution_date: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'dividends', description: 'Historical and upcoming cash + stock dividends for a US-listed Polygon.io ticker: ex-date, record date, pay date, declaration date, cash amount, dividend type, frequency. Use for income analysis and dividend-capture strategies.', inputSchema: { type: 'object', properties: { ticker: { type: 'string' }, ex_dividend_date: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'market_holidays', description: 'Return the list of upcoming US stock market holidays from Polygon.io, including date, holiday name, and exchange status (open/closed/early-close).', inputSchema: { type: 'object', properties: {} } },
  { name: 'market_status', description: 'Current market status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'exchanges', description: 'Reference list of exchanges Polygon.io covers: US stock exchanges (NYSE, NASDAQ, etc.), options venues, crypto exchanges, and OTC tiers. Returns MIC code, name, asset class, type, locale.', inputSchema: { type: 'object', properties: { asset_class: { type: 'string' }, locale: { type: 'string' } } } },
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
    if (!res.ok) throw await httpError(res, 'Polygon.io');
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
      return withBarLegend(
        await get(`/v2/aggs/ticker/${t}/range/${mult}/${encodeURIComponent(span)}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`, p),
      );
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
      return withBarLegend(await get(`/v2/aggs/ticker/${t}/prev`, p));
    }
    case 'grouped_daily': {
      const d = encodeURIComponent(reqStr(args, 'date', '"2025-01-02"'));
      const p = buildParams(args, ['date']);
      return withBarLegend(await get(`/v2/aggs/grouped/locale/us/market/stocks/${d}`, p));
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

/**
 * Polygon returns OHLC bars with single-letter keys and an epoch-ms `t`:
 * `{v,vw,o,c,h,l,t,n}`. The letters are documented in the outputSchema, but a
 * model reading the raw JSON has no legend to hand and `t` is unreadable either
 * way — "what did SPY close at on the 22nd?" needs the caller to know that
 * 1784692800000 is that day. Attach one legend at the top level plus an ISO
 * `date` per bar. Aliasing every field on every bar would read better still but
 * doubles the payload on a year of 1-minute data, which is the common case.
 */
const BAR_LEGEND = {
  o: 'open',
  h: 'high',
  l: 'low',
  c: 'close',
  v: 'volume',
  vw: 'volume-weighted average price',
  n: 'number of transactions',
  t: 'bar start, epoch milliseconds — see the ISO `date` on each bar',
  T: 'ticker symbol (grouped_daily only)',
};

function withBarLegend(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.results)) return data;
  return {
    ...d,
    field_legend: BAR_LEGEND,
    results: d.results.map((bar) => {
      const t = (bar as { t?: unknown } | null)?.t;
      // Derived from the bar's own timestamp, never the wall clock — module-scope
      // clock reads are frozen at epoch 0 in Workers.
      return typeof t === 'number' && Number.isFinite(t)
        ? { ...(bar as object), date: new Date(t).toISOString() }
        : bar;
    }),
  };
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
