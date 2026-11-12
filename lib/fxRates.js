// Currency rates for the converter accessory, per 1 USD.
//   - Fetched automatically every 12 hours:
//       European Central Bank daily reference rates (official): EUR, GBP, ZAR, MYR, SGD
//       ExchangeRate-API's open feed (market rates, no key) for the rest: BWP, ZMW, MZN, AED, EGP, MUR
//     The ECB publishes against the euro, so each rate is converted to "per USD" here.
//   - ZiG (ZWG) is always set by an admin: it moves on the Reserve Bank's official interbank rate
//     and you choose which one you quote. The market feed's ZiG figure is shown as a hint only.
//   - If a feed fails, the last good rate is kept (and shown as such); an admin can also set any
//     currency that has no automatic rate.
// Stored in app_settings under "fx_rates". Refreshed by the reminder cron and the once-a-minute
// check while the server is awake (both only fetch when 12 hours have passed), and when someone
// opens the converter after that.
const Acc = require('../public/acc-core');
const db = require('./db');

const KEY = 'fx_rates';
const REFRESH_MS = 12 * 3600 * 1000;
const RETRY_MS = 60 * 60 * 1000;   // after a failed fetch, try again in an hour (not every minute)
const FORCE_GAP_MS = 5 * 60 * 1000; // "Refresh now" at most every 5 minutes
const MANUAL = ['ZWG'];
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MARKET_URL = 'https://open.er-api.com/v6/latest/USD';
const SOURCES = {
  ECB: { name: 'European Central Bank', url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html', official: true },
  'ExchangeRate-API': { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com', official: false },
};
const AUTO_CODES = Acc.CODES.filter((c) => c !== 'USD' && !MANUAL.includes(c));
const sane = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e8;
const round = (n) => Number(n.toPrecision(8));
const httpError = (status, message) => Object.assign(new Error(message), { status });
const autoOff = () => process.env.FX_RATES_AUTO === 'off';

async function get(url, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/xml, application/json', 'User-Agent': 'AutoWerke-IT-portal (currency converter)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > 300000) throw new Error('response too large');
    return text;
  } finally { clearTimeout(t); }
}

// <Cube time='2026-11-05'> ... <Cube currency='USD' rate='1.1224'/> (per 1 EUR) -> per 1 USD
function parseEcb(xml) {
  const date = (String(xml).match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1];
  const perEur = {};
  for (const m of String(xml).matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"](\d{1,9}(?:\.\d{1,8})?)['"]/g)) perEur[m[1]] = Number(m[2]);
  if (!date || !sane(perEur.USD)) throw new Error('ECB: unexpected format');
  const rates = { EUR: round(1 / perEur.USD) };
  for (const c of AUTO_CODES) if (c !== 'EUR' && sane(perEur[c])) rates[c] = round(perEur[c] / perEur.USD);
  return { date, rates };
}

function parseMarket(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('ExchangeRate-API: not JSON'); }
  if (!j || j.result !== 'success' || j.base_code !== 'USD' || !j.rates || typeof j.rates !== 'object') throw new Error('ExchangeRate-API: unexpected format');
  const rates = {};
  for (const c of Acc.CODES) if (c !== 'USD' && sane(j.rates[c])) rates[c] = round(j.rates[c]);
  const date = Number.isFinite(j.time_last_update_unix) ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : null;
  return { date, rates };
}

// Whatever is stored (including the older all-manual shape) -> the current shape
function normalize(v) {
  const s = v && typeof v === 'object' ? v : {};
  if (!s.auto && s.rates) {
    // Before automatic rates every rate was typed in: keep the ZiG one as the manual rate
    const manual = {};
    if (sane(s.rates.ZWG)) manual.ZWG = { rate: s.rates.ZWG, by: s.updated_by || null, at: s.updated_at || null };
    return { auto: { rates: {}, sources: {} }, manual, hints: {} };
  }
  return {
    auto: { rates: {}, sources: {}, ...(s.auto || {}) },
    manual: { ...(s.manual || {}) },
    hints: { ...(s.hints || {}) },
  };
}

const load = async () => normalize(await db.getSetting(KEY));
const manualCodes = (s) => [...MANUAL, ...AUTO_CODES.filter((c) => !sane(s.auto.rates[c]))];
const isDue = (s, now = new Date()) => {
  const at = s.auto.at ? new Date(s.auto.at).getTime() : 0;
  const tried = s.auto.tried_at ? new Date(s.auto.tried_at).getTime() : 0;
  return now.getTime() - at >= REFRESH_MS && now.getTime() - tried >= RETRY_MS;
};

// What the converter needs: one merged list of rates, and where each came from
function view(s, now = new Date()) {
  const rates = {}; const sources = {};
  for (const c of AUTO_CODES) if (sane(s.auto.rates[c])) { rates[c] = s.auto.rates[c]; sources[c] = s.auto.sources[c] || 'auto'; }
  const allowed = manualCodes(s);
  for (const c of allowed) if (s.manual[c] && sane(s.manual[c].rate)) { rates[c] = s.manual[c].rate; sources[c] = 'manual'; }
  const next = s.auto.at ? new Date(new Date(s.auto.at).getTime() + REFRESH_MS).toISOString() : null;
  return {
    rates, sources, manualCodes: allowed,
    manual: Object.fromEntries(Object.entries(s.manual).filter(([c]) => allowed.includes(c)).map(([c, m]) => [c, { by: m.by, at: m.at }])),
    auto: {
      at: s.auto.at || null, next_at: next, ecb_date: s.auto.ecb_date || null, market_date: s.auto.market_date || null,
      error: s.auto.error || null, stale: !!(s.auto.at && now - new Date(s.auto.at) > 36 * 3600 * 1000), off: autoOff(),
    },
    hints: s.hints,
    sourceInfo: SOURCES,
  };
}

// Fetch both feeds and store the result. Only one refresh at a time.
let running = null;
function refresh({ now = new Date(), force = false } = {}) {
  if (autoOff()) return load();
  if (running) return running;
  running = (async () => {
    const s = await load();
    if (force) {
      const gap = s.auto.tried_at ? now - new Date(s.auto.tried_at) : Infinity;
      if (gap >= 0 && gap < FORCE_GAP_MS) return s; // a "last tried" in the future (clock change) doesn't block it
    } else if (!isDue(s, now)) return s;
    const [ecb, market] = await Promise.allSettled([get(ECB_URL).then(parseEcb), get(MARKET_URL).then(parseMarket)]);
    const errors = [];
    if (ecb.status === 'rejected') errors.push(`ECB: ${ecb.reason.message.replace(/^ECB: /, '')}`);
    if (market.status === 'rejected') errors.push(`ExchangeRate-API: ${market.reason.message.replace(/^ExchangeRate-API: /, '')}`);
    const E = ecb.status === 'fulfilled' ? ecb.value : null;
    const M = market.status === 'fulfilled' ? market.value : null;
    const at = now.toISOString();
    if (!E && !M) {
      s.auto = { ...s.auto, tried_at: at, error: errors.join(' · ') };
    } else {
      const rates = {}; const sources = {};
      for (const c of AUTO_CODES) {
        if (E && sane(E.rates[c])) { rates[c] = E.rates[c]; sources[c] = 'ECB'; } else if (M && sane(M.rates[c])) { rates[c] = M.rates[c]; sources[c] = 'ExchangeRate-API'; } else if (sane(s.auto.rates[c])) { rates[c] = s.auto.rates[c]; sources[c] = s.auto.sources[c]; } // keep the last good one
      }
      s.auto = { rates, sources, at, tried_at: at, ecb_date: E ? E.date : s.auto.ecb_date || null, market_date: M ? M.date : s.auto.market_date || null, error: errors.join(' · ') || null };
      if (M && sane(M.rates.ZWG)) s.hints = { ...s.hints, ZWG: { rate: M.rates.ZWG, date: M.date, source: 'ExchangeRate-API' } };
    }
    await db.setSetting(KEY, s);
    if (errors.length) console.warn(`Currency rates: ${errors.join(' · ')}`);
    return s;
  })().finally(() => { running = null; });
  return running;
}

// An admin sets ZiG (or a currency with no automatic rate). A blank value removes it.
async function setManual(input, by, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, 'Send the rates as a list of currencies.');
  const s = await load();
  const allowed = manualCodes(s);
  const blanks = Object.keys(input).filter((k) => input[k] === '' || input[k] === null);
  const values = Object.fromEntries(Object.entries(input).filter(([k]) => !blanks.includes(k)));
  let clean;
  try { clean = Acc.cleanRates(values); } catch (e) { throw httpError(400, e.message); }
  for (const c of [...Object.keys(clean), ...blanks]) {
    if (!Acc.CODES.includes(c) || c === 'USD') throw httpError(400, `${String(c).slice(0, 12)} isn't a currency this converter knows.`);
    if (!allowed.includes(c)) throw httpError(400, `${c} is updated automatically (${s.auto.sources[c] || 'feed'}). Only ${allowed.join(', ')} can be set by hand right now.`);
  }
  for (const c of blanks) delete s.manual[c];
  for (const [c, rate] of Object.entries(clean)) s.manual[c] = { rate, by: by || null, at: now.toISOString() };
  await db.setSetting(KEY, s);
  return s;
}

module.exports = { KEY, REFRESH_MS, MANUAL, AUTO_CODES, SOURCES, ECB_URL, MARKET_URL, parseEcb, parseMarket, normalize, load, view, isDue, refresh, setManual };
