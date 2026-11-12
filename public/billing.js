const appEl = document.getElementById('app');
const esc = (s = '') => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attr = (s = '') => esc(s).replace(/"/g, '&quot;');
const money = (n) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d) => { if (!d) return ''; const x = new Date(String(d).length === 10 ? `${d}T12:00:00` : d); return `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`; };
const todayStr = () => new Date().toISOString().slice(0, 10);
let S = null;

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function load() {
  try { S = await api('/api/admin/billing'); render(); } catch (err) { appEl.innerHTML = `<p class="empty-state">${esc(err.message)}</p>`; }
}

function paidOn(inv) { return S.receipts.filter((r) => r.invoice_id === inv.id).reduce((s, r) => s + Number(r.amount), 0); }

function render() {
  const open = S.invoices.filter((i) => i.status === 'issued');
  const outstanding = open.reduce((s, i) => s + Number(i.total) - paidOn(i), 0);
  const month = todayStr().slice(0, 7);
  const thisMonth = S.receipts.filter((r) => String(r.received_on).slice(0, 7) === month).reduce((s, r) => s + Number(r.amount), 0);
  const overdue = open.filter((i) => i.due_date && i.due_date < todayStr());
  if (window.setBandStats) window.setBandStats([
    { label: 'Outstanding', value: money(outstanding), sub: `${open.length} invoice${open.length === 1 ? '' : 's'}` },
    { label: 'Overdue', value: String(overdue.length) },
    { label: 'Received this month', value: money(thisMonth) },
  ]);
  if (window.setNavCount) window.setNavCount('billing', overdue.length);

  appEl.innerHTML = `
    ${S.paymentDetailsSet ? '' : '<div class="warn-box"><strong>Add your payment details.</strong> Set <code>INVOICE_PAYMENT_DETAILS</code> in <code>.env</code> (bank and EcoCash details) so they print on every invoice. Until then, invoices ask clients to contact you.</div>'}
    <div class="svc-section"><h2>Invoices</h2><button type="button" class="btn-primary" id="newInv">+ New invoice</button></div>
    <div class="reg-table" style="border-radius:var(--radius);">
      <div class="bl-row head"><span>Invoice</span><span>Client</span><span>Issued / due</span><span>Total</span><span>Status</span><span></span></div>
      ${S.invoices.length ? S.invoices.map(invRow).join('') : '<p class="empty-state" style="padding:16px;">No invoices yet. Create one from any request.</p>'}
    </div>
    <div class="svc-section"><h2>Receipts</h2><span class="count">${S.receipts.length}</span></div>
    <div class="reg-table" style="border-radius:var(--radius);">
      <div class="bl-row head"><span>Receipt</span><span>Client</span><span>Received</span><span>Amount</span><span>Method</span><span></span></div>
      ${S.receipts.length ? S.receipts.map(rcRow).join('') : '<p class="empty-state" style="padding:16px;">Receipts appear here when payments are recorded.</p>'}
    </div>
    ${sigPanel()}
    <div class="fu-modal hidden" id="blModal"></div>`;
  document.getElementById('newInv').addEventListener('click', openNew);
  appEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, b.dataset.id)));
  wireSig();
}

function invRow(i) {
  const paid = paidOn(i);
  const late = i.status === 'issued' && i.due_date && i.due_date < todayStr();
  const pill = i.status === 'paid' ? '<span class="svc-pill">Paid</span>' : i.status === 'void' ? '<span class="svc-pill muted">Void</span>'
    : late ? '<span class="svc-pill red">Overdue</span>' : paid > 0 ? '<span class="svc-pill amber">Part paid</span>' : '<span class="svc-pill amber">Issued</span>';
  return `<div class="bl-row">
    <div class="bl-num">${esc(i.number)}</div>
    <div><strong>${esc(i.company)}</strong><div class="reg-sub">${esc(i.ref || '')}${i.contact_name ? ` · ${esc(i.contact_name)}` : ''}</div></div>
    <div class="reg-cell">${esc(fmt(i.issued_at))}<div class="reg-sub">due ${esc(fmt(i.due_date))}</div></div>
    <div class="reg-cell"><strong>${money(i.total)}</strong>${paid > 0 && i.status !== 'paid' ? `<div class="reg-sub">${money(paid)} received</div>` : ''}</div>
    <div>${pill}</div>
    <div class="fu-actions bl-actions">
      ${i.pdf_url ? `<button type="button" data-act="open" data-id="${attr(i.pdf_url)}">PDF</button>` : ''}
      ${i.status !== 'void' ? `<button type="button" data-act="rebuild" data-id="${attr(i.id)}" title="Re-create the PDF with the current layout and signature">Rebuild PDF</button>` : ''}
      ${i.status === 'issued' ? `<button type="button" class="primary" data-act="pay" data-id="${attr(i.id)}">Record payment</button><button type="button" data-act="upload" data-id="${attr(i.id)}">Upload receipt</button>` : ''}
      ${i.request_id ? `<button type="button" data-act="trail" data-id="${attr(i.request_id)}">Trail</button>` : ''}
      ${i.status === 'issued' && paid === 0 ? `<button type="button" data-act="void" data-id="${attr(i.id)}">Void</button>` : ''}
    </div></div>`;
}

function rcRow(r) {
  const inv = S.invoices.find((i) => i.id === r.invoice_id);
  return `<div class="bl-row">
    <div class="bl-num">${esc(r.number)}</div>
    <div><strong>${esc(r.company || '')}</strong><div class="reg-sub">${inv ? `for ${esc(inv.number)}` : ''}${r.source === 'uploaded' ? ' · uploaded from your system' : ''}</div></div>
    <div class="reg-cell">${esc(fmt(r.received_on))}</div>
    <div class="reg-cell"><strong>${money(r.amount)}</strong></div>
    <div class="reg-cell">${esc(r.method || '')}${r.reference ? `<div class="reg-sub">${esc(r.reference)}</div>` : ''}</div>
    <div class="fu-actions">${r.file_url ? `<button type="button" data-act="open" data-id="${attr(r.file_url)}">Open</button>` : ''}${r.source === 'generated' ? `<button type="button" data-act="rebuild-rc" data-id="${attr(r.id)}" title="Re-create with the current layout and signature">Rebuild</button>` : ''}</div></div>`;
}

const modal = () => document.getElementById('blModal');
function showModal(html) { modal().innerHTML = `<div class="fu-dialog" role="dialog" aria-modal="true">${html}</div>`; modal().classList.remove('hidden'); }
function closeModal() { modal().classList.add('hidden'); modal().innerHTML = ''; }

async function act(kind, id) {
  try {
    if (kind === 'open') return window.open(id, '_blank', 'noopener');
    if (kind === 'rebuild' || kind === 'rebuild-rc') {
      const isInv = kind === 'rebuild';
      const doc = isInv ? S.invoices.find((i) => i.id === id) : S.receipts.find((r) => r.id === id);
      if (!confirm(`Rebuild ${doc.number} with the current layout and signature? The number and amounts stay the same.`)) return;
      // A paid invoice is never re-sent (it would read as a second request for payment)
      const canSend = !isInv || doc.status === 'issued';
      const send = canSend && confirm(`Also email the updated PDF to ${doc.email}?\n\nOK = rebuild and email · Cancel = just rebuild`);
      await api(`/api/admin/${isInv ? 'invoices' : 'receipts'}/${id}/rebuild`, { method: 'POST', body: JSON.stringify({ send }) });
      await load();
      const fresh = isInv ? S.invoices.find((i) => i.id === id).pdf_url : S.receipts.find((r) => r.id === id).file_url;
      if (fresh) window.open(fresh, '_blank', 'noopener');
      return;
    }
    if (kind === 'void') {
      if (!confirm('Void this invoice? Its payment reminders stop. This cannot be undone.')) return;
      await api(`/api/admin/invoices/${id}/void`, { method: 'POST' }); return load();
    }
    if (kind === 'trail') return openTrail(id);
    const inv = S.invoices.find((i) => i.id === id);
    const due = Math.round((Number(inv.total) - paidOn(inv)) * 100) / 100;
    const methods = S.methods.map((m) => `<option>${esc(m)}</option>`).join('');
    const common = `
      <label class="fu-field">Amount received ($)<input type="number" step="0.01" min="0" id="pAmt" value="${due}"></label>
      <label class="fu-field">Method<select id="pMethod">${methods}</select></label>
      <label class="fu-field">Payment reference (optional)<input id="pRef" placeholder="e.g. bank or EcoCash transaction ID"></label>
      <label class="fu-field">Received on<input type="date" id="pDate" value="${todayStr()}" max="${todayStr()}"></label>`;
    if (kind === 'pay') {
      showModal(`<div class="fu-dialog-head"><h2>Record payment · ${esc(inv.number)}</h2><div>${esc(inv.company)} · ${money(due)} outstanding</div></div>
        <div class="fu-dialog-body"><div class="fu-grid" style="grid-template-columns:1fr 1fr;">${common}</div>
        <p class="fu-hint">We'll generate receipt AW-RCT-… , email it to ${esc(inv.email)}, and stop the payment reminders once it's fully paid.</p></div>
        <div class="fu-dialog-foot"><button type="button" class="link-btn" id="mClose">Cancel</button><button type="button" class="btn-primary" id="mGo">Record &amp; send receipt</button></div>`);
      document.getElementById('mClose').addEventListener('click', closeModal);
      document.getElementById('mGo').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          await api(`/api/admin/invoices/${id}/pay`, { method: 'POST', body: JSON.stringify({ amount: document.getElementById('pAmt').value, method: document.getElementById('pMethod').value, reference: document.getElementById('pRef').value, received_on: document.getElementById('pDate').value }) });
          closeModal(); load();
        } catch (err) { alert(err.message); e.target.disabled = false; }
      });
    }
    if (kind === 'upload') {
      showModal(`<div class="fu-dialog-head"><h2>Upload receipt · ${esc(inv.number)}</h2><div>A receipt issued by your workplace's own system</div></div>
        <div class="fu-dialog-body"><div class="fu-grid" style="grid-template-columns:1fr 1fr;">
          <label class="fu-field">Their receipt number<input id="uNum" placeholder="e.g. 004512"></label>
          <label class="fu-field">Receipt file (PDF, PNG or JPG)<input type="file" id="uFile" accept="application/pdf,image/png,image/jpeg"></label>
          ${common}</div>
          <label class="fu-toggle"><input type="checkbox" id="uSend" checked> Email this receipt to ${esc(inv.email)}</label></div>
        <div class="fu-dialog-foot"><button type="button" class="link-btn" id="mClose">Cancel</button><button type="button" class="btn-primary" id="mGo">Upload &amp; file</button></div>`);
      document.getElementById('mClose').addEventListener('click', closeModal);
      document.getElementById('mGo').addEventListener('click', async (e) => {
        const f = document.getElementById('uFile').files[0];
        if (!f) return alert('Choose the receipt file.');
        const fd = new FormData();
        fd.append('file', f);
        [['external_number', 'uNum'], ['amount', 'pAmt'], ['method', 'pMethod'], ['reference', 'pRef'], ['received_on', 'pDate']].forEach(([k, el]) => fd.append(k, document.getElementById(el).value));
        fd.append('send', String(document.getElementById('uSend').checked));
        e.target.disabled = true;
        try { await api(`/api/admin/invoices/${id}/receipt-upload`, { method: 'POST', body: fd }); closeModal(); load(); } catch (err) { alert(err.message); e.target.disabled = false; }
      });
    }
  } catch (err) { alert(err.message); }
}

async function openTrail(requestId) {
  const t = await api(`/api/admin/trail/${requestId}`);
  showModal(`<div class="fu-dialog-head"><h2>Document trail · ${esc(t.ref)}</h2><div>${esc(t.company)} · from first request to receipt</div></div>
    <div class="fu-dialog-body"><ul class="trail">${t.trail.map((e) => `<li><span class="when">${esc(e.when ? fmt(e.when) : '—')}</span>
      <span><span class="kind">${esc(e.kind.replace('-', ' '))}</span><br><strong>${esc(e.title)}</strong>${e.detail ? `<div class="reg-sub">${esc(e.detail)}</div>` : ''}</span>
      <span>${e.url ? `<a href="${attr(e.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</span></li>`).join('')}</ul></div>
    <div class="fu-dialog-foot"><button type="button" class="btn-primary" id="mClose">Close</button></div>`);
  document.getElementById('mClose').addEventListener('click', closeModal);
}

// ---------- New invoice ----------
function openNew() {
  let lines = [];
  showModal(`<div class="fu-dialog-head"><h2>New invoice</h2><div>Lines fill in from what was agreed. Check them, then issue.</div></div>
    <div class="fu-dialog-body">
      <label class="fu-field">For which request?<select id="nSrc"><option value="">Choose a request (or leave blank to bill manually)</option>${S.sources.map((s) => `<option value="${attr(s.id)}">${esc(s.ref)} · ${esc(s.company)}${s.title ? ` · ${esc(s.title)}` : ''}</option>`).join('')}</select></label>
      <div class="fu-grid" style="grid-template-columns:1fr 1fr;">
        <label class="fu-field">Company<input id="nCo"></label><label class="fu-field">Billing email<input id="nEmail" type="email"></label>
        <label class="fu-field">Contact name<input id="nContact"></label>
        <label class="fu-field">Payment due<select id="nDue"><option value="14" selected>In 14 days</option><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="0">On receipt</option></select></label>
      </div>
      <div class="svc-label">Lines</div>
      <table class="bl-lines" style="width:100%;"><thead><tr><th style="text-align:left;" class="svc-label">Description</th><th class="svc-label">Qty</th><th class="svc-label">Unit price ($)</th><th></th></tr></thead><tbody id="nLines"></tbody></table>
      <button type="button" class="link-btn" id="nAdd">+ Add line</button>
      <div class="q-row-inline"><label class="fu-toggle"><input type="checkbox" id="nVat" checked> Charge VAT</label></div>
      <label class="fu-field">Note on the invoice (optional)<input id="nNotes" placeholder="e.g. Thank you for your business"></label>
      <div class="q-totals" id="nTotals"></div>
    </div>
    <div class="fu-dialog-foot"><button type="button" class="link-btn" id="mClose">Cancel</button><button type="button" class="btn-primary" id="mGo">Issue &amp; email invoice</button></div>`);
  const $ = (id) => document.getElementById(id);
  const draw = () => {
    $('nLines').innerHTML = lines.map((l, i) => `<tr><td><input data-k="description" data-i="${i}" value="${attr(l.description)}"></td>
      <td class="num" style="width:80px;"><input type="number" step="0.01" data-k="qty" data-i="${i}" value="${attr(l.qty)}"></td>
      <td class="num" style="width:130px;"><input type="number" step="0.01" data-k="unit_price" data-i="${i}" value="${attr(l.unit_price)}"></td>
      <td><button type="button" class="link-btn" data-r="${i}">✕</button></td></tr>`).join('');
    $('nLines').querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => { lines[inp.dataset.i][inp.dataset.k] = inp.value; totals(); }));
    $('nLines').querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => { lines.splice(Number(b.dataset.r), 1); draw(); }));
    totals();
  };
  const totals = () => {
    const sub = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);
    const rate = $('nVat').checked ? 15.5 : 0;
    const vat = Math.round(sub * rate) / 100;
    $('nTotals').innerHTML = `<div><span>Subtotal</span><span>${money(sub)}</span></div>${rate ? `<div><span>VAT ${rate}%</span><span>${money(vat)}</span></div>` : ''}<div class="t"><span>Total</span><span>${money(sub + vat)}</span></div>`;
  };
  $('nSrc').addEventListener('change', () => {
    const s = S.sources.find((x) => x.id === $('nSrc').value);
    if (!s) return;
    $('nCo').value = s.company || ''; $('nEmail').value = s.email || ''; $('nContact').value = s.contact || '';
    $('nVat').checked = s.vat !== false;
    lines = s.lines.length ? s.lines.map((l) => ({ ...l })) : [{ description: '', qty: 1, unit_price: '' }];
    draw();
  });
  $('nAdd').addEventListener('click', () => { lines.push({ description: '', qty: 1, unit_price: '' }); draw(); });
  $('nVat').addEventListener('change', totals);
  $('mClose').addEventListener('click', closeModal);
  $('mGo').addEventListener('click', async (e) => {
    if (!confirm(`Issue this invoice and email it to ${$('nEmail').value}?`)) return;
    e.target.disabled = true;
    try {
      await api('/api/admin/invoices', { method: 'POST', body: JSON.stringify({
        request_id: $('nSrc').value || null, company: $('nCo').value, email: $('nEmail').value, contact_name: $('nContact').value,
        due_days: Number($('nDue').value), vat_applicable: $('nVat').checked, notes: $('nNotes').value, lines,
      }) });
      closeModal(); load();
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
  lines = [{ description: '', qty: 1, unit_price: '' }];
  draw();
}

// ---------- Your signature ----------
function sigPanel() {
  const s = S.signature;
  return `<div class="svc-section"><h2>Your signature</h2><span class="count">pre-applied to invoices, receipts, contracts, estimates and sign-offs</span></div>
    <div class="svc-card">
      ${S.isOwner ? `<div class="bl-sig">
        <div class="pad"><canvas id="sigPad"></canvas><button type="button" class="link-btn" id="sigClear">Clear</button> <span class="svc-hint">Draw with your mouse, finger or stylus, or</span> <label class="link-btn" style="cursor:pointer;">upload an image<input type="file" id="sigFile" accept="image/png,image/jpeg" hidden></label></div>
        <div style="min-width:220px;">
          <label class="fu-field">Name under the signature<input id="sigName" value="${attr(s.name || '')}" placeholder="Gil Magezah"></label>
          <label class="fu-field">Title<input id="sigTitle" value="${attr(s.title || '')}" placeholder="Founder & Lead Consultant"></label>
          <div class="svc-actions"><button type="button" class="btn-primary" id="sigSave">Save signature</button>${s.set ? '<button type="button" class="btn-outline" id="sigRemove">Remove</button>' : ''}</div>
          ${s.set ? `<div class="svc-label">Current</div><div class="current"><img src="${attr(s.url)}" alt="Your signature"></div>` : '<p class="svc-hint">No signature yet: documents show a blank signing line.</p>'}
        </div></div>` : `<p class="svc-hint">${s.set ? `Documents are signed by ${esc(s.name)}.` : 'No signature set.'} Only the account owner can change it.</p>`}
    </div>`;
}

function wireSig() {
  const canvas = document.getElementById('sigPad');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let drawn = false; let down = false; let last = null; let uploaded = null;
  const size = () => { const r = canvas.getBoundingClientRect(); const k = window.devicePixelRatio || 1; canvas.width = r.width * k; canvas.height = r.height * k; ctx.setTransform(k, 0, 0, k, 0, 0); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1F2622'; drawn = false; uploaded = null; };
  size();
  const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', (e) => { down = true; last = pt(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!down) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; drawn = true; });
  ['pointerup', 'pointerleave'].forEach((ev) => canvas.addEventListener(ev, () => { down = false; }));
  document.getElementById('sigClear').addEventListener('click', size);
  document.getElementById('sigFile').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { uploaded = reader.result; const img = new Image(); img.onload = () => { size(); uploaded = reader.result; const r = canvas.getBoundingClientRect(); const k = Math.min(r.width / img.width, r.height / img.height); ctx.drawImage(img, 0, 0, img.width * k, img.height * k); }; img.src = reader.result; };
    reader.readAsDataURL(f);
  });
  document.getElementById('sigSave').addEventListener('click', async (e) => {
    if (!drawn && !uploaded) return alert('Draw your signature or upload an image first.');
    e.target.disabled = true;
    try {
      await api('/api/admin/settings/signature', { method: 'POST', body: JSON.stringify({ image: uploaded || canvas.toDataURL('image/png'), name: document.getElementById('sigName').value, title: document.getElementById('sigTitle').value }) });
      load();
    } catch (err) { alert(err.message); e.target.disabled = false; }
  });
  document.getElementById('sigRemove')?.addEventListener('click', async () => {
    if (!confirm('Remove your signature from future documents?')) return;
    await api('/api/admin/settings/signature', { method: 'DELETE' }); load();
  });
}

load();
