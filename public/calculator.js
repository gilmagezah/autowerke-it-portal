// Accessory: retro desk calculator with VAT keys and a history of answers.
// The maths lives in calc-core.js; the window, dragging and pinning in accessories.js.
//
// The screen and history are kept in this browser (localStorage) so they follow you between
// admin pages. It's a scratchpad, not a record. Storage can be blocked; it still works.
(function () {
  const Core = window.CalcCore;
  const A = window.Accessories;
  if (!Core || !A) return;

  const KEY = { state: 'aw.calc.state', history: 'aw.calc.history' };
  const MAX_HISTORY = 50;
  const { load, save, esc, svg } = A;

  const KEYS = [
    ['C', 'C', 'fn'], ['back', '⌫', 'fn', 'Delete last'], ['%', '%', 'fn'], ['/', '÷', 'op', 'Divide'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×', 'op', 'Multiply'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', 'op', 'Minus'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op', 'Plus'],
    ['neg', '±', 'fn', 'Plus or minus'], ['0', '0'], ['.', '.'], ['=', '=', 'eq', 'Equals'],
  ];

  A.register({
    id: 'calc',
    name: 'Calculator',
    short: 'Calc',
    desc: 'Totals, VAT and workings, with a history of answers.',
    model: 'AW-155',
    label: 'calculator',
    width: 236,
    defaultPos: (w, h) => ({ x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 }),
    icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="8" y="6" width="8" height="3.5" rx=".6"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/>',

    build(win) {
      let vatRate = 15.5;
      let state = { ...Core.EMPTY, ...load(KEY.state, {}) };
      let history = Array.isArray(load(KEY.history, [])) ? load(KEY.history, []).slice(0, MAX_HISTORY) : [];
      const el = win.el;

      win.extra.innerHTML = `<button type="button" class="acc-icon" data-act="history" aria-pressed="false" title="History" aria-label="History">
        ${svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4h4"/><path d="M12 8v4l3 2"/>', 1.8)}</button>`;
      win.body.innerHTML = `
        <button type="button" class="calc-lcd" data-act="copy" title="Click to copy the number">
          <span class="calc-label" data-label></span>
          <span class="calc-value" data-value aria-live="polite">0</span>
          <span class="calc-flash" data-flash aria-hidden="true">COPIED</span>
        </button>
        <div class="calc-body">
          <div class="calc-vat">
            <button type="button" class="calc-key vat" data-key="vat+" title="Add VAT">+VAT</button>
            <button type="button" class="calc-key vat" data-key="vat-" title="Remove VAT from a VAT-inclusive amount">EX VAT</button>
          </div>
          <div class="calc-keys">
            ${KEYS.map(([k, t, kind = 'num', label]) => `<button type="button" class="calc-key ${kind}" data-key="${esc(k)}"${label ? ` aria-label="${esc(label)}"` : ''}>${esc(t)}</button>`).join('')}
          </div>
          <div class="calc-history hidden" data-history>
            <div class="calc-history-head">
              <span>History</span>
              <button type="button" class="calc-link" data-act="clear-history">Clear</button>
            </div>
            <ol data-history-list></ol>
          </div>
        </div>`;

      const $ = (sel) => el.querySelector(sel);
      const valueEl = $('[data-value]');
      const labelEl = $('[data-label]');
      const histEl = $('[data-history]');
      const histBtn = $('[data-act="history"]');

      function render() {
        const text = state.error ? state.error : (state.expr ? Core.formatExpr(state.expr) : '0');
        valueEl.textContent = text;
        valueEl.classList.toggle('err', !!state.error);
        // Long numbers shrink to fit instead of running off the screen
        const len = text.length;
        valueEl.dataset.size = len > 22 ? 'xs' : len > 16 ? 's' : len > 11 ? 'm' : '';
        labelEl.textContent = state.label || '';
        save(KEY.state, { expr: state.expr, label: state.label, fresh: state.fresh });
      }

      function renderHistory() {
        const list = $('[data-history-list]');
        if (!history.length) { list.innerHTML = '<li class="calc-empty">Nothing yet. Answers appear here.</li>'; return; }
        list.innerHTML = history.map((h, i) => `
          <li><button type="button" class="calc-hist-item" data-recall="${i}" title="Use this answer">
            <span class="calc-hist-expr">${esc(h.expr)}</span>
            <span class="calc-hist-result">= ${esc(Core.format(h.result))}</span>
          </button></li>`).join('');
      }

      function showHistory(open) {
        histEl.classList.toggle('hidden', !open);
        histBtn.setAttribute('aria-pressed', String(open));
        if (open) renderHistory();
      }

      function press(key) {
        const out = Core.press(state, key, { vatRate });
        state = out.state;
        if (out.entry) {
          history.unshift({ ...out.entry, at: Date.now() });
          history = history.slice(0, MAX_HISTORY);
          save(KEY.history, history);
          if (!histEl.classList.contains('hidden')) renderHistory();
        }
        render();
      }

      async function copyValue() {
        if (state.error) return;
        // The plain number (no separators) so it pastes cleanly into a price or hours field.
        // Half-typed sums copy their answer.
        let text;
        try { text = String(Core.evaluate(state.expr.replace(/[-+*/.]+$/, '') || '0')); } catch { return; }
        try {
          await navigator.clipboard.writeText(text);
          const f = $('[data-flash]');
          f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
        } catch { /* clipboard blocked: nothing to do */ }
      }

      el.addEventListener('click', (e) => {
        const k = e.target.closest('[data-key]');
        if (k) { press(k.dataset.key); return; }
        const r = e.target.closest('[data-recall]');
        if (r) {
          const h = history[Number(r.dataset.recall)];
          if (h) { state = { ...Core.recall(h.result), label: `${h.expr} =` }; render(); showHistory(false); }
          return;
        }
        const act = e.target.closest('[data-act]');
        if (!act) return;
        if (act.dataset.act === 'history') showHistory(histEl.classList.contains('hidden'));
        if (act.dataset.act === 'clear-history') { history = []; save(KEY.history, history); renderHistory(); }
        if (act.dataset.act === 'copy') copyValue();
      });

      // Typing works while the calculator has focus (click it once), so it never steals keys
      // from the page's own fields
      const KEYMAP = { Enter: '=', '=': '=', Backspace: 'back', Delete: 'C', Escape: 'C', x: '*', X: '*', '×': '*', '÷': '/' };
      el.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.target === win.head) return;
        const k = KEYMAP[e.key] || (/^[\d.+\-*/%]$/.test(e.key) ? e.key : null);
        if (!k) return;
        e.preventDefault(); // stops Enter on a focused key also "clicking" it
        press(k);
        const b = el.querySelector(`[data-key="${CSS.escape(k)}"]`);
        if (b) { b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 110); }
      });

      // The VAT rate comes from the server (VAT_RATE), so the calculator matches invoices
      A.me.then((me) => {
        if (Number.isFinite(Number(me.vatRate))) vatRate = Number(me.vatRate);
        $('[data-key="vat+"]').title = `Add VAT at ${vatRate}%`;
        $('[data-key="vat-"]').title = `Remove VAT (${vatRate}%) from a VAT-inclusive amount`;
      });

      render();
    },
  });
})();
