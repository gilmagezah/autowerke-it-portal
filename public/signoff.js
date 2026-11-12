const $ = (id) => document.getElementById(id);
const esc = (s = '') => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return `${dd} ${MON[m - 1]} ${y}`; };
const say = (t) => { $('msg').textContent = t || ''; };

const soPhone = window.PhoneInput ? PhoneInput(document.getElementById('phone')) : null;
let who = {};       // ref + email from step 1 (needed to check the code)
let data = null;    // the sign-off once verified
let timer = null;

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Something went wrong.');
  return out;
}

// ---------- Step 1: who are you ----------
const pre = new URLSearchParams(location.search).get('ref');
if (pre) $('ref').value = pre.toUpperCase();

$('idForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  who = { ref: $('ref').value.trim().toUpperCase(), email: $('email').value.trim(), name: $('name').value.trim(), phone: soPhone ? soPhone.value() : $('phone').value.trim() };
  if (!who.ref || !who.email || !who.name) return say('Please fill in your reference, email and name.');
  $('idBtn').disabled = true;
  say('');
  try {
    const r = await post('/api/signoff/identify', who);
    $('codeMsg').textContent = r.message;
    $('idForm').classList.add('hidden');
    $('codeStep').classList.remove('hidden');
    $('stepNo').textContent = '2';
    code.focus();
  } catch (err) {
    say(err.message);
  }
  $('idBtn').disabled = false;
});

// ---------- Step 2: the code ----------
const code = CodeInput($('codeBoxes'), 8, () => verify());
async function verify() {
  const v = code.value();
  if (v.length !== 8) return say('Enter all 8 characters.');
  $('codeBtn').disabled = true;
  code.disable(true);
  try {
    await post('/api/signoff/verify', { ref: who.ref, email: who.email, code: v });
    await openDocument();
  } catch (err) {
    say(err.message);
    code.disable(false);
    code.clear();
  }
  $('codeBtn').disabled = false;
}
$('codeBtn').addEventListener('click', verify);
$('resend').addEventListener('click', () => location.reload());

// ---------- Step 3: the document ----------
async function openDocument() {
  const res = await fetch('/api/signoff/session');
  data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not open your sign-off.');
  $('verifyView').classList.add('hidden');
  $('docView').classList.remove('hidden');
  render();
  startTimer();
}

function render() {
  const support = data.type === 'support';
  const sections = [
    ['overview', 'Overview'],
    support ? ['time', 'Time and cost'] : ['delivery', 'What was delivered'],
    ['terms', 'Terms'],
    ['payment', 'Purchase order / payment'],
    ['sign', 'Sign here to agree'],
  ];
  $('soNav').innerHTML = sections.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('');

  const timeHtml = support ? `
    <section class="so-section" id="time">
      <div class="so-band"><h2>Time and cost</h2><div class="band-sub">${data.billing.usedEstimate ? 'Billed at the approved estimate' : 'Every session we logged'}</div></div>
      <div class="so-body">
        ${(data.entries || []).length ? `<table class="so-ledger"><thead><tr><th>Date</th><th>Time</th><th>Work done</th></tr></thead><tbody>
          ${data.entries.map((e) => `<tr><td>${esc(day(e.date))}</td><td>${esc(e.start)}–${esc(e.end)}</td><td style="font-family:var(--sans);font-size:14px;">${esc(e.note || '—')}</td></tr>`).join('')}
        </tbody></table>` : ''}
        <table class="so-ledger">
          <tr><td>Hours</td><td class="r">${Number(data.billing.hours).toFixed(2)} h × ${money(data.billing.rate)}</td></tr>
          <tr><td>Subtotal</td><td class="r">${money(data.billing.subtotal)}</td></tr>
          ${data.billing.vat ? `<tr><td>VAT (${data.billing.vatRate}%)</td><td class="r">${money(data.billing.vat)}</td></tr>` : ''}
          <tr class="so-total"><td>Total</td><td class="r">${money(data.billing.total)}</td></tr>
        </table>
      </div>
    </section>` : `
    <section class="so-section" id="delivery">
      <div class="so-band"><h2>What was delivered</h2><div class="band-sub">${(data.phases || []).filter((p) => p.done).length} of ${(data.phases || []).length} phases complete</div></div>
      <div class="so-body">
        ${data.document.objectives.length ? `<h3>Objectives</h3><ul>${data.document.objectives.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
        ${(data.phases || []).length ? `<h3>Phases</h3><ul class="so-phases">${data.phases.map((p) => `<li><span class="tick">${p.done ? '✓' : '·'}</span><span>${esc(p.title)}</span><span>${esc(day(p.completed))}</span></li>`).join('')}</ul>` : ''}
        ${data.document.outstanding.length ? `<h3>Outstanding items</h3><ul>${data.document.outstanding.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
        ${data.document.recommendations.length ? `<h3>Recommendations</h3><ul>${data.document.recommendations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
        ${data.amount ? `<table class="so-ledger"><tr class="so-total"><td>Project value</td><td class="r">${money(data.amount)}</td></tr></table>` : ''}
      </div>
    </section>`;

  $('soMain').innerHTML = `
    <div class="so-warn" id="soWarn"></div>
    <section class="so-section" id="overview">
      <div class="so-band"><h2>${support ? 'IT Support' : 'Project'}<br>Sign-off</h2><div class="band-sub">${esc(data.ref)} · ${esc(data.company)}</div></div>
      <div class="so-body">
        <p><strong>Dear ${esc(data.contactName.split(' ')[0])},</strong></p>
        <p>${support
          ? `The work on your support ticket${data.title ? ` <strong>${esc(data.title)}</strong>` : ''} is complete. Below is every session we logged and the final cost.`
          : `All phases of <strong>${esc(data.title || 'your project')}</strong> are complete. ${esc(data.document.introduction || '')}`}</p>
        <p>Please review everything, tick the statements under <strong>Terms</strong>, add a purchase order or proof of payment if you have one, and sign at the end. It takes a few minutes.</p>
        <p><a href="/api/signoff/document" target="_blank" rel="noopener">Open the full sign-off document (PDF)</a></p>
      </div>
    </section>
    ${timeHtml}
    <section class="so-section" id="terms">
      <div class="so-band"><h2>Terms</h2><div class="band-sub">Tick each statement to continue</div></div>
      <div class="so-body so-checks">
        ${data.statements.map((t, i) => `<label><input type="checkbox" class="so-accept" data-i="${i}"><span>${esc(t)}</span></label>`).join('')}
      </div>
    </section>
    <section class="so-section" id="payment">
      <div class="so-band"><h2>Purchase order<br>or payment</h2><div class="band-sub">Optional · PDF, PNG or JPG · up to 3 files</div></div>
      <div class="so-body">
        <label>Purchase order number (optional)<input type="text" id="poNumber" maxlength="60" autocomplete="off"></label>
        <label>Upload a purchase order or proof of payment (optional)
          <input type="file" id="docs" accept="application/pdf,image/png,image/jpeg" multiple></label>
        <div class="so-docs-list" id="docsList"></div>
      </div>
    </section>
    <section class="so-section" id="sign">
      <div class="so-band"><h2>Sign here<br>to agree</h2><div class="band-sub">Your legal electronic signature</div></div>
      <div class="so-body">
        <div class="so-sign">
          <label>Your full name<input type="text" id="signName" value="${esc(data.contactName)}" autocomplete="name"></label>
          <div class="so-tabs" role="tablist">
            <button type="button" class="on" data-m="type">Sign by typing</button>
            <button type="button" data-m="draw">Sign by drawing</button>
            <button type="button" data-m="upload">Upload signature</button>
          </div>
          <div data-pane="type"><div class="so-typed" id="typedPreview"></div><div style="font-size:12px;color:var(--muted);">Your typed name will be used as your signature.</div></div>
          <div data-pane="draw" class="hidden">
            <div class="so-pad"><canvas id="pad"></canvas><div class="line"></div><div class="hint" id="padHint">Sign here with your mouse, finger or stylus</div></div>
            <button type="button" class="link-btn so-clear" id="padClear">Clear</button>
          </div>
          <div data-pane="upload" class="hidden">
            <label>Signature image (PNG or JPG, under 2 MB)<input type="file" id="sigFile" accept="image/png,image/jpeg"></label>
            <div class="so-sigpreview" id="sigPreview"></div>
          </div>
          <button type="button" class="btn-confirm so-submit" id="submit">Accept and sign</button>
          <p class="secure-msg" id="signMsg" role="alert"></p>
        </div>
      </div>
    </section>`;
  wireSign();
  spy();
}

// Highlight the section you're reading in the side nav
function spy() {
  const links = [...document.querySelectorAll('.so-nav a')];
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${en.target.id}`));
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('.so-section').forEach((s) => obs.observe(s));
}

// ---------- Signing ----------
let method = 'type';
let drawn = false;

function wireSign() {
  const nameEl = $('signName');
  const updateTyped = () => { $('typedPreview').textContent = nameEl.value; };
  nameEl.addEventListener('input', updateTyped);
  updateTyped();

  document.querySelectorAll('.so-tabs button').forEach((b) => b.addEventListener('click', () => {
    method = b.dataset.m;
    document.querySelectorAll('.so-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== method));
    if (method === 'draw') sizePad();
  }));

  // Drawing pad (pointer events: mouse, touch and pen)
  const canvas = $('pad');
  const ctx = canvas.getContext('2d');
  let down = false;
  let lastPt = null;
  window.sizePad = function () {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = r.width * scale;
    canvas.height = r.height * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1F2622';
    drawn = false;
    $('padHint').style.display = '';
  };
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { down = true; lastPt = pt(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    const p = pt(e);
    ctx.beginPath(); ctx.moveTo(lastPt.x, lastPt.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastPt = p;
    if (!drawn) { drawn = true; $('padHint').style.display = 'none'; }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => canvas.addEventListener(ev, () => { down = false; }));
  $('padClear').addEventListener('click', () => sizePad());

  $('sigFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    $('sigPreview').innerHTML = f ? `<img src="${URL.createObjectURL(f)}" alt="Your signature">` : '';
  });
  $('docs').addEventListener('change', (e) => {
    const files = [...e.target.files];
    $('docsList').textContent = files.length > 3 ? 'Please choose up to 3 files.' : files.map((f) => `📎 ${f.name}`).join('   ');
  });
  $('submit').addEventListener('click', submit);
}

async function submit() {
  const msg = (t) => { $('signMsg').textContent = t; };
  const accepts = [...document.querySelectorAll('.so-accept')];
  if (!accepts.every((c) => c.checked)) { msg('Please tick each statement under Terms.'); location.hash = '#terms'; return; }
  const name = $('signName').value.trim();
  if (name.length < 3) return msg('Type your full name.');
  if (method === 'draw' && !drawn) return msg('Draw your signature in the box, or choose another way to sign.');
  if (method === 'upload' && !$('sigFile').files[0]) return msg('Choose your signature image.');
  const docs = [...$('docs').files];
  if (docs.length > 3) return msg('Please attach up to 3 files.');

  const fd = new FormData();
  fd.append('payload', JSON.stringify({
    name, method, accept: accepts.map((c) => c.checked), po_number: $('poNumber').value,
    drawn: method === 'draw' ? $('pad').toDataURL('image/png') : null,
  }));
  if (method === 'upload') fd.append('signature', $('sigFile').files[0]);
  docs.forEach((f) => fd.append('documents', f));

  $('submit').disabled = true;
  $('submit').textContent = 'Signing...';
  msg('');
  try {
    const res = await fetch('/api/signoff/complete', { method: 'POST', body: fd });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Something went wrong.');
    clearInterval(timer);
    showDone(out);
  } catch (err) {
    msg(err.message);
    $('submit').disabled = false;
    $('submit').textContent = 'Accept and sign';
  }
}

function showDone(out) {
  $('docView').classList.add('hidden');
  const v = $('doneView');
  v.classList.remove('hidden');
  v.innerHTML = `
    <div class="so-done-grid">
      <div class="so-done-card">
        <img src="/brand/autowerke-it-logo-light.svg" alt="AutoWerke | IT" width="170">
        <h1>Thank you for signing, ${esc(out.name.split(' ')[0])}.</h1>
        <p>Your sign-off for <strong>${esc(out.ref)}</strong> is complete. We've emailed you the signed copy. Its last page is the signature certificate.</p>
        <p style="color:var(--muted);font-size:13px;">You can close this page. Thanks for working with us!</p>
      </div>
      <div class="so-done-stamp">
        <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="4"><circle cx="50" cy="50" r="44"/><path d="M30 51l13 13 27-28" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${out.amount ? `<div class="so-done-amount">${money(out.amount)}</div>` : ''}
        <div class="so-done-word">SIGNED</div>
        <div class="so-done-sub">${esc(new Date(out.signedAt).toLocaleString())}</div>
      </div>
    </div>`;
  window.scrollTo(0, 0);
}

// ---------- Countdown ----------
function startTimer() {
  const end = new Date(data.expiresAt).getTime();
  const total = data.sessionMinutes * 60 * 1000;
  let warned = false;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    $('soLeft').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('soBar').style.width = `${(left / total) * 100}%`;
    $('soTimer').classList.toggle('warn', left < 5 * 60000 && left >= 60000);
    $('soTimer').classList.toggle('urgent', left < 60000);
    if (left < 5 * 60000 && !warned) {
      warned = true;
      const w = $('soWarn');
      w.textContent = `⏳ About ${Math.max(1, m)} minutes left in your secure session. Finish signing before it ends, or you'll need a new code.`;
      w.classList.add('show');
    }
    if (left <= 0) { clearInterval(timer); expired(); }
  };
  tick();
  timer = setInterval(tick, 1000);
}

function expired() {
  const el = document.createElement('div');
  el.className = 'so-expired';
  el.innerHTML = `<div class="secure-card"><h1 style="font-family:var(--mono);font-size:20px;">Session ended</h1>
    <p>For your security, sign-off sessions last ${data.sessionMinutes} minutes. Nothing was signed. Verify again to start a new session.</p>
    <button type="button" class="btn-confirm secure-btn" id="again">Start again</button></div>`;
  document.body.appendChild(el);
  $('again').addEventListener('click', () => location.reload());
}

$('leave').addEventListener('click', async () => {
  if (!confirm('Leave without signing? You can come back and verify again any time.')) return;
  await fetch('/api/signoff/leave', { method: 'POST' });
  location.href = '/';
});
