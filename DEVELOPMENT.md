# AutoWerke | IT client portal — Development guide

This file is the briefing for anyone working on this repo.
For feature-by-feature history and setup steps, see `docs/BUILD-LOG.md` (the numbered build log).

## What this is
A full-stack client portal and back office for **AutoWerke | IT**, Gil Magezah's IT support and
consulting business in Harare, Zimbabwe (Microsoft 365 / Intune / Entra ID specialist).
Clients request work (IT Support, IT Project, Domains, Consultancy); Gil reviews, quotes, delivers,
gets sign-off, invoices and receipts, all in one app. It's also Gil's portfolio piece for software
engineering roles, so code quality, tests and security matter as much as features.

## Stack and commands
Node.js + Express · Supabase (Postgres + private Storage) · Claude API (`claude-sonnet-4-6`) for
drafting · Resend (email) · PDFKit + pdf-lib (PDFs) · plain HTML/CSS/JS (no framework, no build step).

```
npm install
npm start               # http://localhost:3000
npm run demo            # the whole app on made-up data: no database, keys or email needed
npm test                # all end-to-end suites (in-memory DB; never touches Supabase or sends email)
npm run check-joins     # flags ambiguous Supabase joins (see Gotchas)
npm run sample-pdfs     # one of every PDF the portal sends, with made-up data, in sample-pdfs/
npm run test-email -- you@example.com   # real Resend send, to check email delivery
```
Locally (http, not production), admin sign-in codes and sign-off codes are ALSO printed in the
terminal, so you can't get locked out while testing. Never on the live https site.

## Environment (.env; see .env.example)
| Var | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Server-only service key (bypasses RLS; never expose it to the browser) |
| `ANTHROPIC_API_KEY` | AI drafting (requirements, consultancy replies) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | Email. Sending domain `mail.autowerkeit.com` (or the root) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Bootstrap the owner admin account on first sign-in (then stored scrypt-hashed) |
| `APP_SECRET` | 64-hex secret keying the hashes of codes and session tokens. The live site refuses to start without it (`sec.isProduction()`: NODE_ENV=production, https BASE_URL, or Render) |
| `CREDENTIALS_KEY` | 32-byte base64 key: AES-256-GCM for stored passwords (registry + workspace). Losing it = losing those secrets |
| `BASE_URL` | Public URL. `https://` switches on Secure cookies + HSTS and turns off dev code logging |
| `ADMIN_URL` | Optional, e.g. `https://admin.autowerkeit.com`. Back office answers only on this host (`lib/hosts.js`, BUILD-LOG 25) |
| `REDIRECT_HOSTS` | Optional. Bare domain → portal: `autowerkeit.com` + `www.` are derived from `BASE_URL` and 301 to it. Comma list to override, `none` to switch off (BUILD-LOG 25.3) |
| `VAT_RATE` | Default 15.5 (Zimbabwe) |
| `REMINDER_TIMEZONE` | Default Africa/Harare |
| `CRON_SECRET` | Enables `/api/cron/reminders`, key in an `X-Cron-Key` header only (Render free tier sleeps; an external cron pings this) |
| `GA_MEASUREMENT_ID` | Optional GA4 ID. Loads only after the visitor accepts analytics |
| `PDF_PHONE` | Optional phone number printed in PDF headers. Empty = none (`BRAND_PHONE` stays off PDFs) |
| `INVOICE_PAYMENT_DETAILS` | Bank/EcoCash details printed on invoices (`\n` for new lines) |

## Database setup (Supabase SQL Editor, in this order)
`schema.sql` → `schema_phase3.sql` → `schema_support.sql` → `schema_delivery.sql` → `schema_signoff.sql`
→ `schema_closed.sql` → `schema_earnings.sql` → `schema_support_signoff.sql` → `schema_followups.sql`
→ `schema_services.sql` → `schema_renewals.sql` → `schema_intake_extras.sql` → `schema_secure.sql`
→ `schema_billing.sql` → `schema_accessories.sql` → `schema_website.sql` → **`schema_rls.sql` last** (RLS lockdown + private bucket).
Every schema file ends with `NOTIFY pgrst, 'reload schema';`. `lib/schemaCheck.js` detects
missing columns and tables at startup and shows an admin banner naming the file to run.

## Architecture map
- `server.js`: Express app. Order matters: security headers → host routing (`lib/hosts.js`) → JSON → same-origin check →
  **private files + link rewriting (before every router)** → admin file block → auth / esign /
  workspace / billing routers → rate limits → portal expiry → feature routes → 404 → error handlers.
  It holds only that wiring (about 160 lines). Feature routes live in one router per area, mounted in that order:
  `publicRoutes.js` (settings, legal pages, intake, tracking), `pipelineRoutes.js`, `deliveryRoutes.js`,
  `earningsRoutes.js`, `portalRoutes.js` (the client's link), `followupRoutes.js`, `contactRoutes.js`,
  `domainRoutes.js`, `consultancyRoutes.js`, `reminderRoutes.js` (`runReminders` + the cron ping).
  Shared bits (upload limits, `VIEWS`, `publicError`, `parseMoney`) are in `routeHelpers.js`. New routes go in
  the matching router, never back in `server.js`.
- `lib/`
  - `security.js`: scrypt passwords, one-time codes, HMAC hashing, constant-time compare, rate limits, cookies, CSP/headers, same-origin
  - `auth.js`: admin sign-in (password → 6-letter emailed code → session cookie), `adminAuth` middleware, team.
    "Resend code" needs the one-off ticket a correct password hands out (HMAC in memory, 45 s apart, 3 max, dies on sign-in); never resend by email alone.
    The page (`admin-login.html/.css/.js`) stands alone: no style.css/theme.css
  - `esign.js`: online sign-off (identify → 8-char code → 30-min session → sign → PDF + certificate)
  - `workspace.js`: per-ticket workspace API (templates, encrypted secrets, sharing, timer)
  - `accessoriesRoutes.js`, `reminders.js`, `fxRates.js`: admin accessories API (own reminders + suggestions, encrypted notes + saved notes, FX rates: ECB + market feed every 12 h, ZiG by hand)
  - `debrief.js`: the Debrief email (ongoing work, on hold, reminders, unpaid, renewals) to the signed-in admin only; 30-min cool-down; optional Mondays 07:00 via the reminder check. Settings in `app_settings` `debrief:<admin id>`
  - `businessCard.js`: Business card accessory data (contact, `INVOICE_PAYMENT_DETAILS` split into lines, certifications kept in step with the homepage). Admin-only, `no-store`
  - Accessory files load with `?v=` (`V` in `accessories.js` + `admin-shell.js`): bump it when they change, static files are cached 10 min
  - `billingRoutes.js`, `billing.js`, `trail.js`, `signature.js`: invoices, receipts, document trail, pre-applied signature
  - `storage.js`, `fileAccess.js`: private bucket, `/files/<REF>/<file>` with 60-second signed links
  - `db.js`: every Supabase query. `email.js`: every email (one `sendEmail` wrapper)
  - PDFs: `contract.js`, `estimate.js`, `signoff.js`, `supportSignoff.js`, `billing.js`, `directoryPdf.js`
  - `track.js`: what the public tracking page (reference + email) may show. Never the portal token, file links, project prices or work notes
  - Domain logic: `domains.js`, `consult.js`, `followups.js`, `phases.js`, `priority.js`, `attachments.js`, `directory.js`
- `views/`: admin page HTML, served only by their signed-in routes (never static). Their JS/CSS stay in `public/`.
- `public/`: one HTML + JS (+ CSS) per page. Admin pages use `admin-shell.js` (sidebar, session
  clock, idle sign-out). Client pages use `client.css`, `footer.js`, `consent.js`.
  `status-info.js` and `analytics-core.js` run in both Node and the browser (single source of truth).
- `tests/`: end-to-end suites + `fakedb.js` (an in-memory stand-in patched onto `lib/db.js`).
- `demo/`: `npm run demo`. An in-memory stand-in for the Supabase client (`fake-supabase.js`) seeded with made-up data (`seed.js`), so the real `lib/db.js` queries run unchanged with no accounts or keys. `layer.js` adds `/demo` (a guide plus an inbox of captured emails, shown only for `.example` recipients), blocks password and team changes, and resets after 20 idle minutes. `render.yaml` hosts it on Render's free tier.

## Request types and statuses
- **IT Project:** pending_review → reviewed → (changes_requested) → client_confirmed → pricing_sent → proceeding → signed (delivery phases) → closed
- **IT Support:** … → estimate_sent → in_progress (client uploads the signed estimate) → awaiting_signoff → completed
- **Domains:** domain_requested → domain_quoted → domain_accepted → domain_registered
- **Consultancy:** consult_requested → consult_answered, or consult_meeting_invited → consult_meeting_requested → consult_meeting_confirmed → consult_closed
- Labels, the "ball in whose court" owner, and client copy for every status live in `public/status-info.js`.

## Security rules (keep these)
- **No inline scripts or event handlers.** The CSP is `script-src 'self'` (+ Google Tag Manager only). Put JS in files.
- **Never pattern-match user input in queries** (`ilike`): `%` would match everything. Use `db.cleanRef()` + exact `eq`.
- **Codes and session tokens** are random, stored only as HMAC hashes, single-use, short-lived, attempt-limited.
- **Uploaded files are checked by content (magic bytes)**, never by name or claimed type.
- **The storage bucket is private.** Store files via `storage.uploadSignedContract()`; links leave the server as `/files/...` automatically. Don't hand out raw storage URLs.
- **Identical responses for found and not-found** where probing matters (sign-in, sign-off identify).
- **Admin APIs may show real error detail**; public APIs must not (generic messages, no stack traces).
- **Secrets in workspace and registry are AES-256-GCM encrypted**, decrypted only on an explicit Reveal (logged by who, never the value).
- **Never log or email secrets, codes (except dev-mode terminal), or tokens.**
- Rate limits exist on sign-in, sign-off, submit, track and the portal. **Count per person *and* connection** (`email:ip`, `ref:ip`) with a higher overall cap, so an attacker can't lock the real client or the owner out.
- Portal links expire 30 days after a request is finished: one rule, `lib/portal.js`, used by the portal API **and** `/files` links.
- **Async route errors reach the error handler** via `lib/asyncErrors.js` (required first in `server.js`). Express 4 doesn't do this itself, and one rejected handler used to stop the whole server. Keep it until Express 5.
- **Don't decode `req.params` again**: Express already did, and `decodeURIComponent` throws on `%25E0`.
- Passwords: `sec.hashPassword` / `verifyPassword` are **async** (scrypt off the main thread). Always `await` them.
- **Client IPs come from `sec.clientIp()` (`req.ip` + `trust proxy`)**, never the first `X-Forwarded-For` entry (client-written).
- **References look like `TANNER-7KQ-4X9`** (`db.generateProjectId`: name + 6 characters, no look-alikes). Old `TANNER-5422` ones stay valid; `db.cleanRef` forgives lower case and spaces.
- **The tracking page never shows the private link.** "Email me my private link" (`POST /api/track/link`) only mails the address on file: same answer either way, max 3 an hour per request.
- **Portal actions name the stages they're allowed from** (`db.updateByToken(token, fields, [stages])`). No unguarded status writes by token.
- **Public routes use `publicError()`**: real messages only for errors raised on purpose (`err.status`).
- **Read uploads only after the auth check** when the route needs a session or a link (`signingSessionFirst` in `esign.js`, `portalLinkFirst` in `portalRoutes.js`). Store files with the type detected from their content, never `file.mimetype`.
- **Workspace files live in `ws_<REF>/`**; `fileAccess.js` applies workspace sharing to them and never accepts a client token.
- **Escape helpers escape `& < > " '`**: safe in text and quoted attributes. Keep it that way in new pages.
- **`.env.example` holds placeholders only.** It's committed; real keys go in `.env` (gitignored).

## Design system
Palette (CSS variables in `public/theme.css`): paper `#F4F1E8`, racing green `#2F4A3B`, bright green
`#5BA35E` for selected states only, ink `#1F2622`, muted `#7B7B70`. Typewriter type is Courier Prime
for headings, labels and numbers, with a system sans for body text. Admin = sidebar + green header
band (`window.setBandStats`). Client pages = centred cards. Emails use Courier New (no web fonts) and table layouts.

## Gotchas we hit (read before changing things)
1. **Ambiguous Supabase joins.** `workspace_shares` has two foreign keys to `admin_users`, and an unnamed embed fails. Always name the join (`admin_users!admin_id(...)`); `npm run check-joins` enforces it. The in-memory test DB can't catch this.
2. **CSS `.hidden` vs `display:` rules.** A class that sets `display: grid` beats `.hidden` if it loads later. Add `.thing.hidden { display: none; }`.
3. **`style.css` has `form input { width: 100% }`.** Checkboxes and other inputs inside forms need explicit sizing.
4. **Middleware order.** Anything that wraps `res.json` must be registered before the routers it should affect.
5. **Python patch scripts:** use raw strings for JS containing `\n`, or the escapes become real newlines.
6. **Timezones:** reminder maths uses `REMINDER_TIMEZONE`; never trust the server's local time (Render runs on UTC).
7. **`Number('') === 0`**: validate money inputs as strings first (`parseMoney`, `cleanLines`).
8. **pdfkit standard fonts have no ✓ glyph**: draw ticks as vector paths.
9. **The sandbox/workspace can reset**: commit early and often.

## Testing approach
`tests/*.test.js` boot the real server in-process on its own port, after patching `lib/db.js` with
`tests/fakedb.js` and stubbing storage + `fetch` (Resend/Anthropic). Emails are captured, so tests
read real one-time codes from them. Suites are adversarial: they try wrong codes, reuse, expired
sessions, cross-site requests, path traversal, other clients' tokens and renamed executables.
Add a test with every feature. For UI work, Playwright screenshots at desktop and 375px mobile.

## Legal and compliance (drafted, not lawyer-reviewed)
Pages: `/privacy`, `/cookies`, `/terms`, `/service-terms` (version `2026-10` in `lib/legal.js`
`LEGAL_VERSION`; bump it on material changes). Follow Zimbabwe's Cyber and Data Protection Act
[Ch. 12:07] + SI 155 of 2024, and South Africa's POPIA; Zimbabwean law prevails, with
non-waivable SA rights preserved. The intake form requires agreement, recorded as `consent_at`
and `consent_version`. **Action for Gil:** a POTRAZ data controller licence + DPO appointment,
and (if serving SA) Information Officer registration.

## Roadmap / not done yet
- **Go live:** Render deploy at `portal.autowerkeit.com` + `admin.autowerkeit.com` (`ADMIN_URL`, BUILD-LOG 25.1), env vars, run `schema_rls.sql`, cron ping, email setup (Porkbun forwarding → Gmail; Gmail "Send mail as" via Resend SMTP).
- Lawyer review of the legal pages; POTRAZ licensing.
- AI domain-price search (~10 minutes after a domain request, three cheapest options or alternatives).
- SMS option for sign-off codes.
- Hosted demo: create the Render service from `render.yaml`, then check the README link matches its address.
- Express 5 / newer dotenv (deliberately deferred: breaking changes).
- Accessories: run `schema_accessories.sql` on the live DB; check the Zimbabwe holiday list (`acc-core.js` `zimHolidays`) against each year's gazette.

## Notes added November 2026
- **Saved PDFs never change on their own.** An invoice or receipt PDF is stored when it's issued, so layout fixes or a signature added later only affect new documents. Use **Rebuild PDF** (`POST /api/admin/invoices/:id/rebuild`, `POST /api/admin/receipts/:id/rebuild`, optional `{ send: true }`): same number and amounts, new layout and signature. The original stored copy is kept.
- **`INVOICE_PAYMENT_DETAILS`** prints one detail per line: it splits on new lines and on " · " separators.
- **Tests run on Windows:** `tests/pdftext.js` uses `pdftotext` when installed, otherwise reads the PDF in Node (zlib). Simulate the Windows path with `FORCE_PDF_TEXT_FALLBACK=1 npm test`.
- **Billing action buttons** use named grid areas in `public/services.css` (`.bl-actions`). A new button needs its own `grid-area`, or it lands on a stray extra row.
