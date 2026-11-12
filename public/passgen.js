// Accessory: Password generator. Strong passwords or passphrases for new Microsoft 365 users,
// admin accounts and Wi-Fi. Made in this browser with its cryptographic random generator
// (acc-core.js): never stored, never sent anywhere, gone when the window closes.
// Only your settings (length, which characters) are remembered.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { load, save } = A;
  const KEY = 'aw.passgen';

  A.register({
    id: 'pass',
    name: 'Password generator',
    short: 'Pass',
    desc: 'Strong passwords and passphrases. Never stored or sent.',
    model: 'AW-PASS',
    label: 'passwords',
    width: 290,
    icon: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2.5"/>',
    defaultPos: (w) => ({ x: Math.round(window.innerWidth / 2 - w - 10), y: Math.round(window.innerHeight * 0.18) }),

    build(win) {
      const opts = {
        mode: 'password', length: 16, upper: true, lower: true, digits: true, symbols: true, avoidSimilar: true,
        words: 5, separator: '-', capitalise: true, number: true,
        ...load(KEY, {}),
      };
      let current = '';

      win.body.innerHTML = `
        <button type="button" class="pg-lcd" data-pg="copy" title="Click to copy">
          <span class="pg-value" aria-live="polite"></span>
          <span class="pg-flash" aria-hidden="true">COPIED</span>
        </button>
        <div class="pg-meter"><span class="pg-bar"><span></span></span><span class="pg-strength"></span></div>
        <div class="pg-tabs" role="radiogroup" aria-label="Kind">
          <button type="button" role="radio" data-mode="password">Password</button>
          <button type="button" role="radio" data-mode="phrase">Passphrase</button>
        </div>
        <div class="pg-paper">
          <div data-panel="password">
            <label class="pg-range"><span>Length <strong data-out="length"></strong></span>
              <input type="range" min="12" max="40" step="1" data-opt="length" aria-label="Length"></label>
            <div class="pg-checks">
              <label><input type="checkbox" data-opt="upper"> A–Z</label>
              <label><input type="checkbox" data-opt="lower"> a–z</label>
              <label><input type="checkbox" data-opt="digits"> 0–9</label>
              <label><input type="checkbox" data-opt="symbols"> !@#$</label>
            </div>
            <label class="pg-check-wide"><input type="checkbox" data-opt="avoidSimilar"> Avoid look-alikes (I l 1 O 0)</label>
          </div>
          <div data-panel="phrase">
            <label class="pg-range"><span>Words <strong data-out="words"></strong></span>
              <input type="range" min="3" max="8" step="1" data-opt="words" aria-label="Number of words"></label>
            <div class="pg-checks">
              <label><input type="checkbox" data-opt="capitalise"> Capitals</label>
              <label><input type="checkbox" data-opt="number"> A number</label>
              <label class="pg-sep">Between
                <select data-opt="separator" aria-label="Between words">
                  <option value="-">-</option><option value=".">.</option><option value="_">_</option><option value=" ">space</option>
                </select></label>
            </div>
          </div>
        </div>
        <div class="pg-keys">
          <button type="button" class="calc-key eq" data-pg="new">New</button>
          <button type="button" class="calc-key op" data-pg="copy">Copy</button>
        </div>
        <p class="pg-foot">Made in this browser. Never stored or sent.</p>`;

      const $ = (s) => win.body.querySelector(s);
      const valueEl = $('.pg-value');
      win.focusTarget = () => $('[data-pg="new"]');

      function sync() {
        win.body.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === opts.mode)));
        win.body.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== opts.mode));
        win.body.querySelectorAll('[data-opt]').forEach((el) => {
          const v = opts[el.dataset.opt];
          if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
        });
        $('[data-out="length"]').textContent = opts.length;
        $('[data-out="words"]').textContent = opts.words;
      }

      function generate() {
        // Keep at least one character set on
        if (!['upper', 'lower', 'digits', 'symbols'].some((k) => opts[k])) opts.lower = true;
        const out = opts.mode === 'phrase' ? Core.generatePassphrase(opts) : Core.generatePassword(opts);
        current = out.value;
        valueEl.textContent = current;
        valueEl.dataset.size = current.length > 30 ? 's' : current.length > 22 ? 'm' : '';
        const pct = Math.min(100, Math.round((out.bits / 128) * 100));
        $('.pg-bar span').style.width = `${pct}%`;
        const label = Core.strength(out.bits);
        $('.pg-meter').dataset.level = label.toLowerCase().replace(' ', '-');
        $('.pg-strength').textContent = `${label} · ${out.bits} bits`;
      }

      async function copy() {
        try {
          await navigator.clipboard.writeText(current);
          const f = $('.pg-flash'); f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
        } catch { A.toast('Copy is blocked in this browser. Select the password and copy it instead.'); }
      }

      win.body.addEventListener('click', (e) => {
        const m = e.target.closest('[data-mode]');
        if (m) { opts.mode = m.dataset.mode; save(KEY, opts); sync(); generate(); return; }
        const b = e.target.closest('[data-pg]');
        if (b && b.dataset.pg === 'new') generate();
        if (b && b.dataset.pg === 'copy') copy();
      });
      win.body.addEventListener('input', (e) => {
        const el = e.target.closest('[data-opt]');
        if (!el) return;
        const k = el.dataset.opt;
        opts[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
        save(KEY, opts); sync(); generate();
      });

      // A fresh one every time it opens; the old one is forgotten when it closes
      win.onOpen.push(() => generate());
      win.onClose.push(() => { current = ''; valueEl.textContent = ''; });
      sync();
    },
  });
})();
