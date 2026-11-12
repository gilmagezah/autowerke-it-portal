// The admin calculator's maths: a tiny parser (no eval: the CSP forbids it, and it only ever
// accepts the calculator's own keys) plus the key-press logic. Loaded by the browser
// (calculator.js) AND by Node (tests/calculator.test.js), so what's tested is what runs.
//
// Expressions use + - * / and a postfix %. Percent works the way a desk calculator does:
//   200 + 10%  -> 220   (10% of 200, added)
//   200 * 10%  -> 20    (10% is 0.1)
//   50%        -> 0.5

(function (root) {
  const OPS = '+-*/';
  const SHOW = { '*': '×', '/': '÷', '-': '−' };

  // Floating point tidy-up: 0.1 + 0.2 shows 0.3, not 0.30000000000000004
  const tidy = (n) => (n === 0 ? 0 : Number(n.toPrecision(12)));
  const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  function tokenize(expr) {
    const tokens = String(expr).match(/\d+\.?\d*|\.\d+|[-+*/%]/g) || [];
    if (tokens.join('') !== String(expr).replace(/\s/g, '')) throw new Error('Invalid input');
    return tokens;
  }

  function evaluate(expr) {
    const t = tokenize(expr);
    let i = 0;
    const fail = () => { throw new Error('Invalid input'); };

    // factor := '-'* number '%'?
    function factor() {
      let sign = 1;
      while (t[i] === '-' || t[i] === '+') { if (t[i] === '-') sign = -sign; i++; }
      if (t[i] === undefined || /[-+*/%]/.test(t[i])) fail();
      let v = sign * parseFloat(t[i++]);
      let pct = false;
      if (t[i] === '%') { pct = true; i++; }
      return { v, pct };
    }
    // term := factor (('*' | '/') factor)*. A lone percent stays flagged so + and - can use it.
    function term() {
      let f = factor();
      if (t[i] !== '*' && t[i] !== '/') return f;
      let v = f.pct ? f.v / 100 : f.v;
      while (t[i] === '*' || t[i] === '/') {
        const op = t[i++];
        f = factor();
        const r = f.pct ? f.v / 100 : f.v;
        if (op === '/' && r === 0) throw new Error("Can't divide by 0");
        v = op === '*' ? v * r : v / r;
      }
      return { v, pct: false };
    }
    // expr := term (('+' | '-') term)*
    let first = term();
    let v = first.pct ? first.v / 100 : first.v;
    while (t[i] === '+' || t[i] === '-') {
      const op = t[i++];
      const r = term();
      const rv = r.pct ? (v * r.v) / 100 : r.v;
      v = op === '+' ? v + rv : v - rv;
    }
    if (i !== t.length) fail();
    if (!Number.isFinite(v) || Math.abs(v) >= 1e15) throw new Error('Too big');
    return tidy(v);
  }

  // 1234567.5 -> "1,234,567.5"; very large or tiny numbers fall back to scientific notation
  function format(n) {
    if (!Number.isFinite(n)) return 'Error';
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toPrecision(8).replace('e+', 'e');
    return n.toLocaleString('en-US', { maximumFractionDigits: 10 });
  }

  // The expression as typed, made readable: thousands separators and proper symbols.
  // Keeps a trailing "." or trailing zeros so "12.50" shows exactly what you typed.
  function formatExpr(expr) {
    return String(expr).replace(/\d+\.?\d*|\.\d+|[-*/]/g, (tok) => {
      if (SHOW[tok]) return ` ${SHOW[tok]} `;
      const [int, frac] = tok.split('.');
      const grouped = (int || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return frac === undefined ? grouped : `${grouped}.${frac}`;
    }).replace(/\+/g, ' + ').replace(/\s+/g, ' ').trim();
  }

  // A number as keypad text the parser can read back ("0.0000001", never "1e-7")
  function plain(n) {
    if (!Number.isFinite(n) || Math.abs(n) < 1e-10) return '0';
    const s = String(tidy(n));
    return /e/.test(s) ? n.toFixed(10).replace(/\.?0+$/, '') : s;
  }
  const LIMIT = 1e15;
  const lastNumber = (expr) => (String(expr).match(/(\d+\.?\d*|\.\d+)$/) || [''])[0];

  // State: { expr, label, fresh, error }
  //   expr  - what's on the main line (always a valid-so-far expression in + - * / % form)
  //   label - the small line above it after "=" (e.g. "1,000 + VAT 15.5%")
  //   fresh - true right after "=": a digit starts again, an operator carries the answer on
  //   error - a message to show instead of a number
  const EMPTY = { expr: '', label: '', fresh: false, error: '' };

  // press(state, key, { vatRate }) -> { state, entry } where entry is a new history line or null
  function press(state, key, opts = {}) {
    const vatRate = Number.isFinite(opts.vatRate) ? opts.vatRate : 15.5;
    let s = { ...EMPTY, ...state };
    if (s.error) s = { ...EMPTY };
    const done = (next, entry = null) => ({ state: { ...EMPTY, ...next }, entry });

    if (key === 'C') return done(EMPTY);

    // The value the screen stands for right now (ignoring a dangling operator)
    const current = () => {
      const e = s.expr.replace(/[-+*/]+$/, '');
      return e ? evaluate(e) : 0;
    };

    try {
      if (/^\d$/.test(key) || key === '.') {
        if (s.fresh) s = { ...EMPTY };
        const num = lastNumber(s.expr);
        if (s.expr.endsWith('%')) return done({ ...s, expr: `${s.expr}*${key === '.' ? '0.' : key}` });
        if (key === '.') {
          if (num.includes('.')) return done(s);
          return done({ ...s, expr: s.expr + (num ? '.' : '0.') });
        }
        if (num === '0') return done({ ...s, expr: s.expr.slice(0, -1) + key }); // no leading zeros
        if (num.replace('.', '').length >= 15) return done(s); // a sensible limit per number
        return done({ ...s, expr: s.expr + key });
      }

      if (OPS.includes(key)) {
        let e = s.expr;
        if (!e) return done(key === '-' ? { expr: '-' } : s);
        if (e === '-') return done(s);
        if (/[-+*/]$/.test(e)) e = e.slice(0, -1);
        if (e.endsWith('.')) e = e.slice(0, -1);
        return done({ expr: e + key });
      }

      if (key === '%') {
        if (!/\d\.?$/.test(s.expr)) return done(s);
        return done({ ...s, expr: s.expr.replace(/\.$/, '') + '%', fresh: false, label: '' });
      }

      if (key === 'back') {
        if (s.fresh) return done({ ...s, label: '', fresh: false });
        return done({ ...s, expr: s.expr.slice(0, -1) });
      }

      if (key === 'neg') {
        // Flip the sign of the number being typed (or of the answer)
        const m = s.expr.match(/(^|[-+*/])(-?)(\d+\.?\d*|\.\d+)(%?)$/);
        if (!m) return done(s);
        const head = s.expr.slice(0, s.expr.length - m[0].length) + m[1];
        return done({ ...s, expr: `${head}${m[2] ? '' : '-'}${m[3]}${m[4]}` });
      }

      if (key === '=') {
        const e = s.expr.replace(/[-+*/.]+$/, '');
        if (!e || e === '-' || s.fresh) return done(s);
        const v = evaluate(e);
        const label = formatExpr(e);
        return done({ expr: plain(v), label: `${label} =`, fresh: true }, { expr: label, result: v });
      }

      if (key === 'vat+' || key === 'vat-') {
        const base = current();
        const rate = `${vatRate}%`;
        let v; let label;
        if (key === 'vat+') {
          const vat = money(base * vatRate / 100);
          v = money(base + vat);
          label = `${format(base)} + VAT ${rate} (${format(vat)})`;
        } else {
          v = money(base / (1 + vatRate / 100));
          label = `${format(base)} excl. VAT ${rate} (VAT ${format(money(base - v))})`;
        }
        if (Math.abs(v) >= LIMIT) throw new Error('Too big');
        return done({ expr: plain(v), label: `${label} =`, fresh: true }, { expr: label, result: v });
      }
    } catch (err) {
      return done({ error: err.message === "Can't divide by 0" || err.message === 'Too big' ? err.message : 'Error' });
    }
    return done(s);
  }

  // Load a number (e.g. from history) onto the screen as a fresh answer
  const recall = (n) => ({ ...EMPTY, expr: plain(n), fresh: true });

  const api = { evaluate, format, formatExpr, press, recall, EMPTY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalcCore = api;
})(typeof window !== 'undefined' ? window : this);
