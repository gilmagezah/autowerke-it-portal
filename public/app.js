const choiceButtons = document.querySelectorAll('.choice');
const form = document.getElementById('intakeForm');
const requestTypeInput = document.getElementById('requestType');
const resultBox = document.getElementById('result');
const submitBtn = document.getElementById('submitBtn');
const el = (id) => document.getElementById(id);
const phoneField = window.PhoneInput ? PhoneInput(document.getElementById('phone')) : null;

// Per-service wording for the main text box (null = no text box, just optional notes)
const SERVICE = {
  'IT Support':  { title: 'Your details', details: 'What is the problem?', placeholder: 'Describe what is happening, when it started, and any error messages.', required: true },
  'IT Project':  { title: 'Your details', details: 'Tell us about the project', placeholder: 'What would you like done, for how many users or devices, and by when?', required: true },
  'Domains':     { title: 'Your details', details: 'Anything else we should know? (optional)', placeholder: 'e.g. Alternatives you would accept, or where your current domain is registered.', required: false },
  'Consultancy': { title: 'Your details', details: 'Describe the challenge or the advice you need', placeholder: 'What are you trying to achieve or decide? What have you considered so far? Any constraints (budget, timeline, systems)?', required: true },
};

function domainRow(value = '') {
  const row = document.createElement('div');
  row.className = 'domain-row';
  row.innerHTML = `<input type="text" class="domain-input" placeholder="yourcompany.co.zw" autocomplete="off" spellcheck="false">
    <button type="button" class="domain-remove" title="Remove">✕</button>`;
  row.querySelector('input').value = value; // set as a property: never parsed as HTML
  row.querySelector('.domain-remove').addEventListener('click', () => {
    if (document.querySelectorAll('.domain-row').length > 1) row.remove();
    else row.querySelector('input').value = '';
  });
  return row;
}

el('addDomain').addEventListener('click', () => {
  if (document.querySelectorAll('.domain-row').length >= 20) return;
  const row = domainRow();
  el('domainRows').appendChild(row);
  row.querySelector('input').focus();
});

// Company website: a small "+ Website" link opens the optional field
const addWebsite = el('addWebsite');
if (addWebsite) {
  addWebsite.addEventListener('click', () => {
    el('websiteField').classList.remove('hidden');
    addWebsite.classList.add('hidden');
    addWebsite.setAttribute('aria-expanded', 'true');
    el('companyWebsite').focus();
  });
}
function resetWebsite() {
  if (!addWebsite) return;
  el('websiteField').classList.add('hidden');
  addWebsite.classList.remove('hidden');
  addWebsite.setAttribute('aria-expanded', 'false');
}

// The service buttons open the form, and say so to screen readers
choiceButtons.forEach((b) => { b.setAttribute('aria-controls', 'intakeForm'); b.setAttribute('aria-expanded', 'false'); });

// Clicking the chosen service again closes the form. Where the page has a closing animation
// (the homepage's roll-up) it plays first; otherwise, or with reduced motion, it just hides.
function closeForm() {
  choiceButtons.forEach((b) => { b.classList.remove('selected'); b.setAttribute('aria-expanded', 'false'); });
  requestTypeInput.value = '';
  el('supportRateNote').classList.add('hidden');
  form.classList.add('closing');
  const name = getComputedStyle(form).animationName;
  const finish = () => {
    if (!form.classList.contains('closing')) return;   // reopened meanwhile
    form.classList.remove('closing');
    form.classList.add('hidden');
  };
  if (!name || name === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else form.addEventListener('animationend', finish, { once: true });
}

choiceButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.value;
    if (btn.classList.contains('selected') && !form.classList.contains('hidden') && !form.classList.contains('closing')) {
      closeForm();
      return;
    }
    form.classList.remove('closing');
    choiceButtons.forEach((b) => {
      b.classList.toggle('selected', b === btn);
      b.setAttribute('aria-expanded', String(b === btn));
    });
    requestTypeInput.value = type;
    form.classList.remove('hidden');
    resultBox.classList.add('hidden');

    const cfg = SERVICE[type];
    el('detailsText').textContent = cfg.details;
    el('details').placeholder = cfg.placeholder;
    el('supportFields').classList.toggle('hidden', type !== 'IT Support');
    el('supportRateNote').classList.toggle('hidden', type !== 'IT Support');
    el('domainFields').classList.toggle('hidden', type !== 'Domains');
    el('shotFields').classList.toggle('hidden', !['IT Support', 'IT Project'].includes(type));
    el('consultNote').classList.toggle('hidden', type !== 'Consultancy');
    if (type === 'Domains' && !document.querySelector('.domain-row')) el('domainRows').appendChild(domainRow());
    submitBtn.textContent = type === 'Domains' ? 'Submit domain request' : type === 'Consultancy' ? 'Send to a consultant' : 'Submit request';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = requestTypeInput.value;
  if (!type) return showResult('error', 'Please choose a service first.');

  const payload = {
    requestType: type,
    name: el('name').value.trim(),
    surname: el('surname').value.trim(),
    companyName: el('companyName').value.trim(),
    position: el('position').value.trim(),
    email: el('email').value.trim(),
    phone: phoneField ? phoneField.value() : el('phone').value.trim(),
    details: el('details').value.trim(),
  };

  const website = el('companyWebsite');
  if (website && website.value.trim()) payload.companyWebsite = website.value.trim();

  if (!payload.name || !payload.companyName || !payload.email) return showResult('error', 'Please fill in your name, company and email.');
  if (!el('agreeTerms').checked) return showResult('error', 'Please tick the box to agree to our terms and privacy policy.');
  payload.agreeTerms = true;
  if (phoneField && !phoneField.valid()) return showResult('error', 'That phone number looks too short or too long. Check the number after the country code.');
  if (SERVICE[type].required && !payload.details) return showResult('error', `Please fill in "${SERVICE[type].details}".`);

  if (type === 'IT Support') {
    payload.usersAffected = el('usersAffected').value.trim();
    payload.devicesAffected = el('devicesAffected').value.trim();
    payload.attemptsTaken = el('attemptsTaken').value.trim();
    const canWork = document.querySelector('input[name=canWork]:checked');
    if (!el('priorityPanel').classList.contains('hidden') && canWork) {
      payload.canWork = canWork.value === 'yes';
      payload.priority = Number(el('prioRange').value);
    }
  }
  const withShots = ['IT Support', 'IT Project'].includes(type) && shots.length > 0;
  if (type === 'Domains') {
    payload.domainService = document.querySelector('input[name=domainService]:checked').value;
    payload.domains = [...document.querySelectorAll('.domain-input')].map((i) => i.value.trim()).filter(Boolean);
    if (!payload.domains.length) return showResult('error', 'Enter at least one domain.');
  }

  submitBtn.disabled = true;
  const label = submitBtn.textContent;
  submitBtn.textContent = 'Sending...';
  try {
    let res;
    if (withShots) {
      // Attachments travel as multipart: the fields as one JSON part, plus the files
      const fd = new FormData();
      fd.append('payload', JSON.stringify(payload));
      shots.forEach((s) => fd.append('screenshots', s.file, s.file.name));
      res = await fetch('/api/submit', { method: 'POST', body: fd });
    } else {
      res = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed.');

    const next = type === 'Domains'
      ? "We're checking availability and pricing now, and will email you a quote shortly."
      : type === 'Consultancy'
        ? 'A consultant is reviewing your request. Expect a response from us soon.'
        : "We'll review your request and get back to you shortly.";
    showResult('success', `<strong>Thank you!</strong> Your reference number is <span class="ref">${data.projectId}</span>. ${next}`);
    form.reset();
    resetWebsite();
    form.classList.add('hidden');
    el('domainRows').innerHTML = '';
    clearShots();
    resetPriority();
    if (phoneField) phoneField.reset();
    choiceButtons.forEach((b) => { b.classList.remove('selected'); b.setAttribute('aria-expanded', 'false'); });
    requestTypeInput.value = '';
  } catch (err) {
    showResult('error', err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = label;
  }
});

function showResult(type, message) {
  resultBox.className = `result ${type}`;
  resultBox.innerHTML = message;
  resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ================= Screenshots and text files (support + projects) =================
// The server checks every file's bytes again; these checks just give a quick, friendly answer.

const MAX_SHOTS = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const TEXT_MAX_BYTES = 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const isTextFile = (file) => file.type === 'text/plain' || /\.(txt|log)$/i.test(file.name);
let shots = []; // [{ file, url }] for images, [{ file, text: true, preview }] for text files

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function renderShots() {
  el('shotGrid').innerHTML = shots.map((s, i) => `
    <div class="shot${s.text ? ' shot-text' : ''}">
      ${s.text
    ? `<pre class="shot-preview" aria-label="Start of ${escapeHtml(s.file.name)}">${escapeHtml(s.preview || '')}</pre><span class="shot-badge">TXT</span>`
    : `<img src="${s.url}" alt="Screenshot ${i + 1}">`}
      <button type="button" class="shot-remove" data-i="${i}" title="Remove">✕</button>
      <span class="shot-name">${escapeHtml(s.file.name)}</span>
    </div>`).join('');
  el('shotDrop').classList.toggle('full', shots.length >= MAX_SHOTS);
}

// The first lines of a text file, for its preview tile (UTF-16 files from PowerShell included)
async function previewText(file) {
  try {
    const bytes = new Uint8Array(await file.slice(0, 4000).arrayBuffer());
    const enc = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    return new TextDecoder(enc).decode(bytes).replace(/^﻿/, '').split(/\r?\n/).slice(0, 12).join('\n');
  } catch { return ''; }
}

function addShots(fileList) {
  const errors = [];
  for (const file of fileList) {
    if (shots.length >= MAX_SHOTS) { errors.push(`Only ${MAX_SHOTS} files can be attached.`); break; }
    if (isTextFile(file)) {
      if (file.size > TEXT_MAX_BYTES) { errors.push(`"${file.name}" is over 1 MB. Text files can be up to 1 MB.`); continue; }
      const item = { file, text: true, preview: '' };
      shots.push(item);
      previewText(file).then((p) => { item.preview = p; renderShots(); });
      continue;
    }
    if (!OK_TYPES.includes(file.type)) { errors.push(`"${file.name}" isn't an image (PNG, JPG, GIF or WebP) or a .txt / .log file.`); continue; }
    if (file.size > MAX_BYTES) { errors.push(`"${file.name}" is over 5 MB.`); continue; }
    shots.push({ file, url: URL.createObjectURL(file) });
  }
  el('shotError').textContent = errors.join(' ');
  renderShots();
}

function clearShots() {
  shots.forEach((s) => { if (s.url) URL.revokeObjectURL(s.url); });
  shots = [];
  el('shotError').textContent = '';
  renderShots();
}

el('shotInput').addEventListener('change', (e) => { addShots(e.target.files); e.target.value = ''; });
el('shotGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.shot-remove');
  if (!b) return;
  const [gone] = shots.splice(Number(b.dataset.i), 1);
  if (gone.url) URL.revokeObjectURL(gone.url);
  renderShots();
});
['dragenter', 'dragover'].forEach((ev) => el('shotDrop').addEventListener(ev, (e) => { e.preventDefault(); el('shotDrop').classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => el('shotDrop').addEventListener(ev, (e) => { e.preventDefault(); el('shotDrop').classList.remove('over'); }));
el('shotDrop').addEventListener('drop', (e) => addShots(e.dataTransfer.files));

// ================= Priority (support) =================
// "Can you still work at all?"  yes -> 1..3   no -> 2..5

const PRIORITY = {
  1: 'Whenever you get a chance ☕',
  2: "It's annoying, but I'm managing",
  3: "It's really slowing me down",
  4: "I'm stuck. Can't get my work done",
  5: "Everything's on fire 🔥",
};

function setPriorityRange(canWork) {
  const r = el('prioRange');
  const [min, max] = canWork ? [1, 3] : [2, 5];
  r.min = min;
  r.max = max;
  r.value = Math.min(Math.max(Number(r.value) || min, min), max);
  el('prioScale').innerHTML = Array.from({ length: max - min + 1 }, (_, i) => `<span>P${min + i}</span>`).join('');
  el('sliderWrap').classList.remove('hidden');
  updatePriority();
}

function updatePriority() {
  const v = Number(el('prioRange').value);
  el('prioNum').textContent = `P${v}`;
  el('prioLabel').textContent = PRIORITY[v];
  const r = el('prioRange');
  const pct = ((v - Number(r.min)) / Math.max(Number(r.max) - Number(r.min), 1)) * 100;
  r.style.setProperty('--fill', `${pct}%`);
  el('priorityPanel').dataset.level = String(v);
}

function resetPriority() {
  el('priorityPanel').classList.add('hidden');
  el('sliderWrap').classList.add('hidden');
  el('addPriority').classList.remove('hidden');
  document.querySelectorAll('input[name=canWork]').forEach((x) => { x.checked = false; });
}

el('addPriority').addEventListener('click', () => {
  el('priorityPanel').classList.remove('hidden');
  el('addPriority').classList.add('hidden');
});
el('removePriority').addEventListener('click', resetPriority);
document.querySelectorAll('input[name=canWork]').forEach((x) => x.addEventListener('change', () => setPriorityRange(x.value === 'yes')));
el('prioRange').addEventListener('input', updatePriority);
