// api/data.js — one Vercel serverless function for the Lab.
//   /api/data?type=candles&symbol=NVDAUSDT&gran=1D|4H|1H
//   /api/data?type=live&symbol=NVDAUSDT
//   /api/data?type=calendar&symbol=NVDAUSDT
// No API keys are needed or stored here.

const B = 'https://api.bitget.com';
const PT = 'USDT-FUTURES';
const MCP = 'https://agent.bitget.com/mcp';
const UNDER = { METAUSDT: 'META', GOOGLUSDT: 'GOOGL', AAPLUSDT: 'AAPL', AMZNUSDT: 'AMZN', NVDAUSDT: 'NVDA', TSLAUSDT: 'TSLA', MSFTUSDT: 'MSFT' };
const GRAN = { '1D': 86400000, '4H': 14400000, '1H': 3600000 };
const START = Date.parse('2026-02-01T00:00:00Z'); // NVDAUSDT opened about 2 Feb 2026

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

// ---------- futures candles ----------
async function candles(symbol, gran) {
  const bar = GRAN[gran];
  const now = Date.now();
  const step = 190 * bar; // history-candles allows limit up to 200
  const windows = [];
  for (let s = START; s < now; s += step) windows.push([s, Math.min(s + step, now + bar)]);
  const map = new Map();
  let failed = 0;
  const add = rows => { for (const x of rows) map.set(+x[0], [+x[0], +x[1], +x[2], +x[3], +x[4], +x[5]]); };

  for (let i = 0; i < windows.length; i += 8) {
    const batch = windows.slice(i, i + 8);
    const res = await Promise.all(batch.map(async ([s, e]) => {
      try {
        const j = await getJson(`${B}/api/v2/mix/market/history-candles?symbol=${symbol}&productType=${PT}&granularity=${gran}&startTime=${s}&endTime=${e}&limit=200`);
        if (Array.isArray(j.data)) return j.data;
        failed++;
        return [];
      } catch (err) { failed++; return []; }
    }));
    res.forEach(add);
  }
  try { // newest bars, in case history-candles stops short of "now"
    const j = await getJson(`${B}/api/v2/mix/market/candles?symbol=${symbol}&productType=${PT}&granularity=${gran}&limit=200`);
    if (Array.isArray(j.data)) add(j.data);
  } catch (err) { /* ignore */ }

  // keep closed bars only, so no signal ever uses a bar that is still forming
  const bars = [...map.values()].filter(b => b[0] + bar <= now).sort((a, b) => a[0] - b[0]);
  return {
    symbol, gran, n: bars.length, failedWindows: failed,
    from: bars.length ? new Date(bars[0][0]).toISOString() : null,
    to: bars.length ? new Date(bars[bars.length - 1][0]).toISOString() : null,
    bars
  };
}

// ---------- futures ticker, contract, funding ----------
async function ticker(symbol) {
  const [t, c, f] = await Promise.all([
    getJson(`${B}/api/v2/mix/market/ticker?symbol=${symbol}&productType=${PT}`),
    getJson(`${B}/api/v2/mix/market/contracts?productType=${PT}&symbol=${symbol}`),
    getJson(`${B}/api/v2/mix/market/current-fund-rate?symbol=${symbol}&productType=${PT}`)
  ]);
  const d = Array.isArray(t.data) ? t.data[0] : t.data;
  const k = Array.isArray(c.data) ? c.data[0] : null;
  const fr = Array.isArray(f.data) ? f.data[0] : null;
  if (!d) throw new Error('no ticker data');
  return {
    lastPr: +d.lastPr, markPrice: +d.markPrice, indexPrice: +d.indexPrice,
    fundingRate: fr ? +fr.fundingRate : +d.fundingRate,
    takerFeeRate: k ? +k.takerFeeRate : null, makerFeeRate: k ? +k.makerFeeRate : null,
    maxLever: k ? +k.maxLever : null, fundInterval: k ? +k.fundInterval : null,
    ts: +d.ts
  };
}

// ---------- Bitget MCP (US stock data) ----------
function parseSse(t) {
  const line = t.split('\n').find(l => l.startsWith('data:'));
  if (!line) return null;
  try { return JSON.parse(line.slice(5).trim()); } catch (e) { return null; }
}

async function mcpOpen() {
  const H = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  const init = await fetch(MCP, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'alphaagent-lab', version: '1.0' } }
    })
  });
  const sid = init.headers.get('mcp-session-id');
  await init.text();
  const H2 = sid ? { ...H, 'Mcp-Session-Id': sid } : H;
  await fetch(MCP, { method: 'POST', headers: H2, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  let id = 2;
  return async function query(entry_id, params) {
    const r = await fetch(MCP, {
      method: 'POST', headers: H2,
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'do_query', arguments: { entry_id, params } } })
    });
    const p = parseSse(await r.text());
    return p && p.result && p.result.structuredContent;
  };
}

async function reference(under) {
  const out = { quote: null, sentiment: null, errors: [] };
  let q;
  try { q = await mcpOpen(); } catch (e) { out.errors.push('mcp: ' + String(e)); return out; }
  const [qu, se] = await Promise.allSettled([
    q('equity_price_quote', { symbol: under }),
    q('sentiment_market_fear_greed', {})
  ]);
  if (qu.status === 'fulfilled') {
    const row = qu.value && qu.value.data && qu.value.data.results && qu.value.data.results[0];
    if (row) out.quote = { symbol: under, last: +row.last_price, prevClose: +row.prev_close, changePct: row.change_percent == null ? null : +row.change_percent * 1 };
    else out.errors.push('quote: empty');
  } else out.errors.push('quote: ' + String(qu.reason));
  if (se.status === 'fulfilled') {
    const row = se.value && se.value.data && se.value.data.results && se.value.data.results[0];
    if (row) out.sentiment = { score: +row.score, rating: row.rating, timestamp: row.timestamp };
    else out.errors.push('sentiment: empty');
  } else out.errors.push('sentiment: ' + String(se.reason));
  return out;
}

async function calendar(under) {
  const q = await mcpOpen();
  const sc = await q('equity_calendar', { symbol: under });
  const rows = (sc && sc.data && sc.data.results) || [];
  const day = v => (v ? String(v).slice(0, 10) : null);
  const dates = rows
    .map(r => day(r.perf_brief_dsclsr_date) || day(r.perf_report_dsclsr_date) || day(r.perf_briefing_fore_dsclsr_date) || day(r.perf_report_fore_dsclsr_date))
    .filter(d => d && d >= '2026-01-01');
  const uniq = [...new Set(dates)].sort();
  const today = new Date().toISOString().slice(0, 10);
  return { symbol: under, rows: rows.length, dates: uniq, upcoming: uniq.filter(d => d >= today) };
}

// ---------- handler ----------
module.exports = async (req, res) => {
  const q = req.query || {};
  const symbol = String(q.symbol || 'NVDAUSDT').toUpperCase();
  if (!UNDER[symbol]) return res.status(400).json({ error: 'unknown symbol' });
  try {
    if (q.type === 'candles') {
      const gran = String(q.gran || '1D');
      if (!GRAN[gran]) return res.status(400).json({ error: 'gran must be 1D, 4H or 1H' });
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json(await candles(symbol, gran));
    }
    if (q.type === 'live') {
      const [t, ref] = await Promise.allSettled([ticker(symbol), reference(UNDER[symbol])]);
      res.setHeader('Cache-Control', 's-maxage=20');
      return res.status(200).json({
        symbol,
        ticker: t.status === 'fulfilled' ? t.value : null,
        tickerError: t.status === 'rejected' ? String(t.reason) : null,
        reference: ref.status === 'fulfilled' ? ref.value : { quote: null, sentiment: null, errors: [String(ref.reason)] }
      });
    }
    if (q.type === 'calendar') {
      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(200).json(await calendar(UNDER[symbol]));
    }
    return res.status(400).json({ error: 'type must be candles, live or calendar' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};