// Accessory: Currency converter. USD, ZiG, rand and your other clients' currencies, per 1 USD.
// Rates come from the server (/api/admin/fx-rates, lib/fxRates.js) and are shared by every admin:
//   - automatic, refreshed every 12 hours: European Central Bank reference rates (official) for
//     EUR, GBP, ZAR, MYR, SGD, and ExchangeRate-API's open feed for the rest
//   - ZiG is set by an admin (the feed's figure is offered as a hint), as is any currency whose
//     feed is down. Each rate shows where it came from.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { load, save, esc } = A;
  const KEY = 'aw.fx';
  const MANUAL_STALE_DAYS = 7;
  const short = (code) => (code === 'ZWG' ? 'ZiG' : code);
  const fmt = (n, code) => (n === null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: code === 'USD' || Math.abs(n) >= 1 ? 2 : 6 }));
  const day = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const TAG = { ECB: 'ECB', 'ExchangeRate-API': 'MKT', manual: 'SET', auto: 'AUTO' };

  A.register({
    id: 'fx',
    name: 'Currency converter',
    short: 'FX',
    desc: 'USD, ZiG, rand and more. Rates update every 12 hours; you set ZiG.',
    model: 'AW-FX',
    label: 'currency',
    width: 300,
    icon: '<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="15" r="5.5"/><path d="M9 6.5v5M15 12.5v5"/>',
    defaultPos: (w, h) => ({ x: Math.round(window.innerWidth / 2 - w / 2), y: window.innerHeight - h - 24 }),

    build(win) {
      const prefs = { amount: '100', from: 'USD', to: 'ZWG', ...load(KEY, {}) };
      let data = { rates: {}, sources: {}, manualCodes: ['ZWG'], manual: {}, auto: {}, hints: {}, sourceInfo: {} };
      let editing = false;
      let loaded = false;

      win.body.innerHTML = `
        <label class="fx-lcd">
          <span class="fx-code" data-code="from"></span>
          <input type="text" inputmode="decimal" class="fx-amount" aria-label="Amount" autocomplete="off" maxlength="16">
        </label>
        <div class="fx-pickers">
          <select class="fx-sel" data-sel="from" aria-label="From currency"></select>
          <button type="button" class="calc-key fn fx-swap" data-fx="swap" aria-label="Swap currencies" title="Swap">⇄</button>
          <select class="fx-sel" data-sel="to" aria-label="To currency"></select>
        </div>
        <div class="fx-result" aria-live="polite">
          <span class="fx-result-value"></span>
          <span class="fx-rate"></span>
        </div>
        <div class="fx-paper">
          <ul class="fx-all"></ul>
          <div class="fx-edit hidden">
            <p class="fx-edit-help"></p>
            <div class="fx-grid"></div>
            <div class="fx-edit-keys">
              <button type="button" class="calc-key fn" data-fx="cancel">Cancel</button>
              <button type="button" class="calc-key eq" data-fx="save">Save</button>
            </div>
          </div>
          <div class="fx-meta"></div>
        </div>
        <button type="button" class="calc-key vat fx-edit-btn" data-fx="edit"></button>`;

      const $ = (s) => win.body.querySelector(s);
      const amountEl = $('.fx-amount');
      win.focusTarget = () => amountEl;
      const have = (code) => code === 'USD' || !!data.rates[code];

      function options(selected) {
        return Core.CURRENCIES.map(([c, n]) => `<option value="${c}"${c === selected ? ' selected' : ''}${have(c) ? '' : ' disabled'}>${short(c)} · ${esc(n)}${have(c) ? '' : ' (no rate)'}</option>`).join('');
      }

      // Amounts are read as text first: "" must not become 0 (DEVELOPMENT.md #7)
      const amount = () => { const t = amountEl.value.replace(/[\s,]/g, ''); return /^\d{0,12}(\.\d{0,6})?$/.test(t) && t !== '' && t !== '.' ? Number(t) : null; };

      // Where one currency's rate came from, in a few words
      function sourceOf(code) {
        if (code === 'USD') return '';
        const src = data.sources[code];
        if (src === 'manual') { const m = data.manual[code] || {}; return `${short(code)} set by ${m.by || 'an admin'}, ${day(m.at)}`; }
        if (src === 'ECB') return `${short(code)}: ECB reference rate, ${day(data.auto.ecb_date)}`;
        if (src === 'ExchangeRate-API') return `${short(code)}: market rate, ${day(data.auto.market_date)}`;
        return '';
      }
      const manualAge = (code) => { const m = data.manual[code]; return m && m.at ? Math.floor((Date.now() - new Date(m.at)) / 86400000) : null; };

      function render() {
        $('[data-sel="from"]').innerHTML = options(prefs.from);
        $('[data-sel="to"]').innerHTML = options(prefs.to);
        $('[data-code="from"]').textContent = short(prefs.from);
        const a = amount();
        const out = a === null ? null : Core.convert(a, prefs.from, prefs.to, data.rates);
        const missing = [prefs.from, prefs.to].find((c) => !have(c));
        $('.fx-result-value').textContent = out === null
          ? (a === null ? 'Type an amount' : !loaded ? 'Loading rates…' : `Set a ${short(missing || prefs.to)} rate first`)
          : `${fmt(out, prefs.to)} ${short(prefs.to)}`;
        const one = Core.convert(1, prefs.from, prefs.to, data.rates);
        const srcLine = [sourceOf(prefs.from), sourceOf(prefs.to)].filter(Boolean).join(' · ');
        $('.fx-rate').innerHTML = one === null ? '' : `1 ${short(prefs.from)} = ${fmt(one, prefs.to)} ${short(prefs.to)}${srcLine ? `<small>${esc(srcLine)}</small>` : ''}`;

        // The same amount in every currency that has a rate, tagged with its source
        const others = Core.CODES.filter((c) => c !== prefs.from && c !== prefs.to && have(c));
        $('.fx-all').innerHTML = a === null ? '' : others.map((c) => `<li title="${esc(sourceOf(c))}"><span>${short(c)}</span><i class="fx-tag fx-tag-${esc((TAG[data.sources[c]] || '').toLowerCase())}">${esc(TAG[data.sources[c]] || '')}</i><strong>${fmt(Core.convert(a, prefs.from, c, data.rates), c)}</strong></li>`).join('');

        // Footer: where the automatic rates came from, when they update, and any warnings
        const au = data.auto || {}; const info = data.sourceInfo || {};
        const link = (k, label) => (info[k] ? `<a href="${esc(info[k].url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label));
        const lines = [];
        if (au.at) {
          lines.push(`Auto-updated every 12 hours from ${link('ECB', 'ECB')} (official) and ${link('ExchangeRate-API', 'ExchangeRate-API')}. Last ${esc(day(au.at))} ${esc(time(au.at))}${au.next_at ? `, next about ${esc(time(au.next_at))}` : ''}. <button type="button" class="fx-link" data-fx="refresh">Refresh now</button>`);
        } else if (au.off) {
          lines.push('Automatic rates are switched off on this server.');
        } else {
          lines.push(`Automatic rates haven’t loaded yet. <button type="button" class="fx-link" data-fx="refresh">Try now</button>`);
        }
        if (au.stale) lines.push('<span class="fx-stale">Automatic rates are over a day old</span>');
        if (au.error) lines.push(`<span class="fx-warn">Last fetch: ${esc(au.error)}</span>`);
        const zAge = manualAge('ZWG');
        if (!data.rates.ZWG) lines.push('<span class="fx-warn">ZiG has no rate yet: set it below.</span>');
        else if (zAge >= MANUAL_STALE_DAYS) lines.push(`<span class="fx-stale">ZiG rate is ${zAge} days old</span>`);
        $('.fx-meta').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
        const codes = data.manualCodes || ['ZWG'];
        $('[data-fx="edit"]').textContent = codes.length === 1 ? `Set ${short(codes[0])} rate` : `Set ${codes.map(short).join(', ')}`;
        save(KEY, { amount: amountEl.value, from: prefs.from, to: prefs.to });
      }

      function showEdit(on) {
        editing = on;
        $('.fx-edit').classList.toggle('hidden', !on);
        $('.fx-all').classList.toggle('hidden', on);
        $('[data-fx="edit"]').classList.toggle('hidden', on);
        if (!on) return;
        const codes = data.manualCodes || ['ZWG'];
        $('.fx-edit-help').innerHTML = `Rates per <strong>1 USD</strong>.${codes.length > 1 ? ' These have no automatic rate right now.' : ''} Leave blank to remove.`;
        $('.fx-grid').innerHTML = codes.map((c) => {
          const name = (Core.CURRENCIES.find((x) => x[0] === c) || [c, c])[1];
          const hint = data.hints && data.hints[c];
          const current = data.sources[c] === 'manual' && data.rates[c] ? String(data.rates[c]) : '';
          return `<label class="fx-man" title="${esc(name)}"><span>${short(c)}</span>
              <input type="text" inputmode="decimal" data-rate="${c}" value="${esc(current)}" placeholder="e.g. 26.85" maxlength="18" aria-label="${esc(name)} per 1 USD"></label>
            ${hint && hint.rate ? `<p class="fx-hint">Market feed: ${esc(String(hint.rate))} (${esc(day(hint.date))}). <button type="button" class="fx-link" data-use="${c}" data-val="${esc(String(hint.rate))}">Use this</button><br>Check it against the RBZ interbank rate you quote.</p>` : ''}`;
        }).join('');
        const first = $('[data-rate]'); if (first) first.focus();
      }

      async function call(method, url, body) {
        const r = await fetch(url, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Could not reach the rates.');
        return j;
      }

      async function saveRates() {
        const rates = {};
        win.body.querySelectorAll('[data-rate]').forEach((i) => { rates[i.dataset.rate] = i.value.replace(/[\s,]/g, ''); });
        const typed = Object.fromEntries(Object.entries(rates).filter(([, v]) => v));
        try { Core.cleanRates(typed); } catch (e) { A.toast(e.message); return; }
        try {
          data = await call('PUT', '/api/admin/fx-rates', { rates });
          showEdit(false); checkPair(); render(); A.toast('Saved for the whole team.');
        } catch (e) { A.toast(e.message); }
      }

      function checkPair() {
        if (!have(prefs.from)) prefs.from = 'USD';
        // No rate for "to": pick one that has a rate, or stay on ZiG so the result asks for one
        if (!have(prefs.to) || prefs.to === prefs.from) prefs.to = Core.CODES.find((c) => c !== prefs.from && have(c)) || (prefs.from === 'USD' ? 'ZWG' : 'USD');
      }

      async function loadRates() {
        try { data = await call('GET', '/api/admin/fx-rates'); } catch { /* offline: keep what we have */ }
        loaded = true; checkPair(); render();
      }

      async function refreshNow() {
        $('.fx-meta').innerHTML = '<p>Fetching the latest rates…</p>';
        try { data = await call('POST', '/api/admin/fx-rates/refresh'); } catch (e) { A.toast(e.message); }
        checkPair(); render();
      }

      amountEl.value = String(prefs.amount || '');
      amountEl.addEventListener('input', render);
      win.body.addEventListener('change', (e) => {
        const s = e.target.closest('[data-sel]');
        if (s) { prefs[s.dataset.sel] = s.value; render(); }
      });
      win.body.addEventListener('click', (e) => {
        const u = e.target.closest('[data-use]');
        if (u) { const i = win.body.querySelector(`[data-rate="${u.dataset.use}"]`); if (i) { i.value = u.dataset.val; i.focus(); } return; }
        const b = e.target.closest('[data-fx]');
        if (!b) return;
        const act = b.dataset.fx;
        if (act === 'swap') { [prefs.from, prefs.to] = [prefs.to, prefs.from]; render(); }
        if (act === 'edit') showEdit(true);
        if (act === 'cancel') showEdit(false);
        if (act === 'save') saveRates();
        if (act === 'refresh') refreshNow();
      });
      win.body.addEventListener('keydown', (e) => {
        if (editing && e.key === 'Enter' && e.target.closest('[data-rate]')) { e.preventDefault(); saveRates(); }
      });

      win.onOpen.push(() => loadRates());
      render();
    },
  });
})();
