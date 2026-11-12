// Runs the full app on made-up data, with no accounts or keys needed:  npm run demo
//
// - The database is an in-memory stand-in (demo/fake-supabase.js) seeded from demo/seed.js.
//   The real query code in lib/db.js runs unchanged against it. A restart resets everything.
// - Emails are not sent: the subject and recipient are printed here instead.
// - AI drafting returns a canned draft unless you set ANTHROPIC_API_KEY.
// - /demo is a guide page with an inbox of those emails, so the sign-in code can be read there.
//   Locally the codes are also printed here (development mode).
// - On Render (npm run demo as the start command) it uses the address Render gives the service.
const path = require('path');
const Module = require('module');
const { createFakeSupabase } = require('./fake-supabase');
const { seed } = require('./seed');
const { createDemoLayer } = require('./layer');

const PORT = Number(process.env.PORT) || 3000;
// Render sets RENDER_EXTERNAL_URL (https), which also switches on Secure cookies and HSTS
const BASE_URL = (process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DEMO_ADMIN = { email: 'demo@autowerke.example', password: 'Demo-Back-Office-2026', name: 'Demo Admin' };

Object.assign(process.env, {
  PORT: String(PORT),
  BASE_URL, // http locally = development mode: codes also print in this terminal
  REDIRECT_HOSTS: 'none',
  SUPABASE_URL: 'http://demo.invalid',
  SUPABASE_SERVICE_KEY: 'demo',
  RESEND_API_KEY: 'demo',
  ADMIN_EMAIL: DEMO_ADMIN.email,
  ADMIN_PASSWORD: DEMO_ADMIN.password,
  ADMIN_NAME: DEMO_ADMIN.name,
  APP_SECRET: process.env.APP_SECRET || require('crypto').randomBytes(32).toString('hex'),
  CREDENTIALS_KEY: process.env.CREDENTIALS_KEY || require('crypto').randomBytes(32).toString('base64'),
  FX_RATES_AUTO: 'off',
  INVOICE_PAYMENT_DETAILS: 'Bank: Demo Bank · Account name: AutoWerke IT · Account: 0000000000\nEcoCash: 077 000 0000',
});
delete process.env.NODE_ENV; delete process.env.RENDER; delete process.env.ADMIN_URL;

// Every createClient() in the app gets the same in-memory database
const tables = seed();
const fake = createFakeSupabase(tables);
const demo = createDemoLayer({
  admin: DEMO_ADMIN,
  reset() { for (const k of Object.keys(tables)) delete tables[k]; Object.assign(tables, seed()); fake._files.clear(); },
});

// The app's express() gets the demo pages mounted first, ahead of the real middleware
const realLoad = Module._load;
let wrappedExpress = null;
Module._load = function load(request, parent, isMain) {
  if (request === '@supabase/supabase-js') return { createClient: () => fake };
  const mod = realLoad.call(this, request, parent, isMain);
  if (request !== 'express') return mod;
  if (!wrappedExpress) {
    let mounted = false;
    wrappedExpress = Object.assign(function express(...args) {
      const app = mod(...args);
      if (!mounted) { mounted = true; demo.mount(app); }
      return app;
    }, mod);
  }
  return wrappedExpress;
};

// Outgoing calls: print emails, answer AI drafting with a canned reply, let everything else through
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.resend.com')) {
    const body = JSON.parse(opts.body || '{}');
    demo.capture(body);
    console.log(`[demo email] to ${[].concat(body.to).join(', ')}: ${body.subject}`);
    return new Response(JSON.stringify({ id: `demo-${Date.now()}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.startsWith('https://api.anthropic.com') && !process.env.ANTHROPIC_API_KEY_REAL) {
    const req = JSON.parse(opts.body || '{}');
    const text = req.max_tokens <= 60 ? 'Demo Request' : JSON.stringify({
      project_title: 'Demo Request',
      title: 'Demo Request',
      requirements: ['Confirm the scope with the client', 'Plan and carry out the work', 'Hand over with short documentation'],
      scope_summary: 'This is a demo draft. With an Anthropic API key, Claude drafts the requirements and summary from what the client wrote.',
      response: 'Thank you for your message. This is a demo reply; with an Anthropic API key, Claude drafts a tailored answer here.\n\nKind regards,\nAutoWerke | IT',
      suggest_meeting: true,
    });
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(url, opts);
};
if (process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY_REAL = '1';

require(path.join(__dirname, '..', 'server.js'));

setTimeout(() => {
  console.log(`
  AutoWerke | IT demo (made-up data; no emails or data leave this process)
  ---------------------------------------------------------------
  Start here:    ${BASE_URL}/demo   (guide, sign-in details and the inbox)
  Client site:   ${BASE_URL}
  Back office:   ${BASE_URL}/admin
    email        ${DEMO_ADMIN.email}
    password     ${DEMO_ADMIN.password}
    then the 6-letter code, in the inbox at /demo (and printed below when running locally)
  Track a request: ${BASE_URL}/track  (try KOPJEW-6TD-5LH with rudo@kopjeworks.example)
`);
}, 600);
