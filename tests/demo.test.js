// The demo (npm run demo): the real server on made-up data, with no accounts or keys. `npm test`.
// Boots demo/start.js as its own process (twice: locally, and as it runs on Render), signs in,
// and checks the real query code in lib/db.js returns the seed through the in-memory Supabase stand-in.
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { createFakeSupabase } = require('../demo/fake-supabase');
const { isVisible } = require('../demo/layer');

const PORT = 3593; const B = `http://localhost:${PORT}`;
const P2 = 3594; const B2 = `http://localhost:${P2}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEMO = { email: 'demo@autowerke.example', password: 'Demo-Back-Office-2026' };

const children = [];
function boot(port, extra = {}) {
  const c = spawn(process.execPath, [path.join(__dirname, '..', 'demo', 'start.js')], {
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: '', RENDER_EXTERNAL_URL: '', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = { out: '' };
  c.stdout.on('data', (d) => { log.out += d; }); c.stderr.on('data', (d) => { log.out += d; });
  children.push(c);
  return log;
}
const ready = async (log) => { for (let i = 0; i < 50 && !/demo \(made-up data/.test(log.out); i++) await sleep(200); };
const post = (base, p, body, cookie) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const done = (code) => { children.forEach((c) => c.kill()); process.exit(code); };

(async () => {
  // ---- 1. The stand-in behaves like the parts of supabase-js the app uses ----
  const sb = createFakeSupabase({ people: [], teams: [] });
  const team = (await sb.from('teams').insert({ name: 'Ops' }).select().single()).data;
  await sb.from('people').insert([{ name: 'B', team_id: team.id, n: 2 }, { name: 'A', team_id: team.id, n: 1 }, { name: 'C', n: null }]);
  let r = await sb.from('people').select('name, team:teams!team_id(name)').not('n', 'is', null).order('n');
  assert.deepStrictEqual(r.data.map((p) => [p.name, p.team.name]), [['A', 'Ops'], ['B', 'Ops']], 'filter, order and a named join');
  r = await sb.from('people').select('id', { count: 'exact', head: true }).in('name', ['A', 'C']);
  assert.strictEqual(r.count, 2, 'head-only count');
  r = await sb.from('people').select('*').eq('name', 'nobody').single();
  assert(r.error && !r.data, '.single() with no row is an error, like the real client');
  await sb.from('people').update({ n: 9 }).eq('name', 'C');
  assert.strictEqual((await sb.from('people').select('n').eq('name', 'C').single()).data.n, 9);
  console.log('1. in-memory Supabase: filters, ordering, named joins, counts, single() errors ✓');

  assert(isVisible(['demo@autowerke.example']) && isVisible('rudo@kopjeworks.example'));
  assert(!isVisible(['someone@gmail.com']), 'a real address stays hidden');
  assert(!isVisible(['a@b.example', 'real@company.co.zw']), 'one real recipient hides the whole email');
  assert(!isVisible([]) && !isVisible(['x@evil.example.com']), 'no recipients, or .example not at the end');
  console.log('1b. the shared inbox shows only emails to made-up .example addresses ✓');

  const log = boot(PORT);
  try {
    // ---- 2. The demo boots and signs in with the printed code ----
    await ready(log);
    assert(log.out.includes(DEMO.email), 'prints how to sign in');
    let res = await post(B, '/api/auth/login', DEMO);
    assert.strictEqual(res.status, 200);
    await sleep(300);
    const code = (log.out.match(/code for demo@autowerke\.example: ([A-Z]{6})/) || [])[1];
    assert(code, 'the sign-in code is printed (development mode)');
    res = await post(B, '/api/auth/verify', { email: DEMO.email, code });
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    assert(res.status === 200 && /^aw_admin=/.test(cookie));
    assert(/\[demo email\] to demo@autowerke\.example/.test(log.out), 'emails are printed, not sent');
    console.log('2. demo boots; sign-in works with the printed code; emails go to the terminal ✓');

    // ---- 2b. The /demo guide: sign-in details, an inbox with the code, sandboxed emails ----
    const page = await fetch(B + '/demo');
    assert.strictEqual(page.status, 200);
    assert(/default-src 'none'/.test(page.headers.get('content-security-policy')), 'the guide has its own strict CSP');
    const html = await page.text();
    assert(html.includes(DEMO.password) && html.includes(`Your admin sign-in code: ${code}`), 'the guide lists the sign-in email with its code');
    const mailId = (html.match(/href="\/demo\/mail\/(\d+)"/) || [])[1];
    const mail = await fetch(`${B}/demo/mail/${mailId}`);
    assert(/^sandbox/.test(mail.headers.get('content-security-policy')), 'captured emails render in a sandbox (no scripts)');
    const letters = [...(await mail.text()).matchAll(/>([A-Z])<\/div>/g)].map((m) => m[1]).join('');
    assert.strictEqual(letters, code, 'the email shows the code in its letter boxes');
    assert.strictEqual((await fetch(`${B}/demo/mail/${mailId}/7`)).status, 404, 'no such attachment');
    res = await post(B, '/api/admin/me/password', { current: DEMO.password, password: 'Locked-Out-Everyone-1' }, cookie);
    assert.strictEqual(res.status, 403, 'a visitor cannot change the shared password');
    res = await post(B, '/api/admin/team', { email: 'friend@gmail.com', name: 'Friend' }, cookie);
    assert.strictEqual(res.status, 403, 'or invite people');
    console.log('2b. /demo guide: sign-in details, code in the inbox, sandboxed emails, password and team locked ✓');

    // ---- 3. Real queries return the seed ----
    const get = async (p) => (await fetch(B + p, { headers: { Cookie: cookie } })).json();
    const pipe = await get('/api/admin/projects');
    assert.strictEqual(pipe.pending.length, 1, JSON.stringify(Object.keys(pipe)));
    assert.strictEqual(pipe.pending[0].company_name, 'Kariba Logistics');
    const delivery = await get('/api/admin/delivery');
    assert(delivery.some((p) => p.project_id === 'KOPJEW-6TD-5LH' && p.phases.length >= 7));
    const track = await (await fetch(`${B}/api/track?projectId=KOPJEW-6TD-5LH&email=rudo@kopjeworks.example`)).json();
    assert(JSON.stringify(track).includes('Microsoft 365 Security Hardening'), 'public tracking finds the sample project');
    const all = JSON.stringify(await get('/api/admin/directory'));
    assert(!/@(gmail|yahoo|outlook)\.|autowerkeit\.co\.zw/.test(all) && /\.example/.test(all), 'sample contacts use reserved .example domains');
    console.log('3. pipeline, delivery, tracking and contacts all read the made-up seed ✓');

    // ---- 4. As on Render: an https address (production mode), so codes are not printed ----
    const log2 = boot(P2, { RENDER_EXTERNAL_URL: 'https://autowerke-demo.example/' });
    await ready(log2);
    assert(log2.out.includes('https://autowerke-demo.example/demo'), 'uses the address Render gives it');
    res = await post(B2, '/api/auth/login', DEMO);
    assert.strictEqual(res.status, 200);
    await sleep(300);
    assert(!/code for demo@/.test(log2.out), 'production mode: no codes in the log');
    const code2 = ((await (await fetch(B2 + '/demo')).text()).match(/sign-in code: ([A-Z]{6})/) || [])[1];
    assert(code2, 'but the code is in the /demo inbox');
    res = await post(B2, '/api/auth/verify', { email: DEMO.email, code: code2 });
    assert.strictEqual(res.status, 200);
    assert(/;\s*Secure/i.test(res.headers.get('set-cookie')), 'Secure session cookie on https');
    console.log('4. Render mode: https address, codes only in the /demo inbox, Secure cookies ✓');
    done(0);
  } catch (e) { console.error('FAIL:', e.message, e.stack.split('\n')[1]); console.error(log.out.slice(-800)); done(1); }
})().catch((e) => { console.error('FAIL:', e.message); done(1); });
