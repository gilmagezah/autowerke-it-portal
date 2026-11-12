// The demo's own pages, mounted ahead of the real app by demo/start.js. Production code never loads this.
//
// /demo              a guide: what to try, the demo sign-in, and the inbox
// /demo/mail/:id     one captured email, shown as the recipient would see it (scripts can't run)
// /demo/mail/:id/:n  its attachment (sign-off PDFs, meeting invites)
//
// It's a shared, public demo, so:
// - emails show in full only when every recipient is a made-up .example address. Anything a visitor
//   typed as a real address is listed by subject only.
// - changing the demo password or the team is turned off, so one visitor can't lock out the next.
// - the data resets to the seed after 20 quiet minutes (the free host also restarts when idle).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isVisible = (to) => [].concat(to || []).length > 0 && [].concat(to).every((a) => /@[a-z0-9.-]+\.example$/i.test(String(a).trim()));
const BLOCKED = [
  ['POST', /^\/api\/admin\/me\/password$/],
  ['POST', /^\/api\/admin\/team$/],
  ['PATCH', /^\/api\/admin\/team\//],
];
const IDLE_RESET_MS = 20 * 60 * 1000;
const MAX_MAIL = 60;

function createDemoLayer({ admin, reset }) {
  const inbox = [];
  let nextId = 1;
  let lastSeen = Date.now();
  let dirty = false;

  function capture({ to, subject, html, attachments }) {
    inbox.unshift({ id: nextId++, at: new Date(), to: [].concat(to || []), subject: String(subject || ''), html: String(html || ''), attachments: attachments || [] });
    inbox.length = Math.min(inbox.length, MAX_MAIL);
  }

  // Reset only when nobody is around, so nobody is signed out mid-visit
  const timer = setInterval(() => {
    if (dirty && Date.now() - lastSeen > IDLE_RESET_MS) { reset(); inbox.length = 0; dirty = false; console.log('[demo] reset to the sample data after a quiet spell'); }
  }, 60 * 1000);
  timer.unref();

  function mount(app) {
    app.use((req, res, next) => {
      lastSeen = Date.now();
      if (req.method !== 'GET' && req.method !== 'HEAD') dirty = true;
      if (BLOCKED.some(([m, re]) => m === req.method && re.test(req.path))) {
        return res.status(403).json({ error: 'Turned off in the shared demo, so the next visitor can still sign in.' });
      }
      next();
    });

    app.get(['/demo', '/demo/'], (req, res) => {
      setPageHeaders(res);
      res.type('html').send(guidePage(admin, inbox));
    });

    app.get('/demo/mail/:id', (req, res) => {
      const m = inbox.find((x) => x.id === Number(req.params.id));
      if (!m) return res.redirect('/demo');
      if (!isVisible(m.to)) { setPageHeaders(res); return res.status(403).type('html').send(shell('Hidden', '<p>This email went to an address a visitor typed, so the shared demo keeps it private.</p><p><a href="/demo">Back to the demo</a></p>')); }
      // The email as sent, in a sandbox: no scripts, no forms, no same-origin access
      res.set({
        'Content-Security-Policy': "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:",
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
      });
      res.type('html').send(m.html);
    });

    app.get('/demo/mail/:id/:n', (req, res) => {
      const m = inbox.find((x) => x.id === Number(req.params.id));
      const a = m && isVisible(m.to) && m.attachments[Number(req.params.n)];
      if (!a) return res.status(404).type('text').send('Not found.');
      const name = String(a.filename || 'attachment').replace(/[^\w.\- ]/g, '_');
      const type = /\.pdf$/i.test(name) ? 'application/pdf' : /\.ics$/i.test(name) ? 'text/calendar' : 'application/octet-stream';
      res.set({
        'Content-Type': type, 'Content-Disposition': `${type === 'application/pdf' ? 'inline' : 'attachment'}; filename="${name}"`,
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Robots-Tag': 'noindex',
      });
      res.send(Buffer.from(String(a.content || ''), 'base64'));
    });
  }

  return { capture, mount, inbox };
}

function setPageHeaders(res) {
  res.set({
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store',
  });
}

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AutoWerke | IT demo</title>
<style>
  :root { --paper:#F4F1E8; --green:#2F4A3B; --ink:#1F2622; --muted:#5f5f56; --line:#d9d4c4; --mono:"Courier Prime","Courier New",monospace; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; }
  header { background:var(--green); color:var(--paper); padding:22px 16px; }
  header div, main { max-width:880px; margin:0 auto; }
  header div { padding:0 16px; } header { padding-left:0; padding-right:0; }
  h1, h2, .mono { font-family:var(--mono); }
  h1 { margin:0; font-size:22px; letter-spacing:.02em; }
  header p { margin:6px 0 0; opacity:.85; }
  main { padding:24px 16px 48px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.08em; margin:32px 0 10px; }
  a { color:var(--green); }
  a.card { color:inherit; text-decoration:none; }
  a.card:hover { border-color:var(--green); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
  .card { border:1px solid var(--line); background:#fbf9f3; padding:14px 16px; border-radius:6px; }
  .card b { display:block; font-family:var(--mono); margin-bottom:4px; }
  .card span { color:var(--muted); font-size:14px; }
  dl { display:grid; grid-template-columns:max-content 1fr; gap:4px 16px; margin:0; }
  dt { color:var(--muted); } dd { margin:0; font-family:var(--mono); overflow-wrap:anywhere; }
  .note { border:1px solid var(--line); border-radius:6px; padding:12px 16px; color:var(--muted); font-size:14px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-family:var(--mono); font-weight:400; color:var(--muted); text-transform:uppercase; font-size:12px; letter-spacing:.08em; }
  td.when { white-space:nowrap; color:var(--muted); font-family:var(--mono); }
  td.to { overflow-wrap:anywhere; }
  .hid { color:var(--muted); }
  @media (max-width:560px) { th.to, td.to { display:none; } }
</style></head><body>${body}</body></html>`;
}

function guidePage(admin, inbox) {
  const rows = inbox.map((m) => {
    const vis = isVisible(m.to);
    const files = vis ? m.attachments.map((a, n) => ` · <a href="/demo/mail/${m.id}/${n}" target="_blank" rel="noopener">${esc(a.filename || 'attachment')}</a>`).join('') : '';
    return `<tr><td class="when">${m.at.toISOString().slice(11, 16)}</td><td class="to">${vis ? esc(m.to.join(', ')) : '<span class="hid">a visitor\'s address</span>'}</td>
<td>${vis ? `<a href="/demo/mail/${m.id}" target="_blank" rel="noopener">${esc(m.subject)}</a>${files}` : `<span class="hid">${esc(m.subject)}</span>`}</td></tr>`;
  }).join('');
  return shell('Guide', `
<header><div><h1>AutoWerke | IT · live demo</h1><p>The real app on made-up data. Nothing here is sent anywhere, and it resets after a quiet spell.</p></div></header>
<main>
  <h2>Try</h2>
  <div class="grid">
    <a class="card" href="/" target="_blank" rel="noopener"><b>Client site →</b><span>Choose a service and describe a problem, the way a client would.</span></a>
    <a class="card" href="/track" target="_blank" rel="noopener"><b>Track a request →</b><span>Use <span class="mono">KOPJEW-6TD-5LH</span> with <span class="mono">rudo@kopjeworks.example</span></span></a>
    <a class="card" href="/admin" target="_blank" rel="noopener"><b>Back office →</b><span>Sign in with the details below. The 6-letter code lands in the inbox on this page.</span></a>
  </div>

  <h2>Back-office sign-in</h2>
  <div class="card"><dl><dt>Email</dt><dd>${esc(admin.email)}</dd><dt>Password</dt><dd>${esc(admin.password)}</dd><dt>Code</dt><dd>in the inbox below (refresh this page)</dd></dl></div>

  <h2>Inbox</h2>
  <p class="note">Every email the app would have sent. Open one to see it as the recipient would, with its PDFs. Emails to an address a visitor typed stay hidden.</p>
  ${rows ? `<table><thead><tr><th>Time (UTC)</th><th class="to">To</th><th>Subject</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">Nothing yet. Sign in to the back office or submit a request, then refresh.</p>'}

  <h2>Please note</h2>
  <p class="note">This demo is shared. Anything you type can be seen by the next visitor until it resets, so please use made-up details. Changing the password or the team is turned off. Source code: see the repository README.</p>
</main>`);
}

module.exports = { createDemoLayer, isVisible };
