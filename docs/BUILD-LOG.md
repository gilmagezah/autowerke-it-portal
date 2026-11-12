# Build log: how the AutoWerke | IT portal was built, phase by phase

Phase 1 scope: a client-facing intake form (IT Support vs IT Project), an AI
pass that drafts structured requirements + a scope summary from what the
client submits, and an email to you with both the raw submission and the AI
draft so you can review it.

Nothing here needs a database yet — submissions are saved to a local JSON
file (`data/projects.json`) so you can see them, and Phase 2 swaps that file
for a real database once the review dashboard is built.

---

## 1. Accounts you need to create (all free to start)

Do these once, in this order, before running anything.

### 1.1 Node.js (if not already installed)
- Go to https://nodejs.org and install the **LTS** version.
- Check it worked: open a terminal and run `node -v` — you should see a
  version number like `v20.x.x`.

### 1.2 Anthropic API key (for the AI drafting step)
- Go to https://console.anthropic.com
- Sign up / log in, then go to **Settings → API Keys**
- Click **Create Key**, name it `project-intake`, copy the key
  (starts with `sk-ant-...`) — you won't see it again, so paste it
  somewhere safe immediately
- Add a small amount of credit (e.g. $5) under **Billing** — this app's AI
  calls cost fractions of a cent each, so $5 covers a very large number of
  test submissions

### 1.3 Resend account (for sending you the review email)
- Go to https://resend.com and sign up (free tier: 100 emails/day, 3,000/month)
- Go to **API Keys → Create API Key**, name it `project-intake`, copy it
  (starts with `re_...`)
- For now, use their built-in test sender `onboarding@resend.dev` — it
  works immediately with zero setup. (Later, if you want emails to come
  from your own domain like `noreply@yourcompany.com`, you'd verify that
  domain under **Domains** in Resend — not needed for Phase 1.)

### 1.4 GitHub repo
- Create a new repo, e.g. `project-intake-system`
- This is what goes on your GitHub profile

### 1.5 (Later, not yet) Render account — for deploying it online
- Go to https://render.com and sign up with GitHub
- You'll connect this repo when we get to deployment at the end of Phase 1
- Free tier is enough for a portfolio demo (it just sleeps after inactivity
  and takes ~30s to wake up — mention that in your README so nobody thinks
  it's broken)

---

## 2. Stack (Phase 1)

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js + Express | Simple, one process, easy to explain in an interview |
| Frontend | Plain HTML/CSS/JS (no framework yet) | Zero build step, fastest to ship, still looks real |
| AI drafting | Claude API (`claude-sonnet-4-6`) | Turns a raw client submission into structured requirements + scope summary |
| Email | Resend API | Free tier, no SMTP/app-password headaches |
| Storage (Phase 1 only) | Local JSON file | Placeholder until Phase 2 adds Supabase |
| Hosting (later) | Render free tier | One command deploy from GitHub |

This table is also your answer if anyone asks "what's your stack" in an interview.

---

## 3. Setup

```bash
cd project-intake-app
npm install
cp .env.example .env
```

Open `.env` and fill in the two keys you generated above:

```
ANTHROPIC_API_KEY=sk-ant-...
RESEND_API_KEY=re_...
ADMIN_EMAIL=your-real-email@example.com
```

Run it locally:

```bash
npm start
```

Then open http://localhost:3000 in your browser, fill out the form, and
submit. Check:
1. The terminal logs a new entry
2. `data/projects.json` now has your submission
3. Your `ADMIN_EMAIL` inbox has a review email with the AI-drafted
   requirements and scope summary

---

## 4. Phase 2 — Review dashboard + client confirmation

Adds: a real database, a password-protected admin dashboard where you edit
the AI draft and approve it, and a client-facing page where they confirm
(or request changes to) the reviewed scope.

### 4.1 Sign up for Supabase
- Go to https://supabase.com, sign up, click **New Project**
- Pick any region close to you, set a database password (save it somewhere,
  though you won't need it directly — the API key is what the app uses)
- Once it's created, go to **Project Settings → API** and copy:
  - **Project URL**
  - The **`service_role`** secret key (NOT the `anon` key — the service
    role key is what lets the server read/write freely; never put this key
    in any frontend code)

### 4.2 Create the database table
- In Supabase, go to **SQL Editor → New Query**
- Open `schema.sql` in this project, paste its contents in, click **Run**
- This creates the `projects` table that replaces the old JSON file

### 4.3 Update your `.env`
Add these to the `.env` file you already have from Phase 1:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-real-password
BASE_URL=http://localhost:3000
```

### 4.4 Install the new dependency and run it
```bash
npm install
npm start
```

### 4.5 Try the full loop
1. Submit a request at `http://localhost:3000` (same as Phase 1)
2. Go to `http://localhost:3000/admin` — your browser will prompt for the
   username/password you set in `.env`
3. You'll see the submission with the AI-drafted requirements and scope
   summary, editable inline
4. Click **Approve & send to client** — this emails the client (the email
   address they submitted) a confirmation link
5. Open that link (check the email, or check `data`/logs if testing with
   your own address) — you'll see the client-facing confirmation page
6. Click **Yes, this is correct** — you (the admin) get a notification
   email that the scope was confirmed
   - Or click **Request changes** with a message — you get notified with
     what they want changed instead

### 4.6 What's NOT built yet (Phase 3 and beyond)
- No pricing page or contract generation (Phase 3)
- No project ID / tracking portal (Phase 4)
- No WhatsApp — see note in the main project plan; this stays a `wa.me`
  link at most, never a full API integration, to keep costs at zero

Keeping each phase's scope tight on purpose — a working, deployed intake
form is a complete, demoable thing on its own, and so is this review loop.

## 5. Phase 3 — Pricing + contract

Adds: sending a brief pricing estimate, the client deciding whether to
proceed, a downloadable contract PDF, and a place for them to upload the
signed copy back.

### 5.1 Create a storage bucket in Supabase
- In Supabase, go to **Storage → New bucket**
- Name it exactly `contracts`
- Toggle it **Public** (simplest for this demo — signed contract links work
  without extra auth; fine for a portfolio project, not for real client
  contracts with sensitive data)

### 5.2 Run the schema update
- SQL Editor → New Query → paste in `schema_phase3.sql` → Run

### 5.3 Install new dependencies
```bash
npm install
```
(adds `pdfkit` for generating the contract PDF, and `multer` for handling
the signed-file upload)

### 5.4 Try the full loop
1. Take a project through Phase 2 until it's `client_confirmed`
2. Go to `/admin` — you'll now see a second section, **Awaiting Pricing**
3. Enter a brief estimate, click **Send pricing to client**
4. Client gets an email, clicks through to the same portal link as before —
   it now shows the estimate and a Yes/No choice
5. If they click **Yes, proceed** — the page updates to show a contract
   download link and a file upload field
6. Download the PDF, "sign" it (or just re-upload it as-is for testing),
   upload it back
7. You get a final email with a link to the signed file in Supabase Storage

### 5.5 What's NOT built yet (Phase 4)
- No unique project-ID search/tracking page with a progress bar — right
  now the client's one portal link already shows live status, which
  covers most of what Phase 4 wanted; Phase 4 can focus on the progress
  bar / visual polish and letting them look it up by ID alone (without
  the original link)
- IT support ticket side is still separate, not started

## 6. Phase 4 — Public tracking by ID + progress bar

No new sign-ups needed for this one — it's pure application logic on top
of what's already there.

### 6.1 What's new
- A `/track` page: client enters their reference number (e.g. `ACME-1234`)
  and the email they submitted with — no link required
- Verified by ID + email together (not ID alone), so someone can't
  wander in and look up a stranger's request just by guessing a reference
  number
- A visual progress bar (Submitted → Scope Review → Scope Confirmed →
  Pricing → Contract → Complete), with a separate message for a declined
  request
- A "track it here" link added to the main intake form

### 6.2 Try it
1. `npm start`
2. Submit a request, take it through a phase or two in `/admin`
3. Go to `/track`, enter the project's reference number and the email
   used at submission
4. You should see the progress bar reflecting the current stage

### 6.3 What's left after this
- IT support ticket side (separate from the project-intake flow) —
  now built, see section 7
- The customization backlog from Phase 3: pricing email line breaks,
  PDF branding/logo, and the client access-details step after signing

## 7. IT Support side — hourly work + time tracking

The "IT Support" choice on the intake form now has its own back half,
running in parallel to the IT Project flow: instead of a fixed-scope
contract, support tickets get an hourly estimate and a visual log of time
actually worked.

### 7.1 Run the schema update
- SQL Editor → New Query → paste in `schema_support.sql` → Run

### 7.2 What's new on intake
- Choosing "IT Support" reveals: users affected, devices affected, and
  what's already been tried — plus a note that support is billed at
  $50–$75/hour
- These extra details get passed to the AI draft too, so the drafted
  "requirements" read as diagnostic/resolution steps rather than project
  deliverables

### 7.3 The flow
1. Client submits → AI drafts a situation summary + steps (same review
   dashboard as IT Project)
2. Admin approves → client confirms the situation is understood correctly
   (same as Phase 2)
3. Admin dashboard now has an **Awaiting Estimate** section — enter
   estimated hours and an hourly rate ($50–$75)
4. Client gets emailed, opens their same portal link, sees the hours ×
   rate breakdown and a downloadable estimate PDF, and approves or
   declines
5. Once approved, the ticket moves to **In Progress** in the admin
   dashboard, where you log actual time worked — date, start time, end
   time, optional note
6. The client's portal link now shows a visual timeline: each day gets a
   row, and logged sessions appear as colored blocks positioned by time
   (hover for exact times and notes)
7. Mark the ticket **Completed** when done — client sees a final summary
   of hours logged

### 7.4 Try it
1. `npm start`
2. Submit an "IT Support" request with the extra fields filled in
3. Approve it in `/admin`, confirm as the client via the portal link
4. In the new **Awaiting Estimate** section, send an estimate (e.g. 3
   hours at $60/hour)
5. Approve it as the client
6. In **In Progress**, add a couple of time entries on different dates
7. Refresh the client's portal link — you'll see the timeline update
8. Mark it completed from the admin side

### 7.5 Notes on the time tracking display
- The visual axis is fixed to 8:00–18:00 (a typical business day); entries
  outside that window still log correctly but display clamped to the edge
- Entries are grouped and shown by calendar day, most recent last
- Admin can remove a wrongly-logged entry by hovering the block and
  clicking the ✕ that appears next to the tooltip

### 7.6 Still not built
- The customization backlog from Phase 3 (email line breaks, PDF
  branding/logos, client access-details step) — still pending, as noted
  above

## 8. Unified tracking + admin overview

No new sign-ups and no new SQL for this one — projects and support
tickets already share the `projects` table, so both features work off
what's there.

### 8.1 Unified `/track`
- One search (reference number + email) now works for **both** IT
  Projects and IT Support tickets
- Projects show the project steps: Submitted → Scope Review → Scope
  Confirmed → Pricing → Contract → Complete
- Support tickets show their own steps: Submitted → Review → Confirmed →
  Estimate → In Progress → Resolved, plus the hours × rate estimate and
  the time-logged timeline once work has started
- The `/confirm/...` links in emails keep working exactly as before
- Fixes a latent bug: previously a support ticket in progress or
  completed showed on `/track` as stuck at step 1, because the page only
  knew project statuses

### 8.2 Admin overview
- Summary cards at the top of `/admin`: companies, IT projects, support
  tickets, and items active right now
- A per-company table (projects / support / active), grouped
  case-insensitively so "Acme" and "ACME " count as one company
- Click a company to filter every section below it; click again (or
  "Show all companies") to clear
- "Active" = anything not yet finished: pending review, reviewed,
  changes requested, confirmed, pricing/estimate sent, proceeding, or in
  progress. Signed, completed, and declined don't count.

### 8.3 Try it
1. `npm start`, open `/admin` — the overview loads above the lists
2. Click a company row and check only its items remain below
3. Look up a support ticket that's in progress on `/track` — you should
   see the support steps, the estimate, and the timeline

## 9. Line breaks, change requests, and project delivery tracking

### 9.1 Run the schema update
- SQL Editor → New Query → paste in `schema_delivery.sql` → Run
  (adds the `phases` and `last_progress_update_at` columns)

### 9.2 Line breaks now respected
- Pricing estimates, scope summaries, and change requests keep the line
  breaks you type, in emails (converted to `<br>` after escaping, so
  it's still safe) and on the web pages (via `white-space: pre-line`)
- The pricing box in `/admin` is taller and hints "one item per line"

### 9.3 Change requests come back to you
- When a client clicks **Request changes**, the project now appears in a
  new **Changes Requested** section on `/admin`
- The client's request is highlighted at the top, and the editor starts
  from the scope they last saw (not the original AI draft)
- Requirement lines can now be added and removed (in both review and
  change-request cards)
- **Send revised scope to client** emails them an "updated scope" version
  to confirm, and the normal flow continues from there

### 9.4 Project delivery tracking (`/admin/projects`)
Internal-only page for IT projects whose contract is signed.
- **Set up default phases** seeds an 8-phase IT project template
  (Kickoff → Access → Planning → Build → Testing → Rollout → Handover →
  Sign-off), each with "what to do at this stage" instructions
- Rename, reorder, add, or remove phases per project
- Tick a phase to complete it (today's date fills in automatically and
  can be edited); the first unticked phase is marked **Current**
- Each phase also holds internal notes and optional planned start/end
  dates (the planned dates are there for the future Gantt chart)
- Phases collapse to one line with a summary (e.g. "Done 29 Sep · Has
  notes"); only the current phase opens by default
- **Send progress update** emails the client phase headings and
  completion only, plus an optional message. Instructions and notes are
  never included. **Preview email** shows exactly what they'll get,
  including unsaved changes
- **Mark project delivered** finishes the project

Status flow for IT projects now continues past signing:
`signed` (in delivery) → `delivered`. On `/track`, projects gain an
**In Delivery** step, and signed projects now count as "active" in the
admin overview.

### 9.5 Try it
1. Take an IT project through to a signed contract
2. Open `/admin/projects` (or click **Project delivery** in the admin nav)
3. Set up phases, tick the first one, add a note, and save
4. Type a message, click **Preview email**, then **Send progress update**

## 10. Project titles + sign-off documents

### 10.1 Setup
- SQL Editor → New Query → paste in `schema_signoff.sql` → Run
- Optional: add `COMPANY_BRAND=AutoWerke | IT` to `.env` (this is the
  "Prepared by" name on sign-off documents; it defaults to that anyway)

### 10.2 Project titles
- New requests get a short AI-drafted title (e.g. "Microsoft 365
  Migration"), editable on the review card before you approve
- Delivery cards show the title as the heading, plus a one-line scope
  snippet. Projects without a title show **Add a title**, with a
  **✨ Suggest** button that asks AI for one (you still review and save
  it). Press Enter or click Save.

### 10.3 Sign-off flow
1. Tick off every phase. The next progress update email then says
   "Your sign-off document will be sent to you shortly."
2. The **Sign-off document** section on the delivery card unlocks.
   It stays locked (showing "3 of 8 done") until every phase is ticked.
3. **Prepare sign-off document** opens an editor pre-filled from the
   project: cover title, introduction (from the scope), objectives (from
   the requirements), acceptance statement, and the client signatory.
   Add outstanding issues (leave empty for "None") and recommendations,
   one per line.
4. **Preview PDF** shows the exact document; **Send sign-off to client**
   emails it as a PDF attachment
5. The client downloads it from their portal link, signs it, and
   uploads the signed copy; you get an email with a link to it
6. The client's upload **officially closes the project** (see 11)

The PDF follows the AutoWerke | IT template: cover page, table of
contents with correct page numbers (they adjust when content runs onto
extra pages), 1 Introduction, 2 Project Overview (objectives, outstanding
issues, recommendations), and 3 Acceptance Sign-off.

### 10.4 Left for later (by design)
- Logo in the header, and our signature pre-applied to the AutoWerke | IT
  signature block. The cover and signature areas are kept simple so these
  slot in easily.

## 11. Closing projects

### 11.1 Setup
- SQL Editor → New Query → paste in `schema_closed.sql` → Run

### 11.2 How it works
- The client uploading the signed sign-off **closes the project** and
  stamps the date and time. The "Mark project delivered" button is gone.
- **Project Closed — (date, time)** then shows on the client's portal
  link, on `/track` (every step ticked through to **Closed**), and in
  `/admin/projects`
- Closed projects move to the bottom of the delivery page as read-only
  cards, with links to the signed copy and the sign-off you sent. The
  server also rejects any edits to a closed project.
- **Close manually** (small link at the bottom of an open card) is for a
  client who signed some other way, e.g. on paper. The card then says
  "Closed manually".
- Projects marked "delivered" before this change still accept the signed
  upload, which closes them. They show as **Awaiting sign-off** in admin.

## 12. Branding

All brand files live in `public/brand/`. The naming: `-light` files are
for **light backgrounds** (dark #141414 artwork); `-dark` files are for
**dark backgrounds** (off-white #F4F2EE artwork).

| Where | What's used |
|---|---|
| Sign-off PDF | Logo on the cover and on every page header; brand palette for the cover box and section bars (cream with a thin ink rule, so it still reads when printed) |
| Contract + estimate PDFs | Logo header with an ink rule |
| All emails | Branded layout with the logo header; sender name "AutoWerke \| IT" |
| Client pages (form, portal, track) | Logo at the top |
| Admin pages | Logo + "Admin" above the nav |
| Browser tab | Your favicons: dark tile on light browser themes, cream tile on dark themes |

**Email logo and localhost:** email apps download images from the
internet, so they can't reach a logo hosted on `localhost`. While
testing locally, emails show a text wordmark instead of a broken image.
Once deployed (with `BASE_URL` set to the public address), the real logo
appears automatically.

**Sender address:** emails currently come from
`"AutoWerke | IT" <onboarding@resend.dev>`. Once your domain is verified
in Resend, set `EMAIL_FROM` in `.env` to send from your own address.

If a logo file is ever missing, PDFs still generate (just without it).

## 13. Support → project conversion, earnings, contact details

### 13.1 Setup
- SQL Editor → New Query → paste in `schema_earnings.sql` → Run
- Optional `.env` settings (defaults shown in `.env.example`): `VAT_RATE`,
  `BRAND_EMAIL`, `BRAND_PHONE`, `BRAND_LOCATION`, `BRAND_TAGLINE`

### 13.2 Converting a support request into a project
- Support cards in **Pending Reviews**, **Changes Requested**, and
  **Awaiting Estimate** have **"Too complex for support? Convert to
  project"**. Write the reason for the client (a suggested wording is
  pre-filled), then **Convert & email client**.
- The client gets an email with your reason, what changes for them
  (fixed project price instead of hourly billing), and what happens next
  for their stage. Their reference number stays the same.
- It continues from the equivalent stage: pending review stays pending
  review, a confirmed situation becomes "awaiting pricing", and a sent
  support estimate is withdrawn in favour of a project price.
- Blocked once work has started (hours logged), so billed time is never
  orphaned.

### 13.3 Earnings (`/admin/earnings`)
- **Earned** = closed projects + completed support tickets. **Committed**
  = agreed but not closed (proceeding, signed, in delivery, support in
  progress). **Quoted** = price sent, waiting on the client.
- Filters: All / Projects / Support, period (this month → all time),
  company, and Excl. / Incl. VAT
- Shows earned total, pipeline, average project value, win rate, VAT
  collected, support hours billed, effective hourly rate, average days
  from request to close, a monthly chart, the pipeline breakdown,
  earnings by company (click to filter), and an itemised list
- **Money rules:** amounts are stored excl. VAT; VAT is added where it
  applies. Project value = the **contract value** you now enter when
  sending pricing (not shown to the client; your free-text pricing is
  unchanged). Support value = logged hours × rate.
- Projects priced before this update appear in a "needs a contract value"
  box at the top, with your original pricing text as a hint. They're left
  out of the totals until you enter a value (never silently counted as $0).

### 13.4 Contact details
- Every email ends with the AutoWerke IT signature (logo, email, phone,
  location, services line). The logo uses `autowerke-it-logo-email.png`
  once deployed, and text while testing on localhost.
- Client pages (form, portal, track) have a matching footer
- Contact details also appear on the sign-off cover and the contract and
  estimate headers
- Change them in one place: the `BRAND_*` settings in `.env`

## 14. Database health check

If a `schema_*.sql` file is missed, or Supabase's API layer is still
using an old copy of the table ("Could not find the '...' column ... in
the schema cache"), the app now tells you exactly what to do:

- **On startup**, the terminal prints `Database schema: OK` or lists what
  to run
- **In admin**, a red banner appears on every admin page naming the file
  to run (or the cache-reload command), with a **check again** button
- **Error messages** caused by this now end with the fix

Every schema file now ends with `NOTIFY pgrst, 'reload schema';`, so
running a file also refreshes Supabase's cache. If you ever need it on
its own, run that line in the SQL Editor.

## 15. Support completion sign-off + "New" badge

### 15.1 Setup
- SQL Editor → New Query → paste in `schema_support_signoff.sql` → Run
  (the admin banner reminds you if you forget)

### 15.2 Support completion sign-off
- In **In Progress**, **Mark completed** is now **Complete & send
  sign-off** (with a **Preview sign-off PDF** link). Before sending, a
  prompt shows the hours, rate and total due. If no hours were logged it
  warns you that the approved estimate will be billed instead.
- The client is emailed a branded PDF containing every logged session, a
  visual of the hours per day, the rate, subtotal, VAT (15.5%) and total
  due, and a signature section. Hours are locked once it's sent.
- The ticket moves to **Awaiting Client Sign-off**, with View PDF, Resend,
  and Close manually (for a client who signs on paper)
- The client's portal shows the timeline and amount due, with download
  and upload. Uploading the signed copy **completes the ticket**.
  `/track` gains a **Sign-off** step.

### 15.3 Earnings rules for support
- A support ticket only counts as **earned** once the client signs off.
  While waiting, it counts as **committed** at the locked-in amount.
- Support is always shown **without VAT** in earnings (both views). The
  client's PDF still includes VAT; project earnings are unchanged.

### 15.4 "New" badge in project delivery
- Projects whose contract was signed in the last 7 days show a small
  **New** badge, and the newest projects are listed first
- Projects signed before this update (no signing date recorded) show it
  until delivery is set up

## 16. Sending from your own domain (Resend)

We verify the subdomain `mail.autowerkeit.com` (Resend's recommended
practice), which keeps app email reputation separate from your everyday
Microsoft 365 mail on `autowerkeit.com`.

1. **Resend → Domains → Add Domain** → `mail.autowerkeit.com`
2. **Porkbun → DNS**: add each record Resend shows. In the Host field,
   enter only the part before `.autowerkeit.com`, e.g. `send.mail` and
   `resend._domainkey.mail` (Porkbun adds the rest)
3. Back in Resend, click **Verify DNS Records** (minutes to a few hours)
4. In `.env`:
   ```
   EMAIL_FROM=AutoWerke | IT <noreply@mail.autowerkeit.com>
   EMAIL_REPLY_TO=services@autowerkeit.com
   ```
5. Test it: `npm run test-email -- someone@example.com`. Use an address
   that is NOT your Resend login. If it arrives, real clients will get
   emails too. The command explains common problems in plain English.

## 17. New admin design, signed estimates, payment follow-ups

### 17.1 Setup
- SQL Editor → New Query → paste in `schema_followups.sql` → Run
- Optional `.env`: `REMINDER_TIMEZONE` (default `Africa/Harare`) and
  `CRON_SECRET` (see 17.5)

### 17.2 The new admin design
- Left sidebar (Pipeline · Project delivery · Earnings · Follow-ups),
  with a green header band on every page showing the key numbers
- Palette: paper white `#F4F1E8`, racing green `#2F4A3B`, bright green
  `#5BA35E` for selected states only
- Type: Courier Prime (typewriter) for headings, labels and numbers; the
  system sans-serif for reading text
- All colours live as variables at the top of `public/theme.css`, so the
  whole look can be adjusted in one place
- Project progress emails use the same look (Courier New in email apps,
  which can't load web fonts)

### 17.3 Signed support estimates
- The client's estimate page now asks them to download the estimate,
  sign it, and upload the signed copy. **The upload is their approval**;
  work can't start without it (the old "Yes, approve" button is gone, and
  the server rejects it)
- You get an email with a link to the signed copy, and the in-progress
  ticket shows **✓ Signed estimate**

### 17.4 Follow-ups (`/admin/follow-ups`)
- **New follow-up**: pick existing work to pre-fill company, contact,
  email, reference and amount due (incl. VAT for projects; the support
  total), or type it in. Add a due date and internal notes.
- **Reminders to you**: daily, or weekly on a chosen day, at a chosen time
  (in `REMINDER_TIMEZONE`). Every payment due at once arrives as **one
  digest email** to `ADMIN_EMAIL`, until the payment is marked paid. Use
  **Send me a test reminder** (in Edit) to see one straight away.
- **Follow up**: opens a pre-written, editable payment reminder to the
  client's email, with your signature. The row counts how many you've
  sent.
- **Paid** stops reminders; **Reopen** restarts them
- The register shows overdue / due today / upcoming under each date, with
  totals in the green band and the footer

### 17.5 Reminders when the app sleeps (important on Render's free tier)
The app checks for due reminders every minute **while it's awake**.
Render's free tier puts it to sleep after inactivity, and a sleeping app
can't send anything. The free fix:
1. Set `CRON_SECRET` in your Render environment to a long random string
2. Create a free job at a cron service (e.g. cron-job.org) that calls
   `https://portal.autowerkeit.com/api/cron/reminders` every 15 minutes, with a
   custom request header `X-Cron-Key: YOUR_CRON_SECRET` (cron-job.org: Advanced →
   Headers). The key in the URL (`?key=...`) is refused: URLs end up in logs.

That wakes the app and runs the same check, so reminders arrive within
about 15 minutes of their time. Without `CRON_SECRET` set, that URL is
switched off.

## 18. Domains + Consultancy services, and the new client design

### 18.1 Setup
1. SQL Editor → New Query → paste in `schema_services.sql` → Run
2. **To store registrar passwords**, generate an encryption key once:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   and add it to `.env` (and your Render environment) as `CREDENTIALS_KEY=...`.
   **Keep a copy somewhere safe** (e.g. your password manager). If the key
   is lost, stored passwords can't be recovered. Without a key, the app
   refuses to store passwords at all, and you can use the vault-reference
   field instead.

### 18.2 Homepage + client pages
- The homepage, client portal and tracking page now use the same design
  as admin: paper white, racing green, typewriter headings
- The homepage offers four services as cards: IT Support, IT Project,
  Domains, Consultancy. The form adapts to the one chosen.

### 18.3 Domains
- **Client:** chooses "Register new" or "Manage existing", and enters one
  or more domains (links, `www.` and capitals are cleaned up
  automatically). They get a "facilitation in progress" email; you get an
  **URGENT** alert.
- **You** (Admin → Domains): set the price per domain (with years), mark
  any as unavailable, add a service fee and VAT, and an optional note.
  **Send quote.** Totals are always recalculated on the server.
- **Client:** sees the quote in their portal and clicks **Yes, proceed**
  (or declines). You get an email to go and register.
- **You:** click **+ domain** on the accepted request to add each one to
  the **registry** (pre-filled), then **Mark request complete**
- **Registry:** grouped by client, filterable and searchable. Each entry
  holds registrar, login link, username, password (**encrypted**,
  AES-256-GCM; shown only when you click **Login**, hidden again after 30
  seconds) or a vault reference, renewal date and price, and reminders.
- **Renewals:** you're emailed N days before (default 7), and optionally
  the client too. Each renewal date is reminded once, from 08:00 your
  time. **Renewed** moves the date on a year.

### 18.4 Consultancy
- **Client:** describes their challenge and gets an "expect a response
  soon" email
- **Claude** drafts a reply (and a title) and emails it to you. Nothing
  reaches the client until you send it.
- **You** (Admin → Consultancy): edit the draft (or **Redraft with AI**),
  then **Send as advice** or **Invite to a discovery meeting**
- **Meeting:** the client chooses Teams or Zoom (and adds colleagues) or a
  phone discovery call, picks their timezone, and suggests weekday
  windows (weekends and past dates are blocked)
- **You:** pick one of their windows, set the start time and length,
  paste the Teams/Zoom link, and confirm. Everyone gets an email with a
  calendar invite (.ics) attached.

### 18.5 Later (as discussed)
- AI-assisted domain search: check availability and list the three
  cheapest prices (or three good alternatives) about 10 minutes after a
  request comes in
- Domain and consultancy income in Earnings

## 19. Domain completion email + domain fees in Earnings

- **Mark request complete** (Admin → Domains) now emails the client that
  their domain(s) are registered (or under management), with each renewal
  date from the registry, and lets them know you're available whenever
  they need DNS records added or changed (website, Microsoft 365 email,
  verification records)
- **Earnings** now includes domains, with their own **Domains** filter and
  chart colour. Only your **service fee** counts: the domain cost passes
  through to the registrar, so it isn't income. Quoted → accepted
  (committed) → completed (earned), using the VAT rate the client was
  actually quoted.
- Consultancy is explicitly kept out of earnings until it has pricing
- Registry rows no longer overlap with long usernames, and switch to a
  compact layout on smaller screens

## 20. Ready-to-send renewal emails

### 20.1 Setup
- SQL Editor → New Query → paste in `schema_renewals.sql` → Run

### 20.2 How it works
- Each managed domain now has **Renewal pricing**: the domain price per
  year, a **renewal period** (1/2/3/5/10 years), your **service fee**, and
  **Charge VAT**, with a live total as you type
- When your renewal reminder fires, the app writes and **saves** a renewal
  email for the client (domain, date, period, cost breakdown, total). Your
  reminder digest says "email ready to send".
- In the registry, that domain shows **EMAIL READY** and a highlighted
  **Renewal email** button. Open it to review or edit, **Save draft**, or
  **Send to client**. It then shows **EMAIL SENT**.
- You can open the renewal email at any time, even before the reminder.
  **Rebuild from pricing** regenerates it if you change the pricing.
- No double emails: once you've sent the renewal email for a renewal date,
  the automatic "renews soon" reminder to the client is skipped for that
  date
- **Renewed** moves the date on by a year, and the next renewal starts with
  a fresh email

## 21. Dependency upgrades (security)

- **multer 2.x** (file uploads). Multer 1.x had known vulnerabilities, and
  it handles clients' uploaded signed documents.
- **pdfkit 0.20** (PDFs). This drops the unmaintained `crypto-js` and
  `jpeg-exif`. All four PDFs were checked before and after: identical
  text and layout.
- **Express 4.22**, which pulls in the patched `body-parser` and `qs`
- A fresh `npm install` now reports **0 vulnerabilities**, so you no longer
  need `npm audit fix` after each update
- Upload errors now return a clear message (e.g. "That file is too large.
  The maximum is 10 MB"), and unexpected errors never expose internal
  details to visitors
- Express 5 and dotenv 17+ were deliberately not adopted yet: they're
  major versions with breaking changes and aren't needed for these fixes

## 22. Contacts directory, ball-in-court tracking, screenshots, priority

### 22.1 Setup
- SQL Editor → New Query → paste in `schema_intake_extras.sql` → Run

### 22.2 Contacts (Admin → Contacts)
- Every company you've worked with, newest activity first. Each shows its
  people (name, role, email and phone, which you can click to email or
  call), its requests with their current status and who it's waiting on,
  and how many domains you manage for it.
- People are merged by email address, and companies by name (capitals and
  spaces ignored)
- **Download PDF · all**, or **PDF** per company: a house-style directory
  marked confidential
- Search across companies, people, emails, phones and references

### 22.3 "Ball's in whose court" (tracking page)
- A little court shows whose move it is: **YOU** (the client needs to act),
  **US** (we're on it), a booked meeting ("Rally time"), or finished ("Game,
  set, match ✓"), with a short line explaining what's next
- Every status's label, owner and line live in one shared file,
  `public/status-info.js`, used by the tracking page, Contacts and the PDF

### 22.4 Screenshots (support + projects)
- Clients can attach up to 4 screenshots (PNG, JPG, GIF or WebP, max 5 MB
  each), with previews and drag-and-drop. Files are checked by their real
  contents, so a renamed program can't pass as an image.
- Screenshots go to Claude with the request, so the draft requirements can
  use error messages visible on screen
- They show as thumbnails on admin cards and as links in your review email
- **Note:** they're stored in the same bucket as contracts, which is still
  public. The security pass (before go-live) makes uploads private.

### 22.5 Priority (support)
- "Add priority level" asks **Can you still work at all?** Yes gives a 1–3
  slider; No gives 2–5. The labels run from "Whenever you get a chance ☕"
  to "Everything's on fire 🔥". The server enforces the same limits.
- Priority shows on admin cards, P4/P5 put "[P5]" in your email subject,
  pending reviews sort most urgent first, and Claude sees it when drafting

## 23. Secure admin sign-in, online sign-off, and the workspace

### 23.1 Setup (do this before you restart)
1. **SQL Editor → New Query → paste in `schema_secure.sql` → Run.** If you
   skip this, the sign-in page will tell you to run it.
2. Generate an app secret once and add it to `.env` (and Render):
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   ```
   APP_SECRET=<the long string>
   ADMIN_NAME=Gil Magezah
   ```
   Without `APP_SECRET` the app still runs, but everyone is signed out
   whenever it restarts.
3. Your **first sign-in** uses your existing `ADMIN_EMAIL` and
   `ADMIN_PASSWORD`. That creates your owner account, stored hashed from
   then on. Then go to **Workspace → Team → Change your password** to set a
   new one. `ADMIN_USERNAME` is no longer used.

### 23.2 Admin sign-in
- Email + password, then a **6-letter code** emailed to you (one box per
  letter, 10 minutes, single use, 5 tries)
- Sessions use a secure cookie and end after **30 minutes idle** or 12
  hours. After 20 idle minutes a "Still there?" prompt appears; if nobody
  answers, you're signed out 2 minutes later.
- Wrong emails and wrong passwords get the same answer. Guessing is
  rate-limited (5 tries per 15 minutes per email).
- **Local development only:** sign-in codes are also printed in your
  terminal, so you can't be locked out while testing. This never happens on
  the live https site.
- **Team** (Workspace page): the owner adds colleagues (they get their own
  password + code) and can deactivate them, which signs them out everywhere
  immediately

### 23.3 Online sign-off (`/signoff`)
- Sign-off emails now include **Sign online securely** (the paper option
  is still there). The link pre-fills the reference but still requires
  verification.
- The client enters their reference, email, name and phone. If they match
  a request awaiting sign-off, an **8-character code** is emailed (2
  letters from their company name, shuffled; 10 minutes; single use). The
  reply is identical either way, so nobody can probe for valid tickets.
- The code opens a **30-minute session** with a visible countdown and a
  5-minute warning
- They review the work (time log and costs, or the delivered phases), tick
  the three statements, optionally add a PO number and upload a purchase
  order or proof of payment, and sign by **typing, drawing, or uploading**
  a signature
- Result: the ticket completes (or the project closes), and both of you get
  the **signed PDF**: the original document plus an **electronic signature
  certificate** (who, how, when, IP, device, identity check, PO, and a
  SHA-256 fingerprint of the exact document signed)

### 23.4 Workspace (Admin → Workspace)
- Enter a ticket number to open its workspace **in a new tab**: a focus
  layout with an **environment banner** ("Tenant: …") so you never change
  the wrong tenant
- **Notes canvas** (autosaves, with Focus mode) plus templates: Login & MFA
  (who holds the MFA, recovery route, break-glass), Access & expiry,
  Email drafts (6 presets), Contacts, Checklists (6 presets, or import the
  project's delivery phases), Change log, Scope requests, Waiting on,
  Network/device, Licences, Meeting notes, and **Documents** (with a
  description)
- Passwords, backup codes, Wi-Fi and licence keys are **encrypted**
  (`CREDENTIALS_KEY`) and only shown on Reveal, which re-hides after 30
  seconds
- **Share** with a colleague: everything, or chosen sections only
- **Timer** from the moment you open it, with quips as you go; time is
  logged per admin

### 23.5 Also hardened
- A strict **Content Security Policy** and other security headers on every
  page
- Requests from other websites are blocked
- Admin page files can't be loaded directly
- The server's software isn't advertised

## 24. Private files, lockdown, billing, legal pages, and polish

### 24.1 Setup, in this order
1. SQL Editor: run **`schema_billing.sql`**, then **`schema_rls.sql` last**. The RLS file turns on
   row-level security for every table and makes the storage bucket private. The final query lists
   every table: all should show `rls_enabled = true`.
2. `.env` (and Render later):
   - `INVOICE_PAYMENT_DETAILS`: your bank and EcoCash details, printed on every invoice
   - `GA_MEASUREMENT_ID` (optional): your GA4 ID, `G-…`
3. Restart, then **Billing → Your signature**: draw or upload it once, with your name and title.
4. `npm test` runs every security and feature suite.

### 24.2 Free professional email (instead of Microsoft 365)
- **Receive:** Porkbun → your domain → Email Forwarding → forward `services@autowerkeit.com` to
  your Gmail. Free, with up to 20 addresses per domain.
- **Reply as services@:** Gmail → Settings → Accounts → "Send mail as" → add
  `services@autowerkeit.com` using Resend's SMTP server (`smtp.resend.com`, username `resend`,
  password = a Resend API key). Check Resend's SMTP docs for the current port settings.
- The app already sends through Resend, so nothing changes there.

### 24.3 What's new
- **Private files:** the bucket is private. Every file is served via `/files/…` (admins, or the
  client for their own request only) as a 60-second signed link. Links are rewritten automatically
  in API responses and emails, so no data migration is needed.
- **Portal links** expire 30 days after a request is finished. Public endpoints are rate-limited.
- **Billing** (Admin → Billing):
  - Invoices (`AW-INV-YYYY-0001`) are pre-filled from the request, emailed as PDFs, and
    automatically create a payment follow-up.
  - Recording a payment generates a receipt (`AW-RCT-YYYY-0001`), or you can upload one from your
    workplace's system. Part payments are tracked, and full payment stops the reminders.
  - A document trail for each request, from request to receipt (also in the workspace side panel).
  - Your signature is pre-applied to invoices, receipts, contracts, estimates and both sign-offs.
- **Gantt chart** in progress emails, built from each phase's planned dates.
- **Consultancy:** "often free" on the homepage. Set a fee when responding (0 = free), and paid
  consultations count in Earnings.
- **Phone numbers** have a country-code picker (Zimbabwe first). Pasting `+27…` switches it
  automatically.
- **Legal:** `/privacy`, `/cookies`, `/terms` and `/service-terms`, a consent banner (Google
  Analytics only after "Accept"), and a required terms checkbox on the intake form, recorded with
  its version.
- **Quirky 404**, compression and caching, and mobile layouts checked at 375px.

### 24.4 Compliance actions for you (not legal advice)
- Have the legal pages reviewed by a Zimbabwean lawyer before relying on them.
- Zimbabwe: apply for a **data controller licence** with POTRAZ, and appoint a **Data Protection
  Officer** (SI 155 of 2024).
- South Africa (if you serve SA clients): register an **Information Officer** with the Information
  Regulator.

## 25. Separate admin site (admin.autowerkeit.com) and security hardening

### 25.1 The admin site on its own address
The back office can run on its own host, the way Microsoft keeps `admin.microsoft.com` apart from
its public sites. It's the same app and the same Render service, just answering differently
depending on which address was used:

| | `portal.autowerkeit.com` (BASE_URL) | `admin.autowerkeit.com` (ADMIN_URL) |
|---|---|---|
| Intake form, client portal, tracking, sign-off | ✓ | redirected to the portal |
| Admin pages (`/admin/...`) | redirected to the admin site | ✓ (`/` opens the dashboard) |
| Admin + sign-in APIs | **404** (they don't exist here) | ✓ |
| Google Analytics allowed by the CSP | ✓ (after consent) | never |
| Search engines | indexed | `X-Robots-Tag: noindex` |

Why it's safer: the admin sign-in cookie is host-only, and on https it's named `__Host-aw_admin`,
which browsers refuse to share with any other host. So it's never sent to the public site, and
nothing on the public site can reach the admin APIs. Links in admin emails still work: they point
at the portal and hop over to the admin site.

**To switch it on (when you deploy):**
1. Render → your service → Settings → Custom Domains → add `admin.autowerkeit.com`.
2. Porkbun DNS: add the CNAME record Render shows you (same as you did for `portal`).
3. Render → Environment: `ADMIN_URL=https://admin.autowerkeit.com`. Restart.
4. Sign in at `https://admin.autowerkeit.com`. (You'll be signed out once: the cookie got its new name.)

Without `ADMIN_URL` everything works on one address, as before. To try the split on your PC, set
`ADMIN_URL=http://admin.localhost:3000` and open that address (browsers map `*.localhost` to your PC).

**After deploying, check the real-IP setting once:** sign in, then look at the newest row in
`admin_sessions` in Supabase. Its `ip` should be your real public IP. If it's a Render-internal
address, there's an extra proxy hop: change `app.set('trust proxy', 1)` to `2` in `server.js`.

### 25.2 What else changed
- Admin pages moved from `public/` to `views/`, so no URL trick (like `/admin%2Ehtml`) can load them.
- Rate limits use the address Render saw, not the client-written part of `X-Forwarded-For`.
- Portal uploads (signed contract, estimate, sign-off) must really be PDF, PNG or JPG: checked by content.
- Portal actions only work from their own stage (a signed project can't be "declined" by link).
- Workspace documents are stored in `ws_<REF>/`. Client portal links never open them, and colleagues
  need the workspace's Documents section shared with them.
- Sign-off: the submit route checks your session before reading any upload, and is rate-limited.
  Identify limits are per reference **and** address (no locking a client out); codes sent are
  capped at 5 per hour per request. Signature images over 3000 px a side are refused.
- Signature PNGs (client sign-off and your own) have their structure checked before pdfkit opens
  them: its PNG reader trusts chunk lengths, and a crafted 20-byte file could loop it forever and
  freeze the whole server (`pngChunksOk` in `lib/attachments.js`, hardening test 11b).
- Revealing a registry password is now logged (who and which domain, never the value).
- The owner account won't be created from a weak `ADMIN_PASSWORD` (12+ characters, mixed case, a number).
- Intake: unknown request types refused, email checked, text capped; odd AI replies can't break it.
- Tracking lookups are capped per reference (15 an hour); references use a secure random number.
- Public routes never show database or storage error details. Cron key: header only (see 17.5).
- `.env.example` holds placeholders only. **Never put real keys in it**: it's committed to git.

### 25.3 The bare domain goes to the portal
`autowerkeit.com` and `www.autowerkeit.com` forward to the portal, keeping the path and query
(`autowerkeit.com/track?ref=X` → `portal.autowerkeit.com/track?ref=X`). Page loads get a permanent
301; anything else (a form post) gets a 308, which keeps the method. The admin site and the portal
itself are never redirected, and localhost never is, so nothing changes on your PC.

The two hosts are worked out from `BASE_URL` (drop the first label, add `www.`), so there's
nothing to set. `REDIRECT_HOSTS=a.com,b.com` overrides the list; `REDIRECT_HOSTS=none` switches it off.

**To switch it on (when you deploy):**
1. Render → Custom Domains → add `autowerkeit.com` and `www.autowerkeit.com` (Render issues the certificates).
2. Porkbun DNS: add the records Render shows (an ALIAS/A record for the root, a CNAME for `www`).
   Leave the mail records (MX, SPF, DKIM for `mail.autowerkeit.com`) exactly as they are.
3. Point the cron ping at `https://portal.autowerkeit.com/api/cron/reminders` directly: some cron
   services don't follow redirects.

(Porkbun's own URL forwarding could do the same without code; this way it's one app and one
certificate setup, and the path is always kept.)

## 27. Homepage dark mode
A sun/moon button at the top right of the homepage switches it to dark: a deep green-black page,
the paper colour as text, racing green for the header band, the private-portal card and the closing
call to action, and a lighter sage for links and icons (racing green is too dark to read on black).
Bright green still marks selected states only.
- The page is light unless the visitor picks dark; the choice is remembered on that device
  (`localStorage`, key `aw-theme`). `?theme=dark` or `?theme=light` previews a theme without saving it.
- `public/theme-mode.js` runs in `<head>` so a saved choice never flashes light first; it also swaps
  the SVG logos for their dark versions. The colours live in `public/home-dark.css`.
- Only the homepage has it so far. To follow the device's own dark setting, default `theme` to
  `matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'` in `theme-mode.js`.

## 26. Rebuild PDF, payment details on separate lines, Windows-friendly tests
- **Rebuild PDF** (Billing, on every invoice and every generated receipt): regenerates the PDF with
  the current layout and your signature (same number and amounts), replaces the copy the PDF button
  opens, and can re-email it. Use it for invoices issued before a layout fix or before you set your
  signature. The originally emailed copy is kept in storage.
- **Payment details** on invoices print one per line: "Bank: … · Account name: … · Account: …"
  becomes three lines.
- **Action buttons** are arranged in content-sized pairs, so no label gets cut off.
- **`npm test` works on Windows:** the sign-off test no longer needs the Linux-only `pdftotext`.

## 28. Admin accessories (calculator, Quick find, Notes, Support timer)
Small retro tools that float over every admin page. **Accessories**, the long green button under
the session time (in the menu row on phones), opens the list; click one to open or close it.
Each window is dragged by its top strip (or focus the strip and use the arrow keys), and has a
**pin** and a **close** button. Pin up to **4** favourites to the **dock**: a strip of shortcuts
you can drag anywhere in the top quarter of the screen.

- **Calculator:** four operators, desk-style `%` (`200 + 10%` = 220), ±, ⌫, **+VAT / EX VAT** at
  the server's `VAT_RATE` (rounded to cents like invoices), history of the last 50 answers. Click
  the screen to copy the plain number. Click a key once and you can type (Enter, Backspace, Esc).
- **Quick find** (`Ctrl+K` anywhere): type a reference, company, name, email or phone number. Enter
  opens the page that lists it and flashes the card (`#find=REF`); there are also Workspace,
  Copy email and Copy phone buttons. The list comes from `GET /api/admin/find-index` (admin
  only, `no-store`, slimmed: no tokens or billing) and is matched in the browser, never with a
  pattern in a database query.
- **Notes:** a lined notepad with up to 9 pages, a **Stamp** key (date and time in
  `REMINDER_TIMEZONE`), Copy, and a two-step Clear. Saved as you type (section 29: now synced to your account, encrypted).
  Not for passwords or client secrets: those go in the workspace, where they're encrypted.
- **Support timer:** Start / Pause / Reset; it keeps running across pages, tabs and reloads. Choose
  an in-progress support ticket and **Log time**: it writes the same work-log entry as "Log hours"
  (ending now, starting the timed minutes earlier, in Harare time), so billing picks it up. Under
  a minute, over 16 hours, or across midnight is refused with a clear message.
- `log-hours` now also checks its input: a real `YYYY-MM-DD` date, 24-hour `HH:MM` times, an end
  after the start (billing counted those as 0 minutes anyway), and notes capped at 500 characters.

Positions, pins, open windows, notes, the timer and calculator history live in the browser
(`localStorage`, keys `aw.acc.*`, `aw.calc.*`, `aw.notes`, `aw.timer`). They are per browser (Notes
now sync to your account instead: section 29). Code: `public/accessories.js` (frame, menu, dock, Ctrl+K, `#find=`),
one file per accessory, and `public/acc-core.js` + `public/calc-core.js` for the logic, which also
run in Node so `tests/accessories.test.js` and `tests/calculator.test.js` test exactly what runs.
To add an accessory: a new file that calls `Accessories.register({...})`, listed in `PARTS` in
`accessories.js`.


## 29. More accessories: passwords, world clock, currency, dates & reminders

Four more tools in the Accessories menu, in the same retro style.

**Run `schema_accessories.sql` in Supabase** (after `schema_secure.sql`, before re-running
`schema_rls.sql`). It adds two private tables, `admin_reminders` and `admin_notes`, with RLS on
and no policies. Until then, the admin banner names the file, reminders say "Run
schema_accessories.sql…", Notes keeps working in the browser only, and the reminder cron carries
on with payments and domains as before.

- **Password generator:** passwords (12–40 characters; A–Z, a–z, 0–9, symbols; look-alikes such as
  `I l 1 O 0` left out) or passphrases (3–8 words from a 517-word list, a separator, capitals and
  a number). Uses the browser's cryptographic random generator, with no modulo bias, and makes
  sure every set you tick appears at least once. Shows the strength in bits. Click the screen or
  **Copy** to copy it. Passwords are **never stored or sent**: only your settings are remembered,
  and the password is cleared when the window closes.
- **World clock:** Harare (`REMINDER_TIMEZONE`) plus up to 8 cities. Each has an office-hours light:
  green 08:00–17:00 Mon–Fri, amber an hour either side, grey when closed. **Slide the planner**
  to see what, say, 14:00 in Harare is everywhere else. Daylight saving comes from the browser's
  timezone data.
- **Currency converter** (rates now automatic, see section 30): USD, ZiG, rand, pula, kwacha, metical, pound, euro, dirham, ringgit,
  Singapore dollar, Egyptian pound and Mauritian rupee. **Rates are typed in by an admin** (per
  1 USD) and shared by the whole team (`app_settings.fx_rates`, `GET/PUT /api/admin/fx-rates`),
  with who set them and when. They're flagged after 7 days. No free live feed is reliable for ZiG,
  so a person sets them on purpose. Amounts are read as text first (DEVELOPMENT.md #7). Everything
  converts through USD, and a missing rate gives no answer rather than a wrong one.
- **Dates & reminders:**
  - *Reminders:* "Remind me to…" plus a date and time in Harare time. Quick picks: +1 hour,
    tomorrow 9:00, next working day, Monday 9:00. Optional reference and **Email me** (on by
    default). They belong to your account, so they work on any device, and only you can see or
    change them.
  - *When one is due:* an alert pops up at the bottom of whatever admin page is open (Done,
    +1 hour, Tomorrow, Find), and the Accessories button's light blinks amber. It's also emailed
    to you **once** by the reminder cron (`/api/cron/reminders`, or the minute check while the
    server is awake). The page checks every minute with an `X-Background: 1` header, so an open
    tab **doesn't keep an idle session alive**.
  - *Suggested for you:* built from what's going on:
    - clients who've had the ball for 3+ days (price, estimate, contract, scope or sign-off);
    - support tickets in progress with no time logged for 5+ days;
    - discovery-meeting prep an hour before;
    - invoices due within 3 days or overdue;
    - domains renewing within 30 days.

    **Remind me** takes one up. Each has a stable key, so it isn't offered again (and a duplicate
    gets a 409). × hides a suggestion in this browser.
  - *Date maths:* add or take away working days (weekends and Zimbabwe public holidays skipped),
    days, weeks or months; count days and working days between two dates; see the next public
    holidays. Holidays are calculated (Easter, Heroes' Day as the second Monday of August, Defence
    Forces Day the day after), and a holiday on a Sunday moves to the next free day. **Check
    one-off gazetted days**: they aren't in the list.
- **Notes now sync to your account.** They're encrypted with `CREDENTIALS_KEY` (AES-256-GCM, like
  workspace secrets) in `admin_notes`, so they follow you to any device.
  - Typing is saved in the browser at once and synced about 1.5 seconds after you stop.
  - If another device saved in between, the server answers 409 with its copy. The two are merged
    (pages the server doesn't have are added, nothing is dropped) and saved again.
  - Sign-out saves anything pending, then removes the browser copy once it's in the account.
  - A different admin signing in on the same browser doesn't see your copy.
  - Without `CREDENTIALS_KEY` or the table, Notes stays browser-only and says so.

Security notes:
- Every route is admin-only and admin-site-only.
- Reminder queries always include the admin's id, so another admin's PATCH or DELETE finds
  nothing (404). Junk ids are a plain 404.
- Snooze is limited to 15 min, 1 h, 3 h or 1 day.
- Reminder text is escaped in the page and the email.
- Notes are never stored as plain text. Rates accept only known currency codes and numbers.

Code:
- Server: `lib/accessoriesRoutes.js` (API) and `lib/reminders.js` (input checks and suggestions).
- Browser: `public/passgen.js`, `worldclock.js`, `fx.js`, `dates.js`.
- Shared logic in `public/acc-core.js` (dates and holidays, passwords, currency, clocks, notes
  merge), which runs in both the browser and Node.
- Tests: `tests/accessories.test.js` (that logic) and `tests/reminders.test.js` (the API end to
  end, including two admins trying each other's data, the emailed-once cron, and the background
  check leaving the session's idle clock alone).

## 30. Automatic currency rates, and saved notes

**Run `schema_accessories.sql` again** (it's safe to re-run). It adds `admin_saved_notes`, and
`schema_rls.sql` now includes it in the lockdown.

**Currency rates now update themselves every 12 hours** (`lib/fxRates.js`):
- **European Central Bank** daily reference rates (official, published around 16:00 CET on
  working days) for EUR, GBP, ZAR, MYR and SGD. The ECB quotes per euro; the server converts to
  per US dollar.
- **ExchangeRate-API**'s open feed (no key needed, attribution linked in the converter) for BWP,
  ZMW, MZN, AED, EGP and MUR. These are market rates, not a central bank's: none of those central
  banks offers a free feed a program can read.
- **ZiG is never automatic.** You set it with **Set ZiG rate**. The feed's ZiG figure is shown
  next to the box as a hint, with a **Use this** link, so you can compare it with the RBZ
  interbank rate you actually quote. A ZiG rate older than 7 days is flagged. Your earlier
  hand-entered ZiG rate carries over.
- Each rate in the converter is tagged **ECB**, **MKT** (market) or **SET** (set by hand). The
  footer says when they last updated and when the next update is due, and has a **Refresh now**
  link (at most every 5 minutes).
- When it fetches: the reminder cron and the once-a-minute check while the server is awake both
  call it, but it only fetches when 12 hours have passed. Opening the converter after that also
  triggers it (waiting at most 6 seconds).
- If a feed is down, the other one fills in where it can, and otherwise the last good rate is
  kept. The error is shown, and it tries again after an hour, not every minute. Rates more than
  36 hours old are flagged.
- Automatic currencies can't be overridden by hand. A currency with no automatic rate at all
  (both feeds down since the start) can be set by hand until a feed returns.
- Tests never reach the network: `tests/fakedb.js` sets `FX_RATES_AUTO=off`, and
  `tests/reminders.test.js` turns it back on with both feeds stubbed.

**Saved notes in the notepad:**
- **Save** (or `Ctrl+S` in the notepad) keeps the page as a saved note. Its title is the first
  line, with a leading Stamp date skipped. Saving the same page again updates that note rather
  than making a copy. The footer shows "saved 14:02" or "edited since saved".
- **Saved (n)** lists them, newest first, with search. Click one to open it on a page: the page
  it's already on, an empty page, or a new page. Delete is a two-step **×** then **Sure?**.
- Saved notes are stored in `admin_saved_notes`, with **title and text both encrypted** with
  `CREDENTIALS_KEY`. They're private to each admin, with up to 200 each.
- API: `GET/POST /api/admin/notes/saved`, `GET/PUT/DELETE /api/admin/notes/saved/:id`.
- Without `CREDENTIALS_KEY` or the table, saved notes are kept in this browser (up to 50) and
  moved into your account automatically once it's available.

## 31. Session clock that survives a refresh, and all-time signed-in time

- The sidebar clock under your name now counts from **when you signed in** (the server's record
  of the session), not from when the page loaded, so refreshing or moving between pages no
  longer resets it.
- **Click the clock** to switch to **all time**: every session you've ever had, added up. Hover
  it to see how many sessions and since when. Click again for this session. The choice is
  remembered in this browser.
- How all time is worked out (`signedInMs` in `lib/auth.js`, `GET /api/auth/time`):
  - Sessions that overlap (two browsers open at once) count once.
  - A session you signed out of ends at the sign-out. One that timed out ends when you last
    used it, so the idle 30 minutes before the time-out isn't counted. Nothing counts past a
    session's 12-hour expiry.
  - It's accurate to about a minute, because "last used" is only saved once a minute.
- No SQL to run: it uses the existing `admin_sessions` table, which keeps old sessions.

## 32. Document cover and contents pages (house style, first step)

The client documents are moving to one layout (`lib/pdfDoc.js`): a **cover** ("homepage"), a
**contents** page, then the content. The project sign-off uses it first; the others follow.
- **Cover:** logo and contact details, a short green rule, the document type in typewriter
  type, the title, "for <client>", **About this document** (what it is and what the reader
  needs to do), a key-facts grid (prepared for and by, reference, date) and a quiet brand line.
  Long titles shrink and start higher, so the cover is always exactly one page.
- **Contents:** numbered sections (green typewriter numbers), a one-line description for each,
  and page numbers that match the PDF viewer (the cover is page 1).
- **Every inner page:** small logo and reference in the header, "Page n of N" in the footer.
- The green is kept to thin accents: no heavy bands except where money is shown (invoice
  style, next step).
- `npm run sample-pdfs` rebuilds the samples; `tests/documents.test.js` checks page counts,
  A4 size and the worst-case cover.

## 33. Project contract redesign

`lib/contract.js` now uses the shared layout (section 32). "Purchase order" is gone: it's the
**Project contract**.
- **Cover:** about this contract, prepared for and by, reference and date (no price: that stays in section 3).
- **Sections:** 01 Scope of work · 02 What we'll deliver · 03 Price · 04 How the project runs ·
  05 Agreement. Sections flow on from each other (no half-empty pages); each heading keeps a few
  lines with it, and the agreement keeps its signatures on the same page.
- **Price, in the invoice's style:** the pricing you type when sending pricing is read line by
  line (`pdfDoc.parsePricing`). `50 devices x $20 = $1000`, `Staff training, 2 x $270 = $540`
  and `Setup: $300` become table rows; `VAT 15.5%` and `Total = $…` become the totals (a
  missing one is worked out from the lines). Any other line (payment terms, notes) is shown
  word for word in a cream box. If nothing reads as a price line, the whole text goes in the
  box as written. The table header repeats if it runs onto a new page.
- **How the project runs** restates the service terms in five plain lines. (A line linking to
  the full terms was taken out for now; proper public links come later.) `LEGAL_VERSION` lives
  in `lib/legal.js` (shared by `server.js`). **Needs review by a Zimbabwean lawyer**, like the
  service terms.
- **Agreement:** two signature columns, client and AutoWerke | IT. Your uploaded signature, name
  and title fill the AutoWerke | IT column automatically.
- The contract value you enter for earnings stays private, as before: the contract shows only
  the pricing text the client already sees.

## 34. Work estimate redesign (IT Support)

`lib/estimate.js` now uses the shared layout too: cover, contents, then **01 The issue**
(the summary, plus users and devices affected and what was already tried), **02 Estimate**,
**03 How billing works** and **04 Approval** (two signature columns).
- **The estimate table follows the invoice:** hours, rate per hour, amount, then subtotal,
  **VAT** and the estimated total. The figures come from `supportBilling()`, the same maths as
  the completion sign-off, so the estimate and the final bill agree on rate and VAT.
- **How billing works** restates the real rules: logged time is billed at the rate, the
  approved estimate is billed if no time was logged, the completion sign-off lists every entry,
  and invoices are due in 14 days.
- The estimate email, approval page and tracking page now show VAT the same way (section 35).

## 35. Project sign-off sections, and VAT everywhere the estimate appears

- **Project sign-off** (`lib/signoff.js`): after the cover and contents, the sections now flow
  in the shared style instead of one section per page: **01 Introduction**, **02 Project
  overview** (Objectives delivered, Outstanding items, Our recommendations) and **03 Acceptance
  sign-off**, which keeps the statement and both signature columns together. A typical sign-off
  is now 3–4 pages instead of 5.
- **VAT on the estimate, everywhere:** the estimate email, the client's approval page and the
  tracking page use `supportBilling()`, the same maths as the PDF and the final bill. They show
  the subtotal, VAT (when it applies) and "Estimated total … incl. VAT". The portal and track
  APIs return an `estimate` object for IT Support tickets only.
- Tests: `tests/batch.test.js` checks 3 h x $45 + 15.5% = $155.93 in the portal and email;
  `tests/documents.test.js` checks the cover still stays one page with a 120-character title.

## 36. Support sign-off redesign (IT Support)

`lib/supportSignoff.js` now uses the shared layout (section 32), replacing the old black and
cream page. The billing maths (`supportBilling()`) is unchanged.
- **Cover:** "Support sign-off", the ticket title, what the document is and how to sign it
  (online with the emailed link, or print, sign and upload), prepared for and by, reference, date.
  No amount on the cover, as with the contract.
- **01 The work:** the ticket summary.
- **02 Time logged:** the day-by-day timeline, now in racing green on cream, with hour marks above
  it (repeated if it runs onto a new page). It shows 08:00-18:00 like the web page, and widens in
  2-hour steps when a session starts earlier or finishes later, so no bar is cut off. Then every
  entry in the invoice's table style (date, time, duration, notes); the header repeats on new pages.
- **03 Amount due:** how it's billed, the approved estimate next to the time logged
  (e.g. "3.92 h (3h 55m)"), then the invoice-style table: hours billed x rate, subtotal, VAT and
  **Total due**. With no time logged it says the approved estimate is billed.
- **04 Acceptance:** the same acceptance statement (naming the total), two signature columns; your
  uploaded signature fills the AutoWerke | IT column.
- The signed-online copy still adds the certificate page after it (untouched; next on the list).
- Tests: `tests/documents.test.js` checks the logged-time bill ($203.74), the estimate fallback
  ($155.93), no VAT, and 32 sessions outside office hours with a long title (cover stays one page).

## 37. E-signature certificate redesign

The certificate page added after an online signature (`certificatePdf` in `lib/esign.js`) is
redesigned, for both project and support sign-offs. What it records is unchanged.
- **Full-width green header:** the brand name in cream type (the logo image is dark, so it can't
  sit on green), "Electronic signature certificate", **Signed online**, a **SIGNED** stamp with
  the date and time, the document type and title, then four key facts: signed by, for (company),
  amount agreed, method.
- **Below:** a one-line summary (name, email, document), the PO and attachments if any, then
  **How it was signed** as a short timeline: identity checked, statements accepted (ticked),
  signed. Times are shown in `REMINDER_TIMEZONE` (Harare time by default), not raw UTC.
- **Signature** in a cream box, then a small **Technical record**: exact UTC time, IP address,
  device, and the SHA-256 fingerprint in groups of 8 so it's easy to compare by eye.
- **Always one page:** every free-text value has a fixed space and is cut with "…" if it's
  longer (the full values stay in the database's e-signature record). `tests/documents.test.js`
  checks the worst case ends above the footer.
- The signed document's own pages still say "Page n of N" without counting the certificate: the
  fingerprint covers those exact pages, so they can't be renumbered after signing. The
  certificate's footer says "Added on signing" instead.

## 38. Text files on the intake form (error messages, logs, code)

Support and project requests can now attach a plain text file alongside screenshots (still up to
4 files in total). Useful for an error message, a log or a snippet of code.
- **Form:** the drop zone reads "Add screenshots or a text file". It accepts `.txt` and `.log`
  (1 MB max) as well as images (5 MB). A text file shows as a tile with its first lines in
  typewriter type and a green **TXT** badge.
- **Checked by content, like images:** a text file has no magic number, so every byte decides it
  (`readPlainText` in `lib/attachments.js`). It must decode as UTF-8, or as UTF-16 with a
  byte-order mark (what Windows PowerShell's `>` writes), with no control characters except tab,
  line breaks, form feed and escape (terminal colours). A renamed `.exe`, a zip, a PDF or random
  bytes are refused. Old "ANSI" files with accented letters are refused too (rare for logs).
- **Stored safely:** every accepted text file is re-encoded as UTF-8, renamed `.txt` and stored
  as `text/plain; charset=utf-8` in the private bucket, so it can only ever display as text.
- **AI draft:** the text is passed to Claude as text (20,000 characters at most across all
  files), labelled as the client's material to read for facts, not as instructions.
- **Admin:** cards show a TXT tile next to the screenshot thumbnails; the review email lists
  "Attachments (n)", with text files marked "(text)".
- **Privacy policy:** now mentions text files where it mentions screenshots (a small
  clarification, so `LEGAL_VERSION` is unchanged; still needs the lawyer review).
- Tests: `tests/attachments.test.js` (new suite in `npm test`).

## 39. "Request received" email for IT Support and IT Project

Clients used to hear nothing after submitting a support or project request until you'd reviewed
it (Domains and Consultancy already sent a "received" email). Now `sendRequestReceivedEmail` in
`lib/email.js` goes out straight after the request is saved:
- Subject: "Support request received — REF" or "Project request received — REF".
- Their reference (in typewriter type), a copy of what they wrote (first 600 characters), the
  priority they chose (support), the names of any files attached, and what happens next:
  estimate then work for support; scope, then pricing and contract for projects. Urgent tickets
  (P4/P5) are told they're at the front of the queue. Plus the tracking link.
- It opens with a large "Thank you for choosing us." and "we appreciate the opportunity to help"
  (see section 41), which is also the inbox preview line.
- No AI draft and no file contents: you still review before the client sees any scope.
- If this email fails to send, the request still succeeds (it's already saved) and the error is
  logged, so the client never resubmits and creates a duplicate.
- Tests: `tests/attachments.test.js` check 6.

## 40. See every email: `npm run sample-emails`

Builds one of every email the portal sends (43: 24 to clients, 19 to you) with made-up sample
data, the same companies as `npm run sample-pdfs`. Nothing touches the database.
- **Look at them:** open `sample-emails/index.html` in your browser (folder is gitignored). Each
  email sits in a frame with its subject, from, reply-to, recipients and attachments (the PDFs
  and calendar invite are saved in `sample-emails/attachments/` so you can open them).
- **Get them in your inbox:** `npm run sample-emails -- --send you@example.com` sends every sample
  through your real Resend account, only to that address, with "[Sample]" in front of each
  subject. Add `--only client` or `--only admin` to send one group, or `--pick invoice,receipt`
  to send just those (names as in the gallery, without the number). About 2 a second (Resend's
  limit), so the full set takes about 30 seconds, and it counts towards your Resend quota.
- **Logos:** if `BASE_URL` is localhost, real emails leave the logo out (an inbox can't reach your
  PC). The samples always render as they will once live: the logo files are copied into the
  gallery, and embedded in the sent samples as inline images, so they show before the site is up.
- Links in the samples point at the live address and won't open anything for these made-up
  references.
- **Before and after:** before changing emails, run `npm run sample-emails -- --baseline` to save
  the current versions in `sample-emails/baseline/`. Every later run adds a **Changed** tab to the
  gallery showing each changed email before and after, side by side. An optional
  `sample-emails/baseline/notes.json` (`{"_summary": "...", "invoice": "what changed"}`) adds notes
  to that tab. Dates are fixed for the day, so only real changes show up.
- Tests: `tests/attachments.test.js` check 7 runs the script and checks nothing is sent without `--send`.

## 41. Email house style

All emails share one look, set in `emailLayout` (`lib/brand.js`) and a few building blocks in
`lib/email.js`, in the same quiet style as the PDFs (reviewed and adjusted with Gil in two rounds):
- **Every email:** under the logo, a hairline with a short green bar at the start (as on the
  PDFs); typewriter headings; bold green uppercase section labels (`<h3>`) that sit right on top of
  their paragraph; green links. Plain `<h2>`, `<h3>`, `<p>`, `<ul>` and `<a>` tags pick this up
  automatically (`houseStyle`); tags with their own `style` are left alone. Email apps ignore most
  CSS, so the look is inline.
- **Backgrounds:** no page background by default, so emails sit on the reader's own background
  (dark mode included). `sendEmail({ paper: true })` puts the card on cream; only the four
  "thank you" received emails use it.
- **Dark mode:** a small `<style>` block (`EMAIL_DARK_CSS`) gives light text, dark boxes, a lighter
  green and the cream logo (`autowerke-it-logo-dark.png`) when the reader uses dark mode. Apple
  Mail, iOS Mail and Outlook for Mac use it; Gmail ignores it and darkens emails its own way;
  light mode is unchanged. Boxes that should turn dark carry `class="aw-cream"`; buttons carry
  `aw-btn` / `aw-btn-cream` so their text keeps its colour.
- **Logo in Gmail dark mode:** Gmail (and Outlook) ignore that `<style>` block, so the dark logo on
  a transparent background disappeared on their dark background. Emails now use
  `autowerke-it-logo-email-plate.png`: the logo on a white rounded plate, baked into the image
  (email apps never recolour images). On a white email the plate can't be seen; in Gmail dark mode
  it shows as a small white badge. Apple Mail still swaps in the cream logo. If the logo changes,
  rebuild it with `node scripts/make-email-logo.js`.
- **Automatic dark-mode tags:** `emailLayout` tags any box with the cream background
  (`#F4F1E8`) as `aw-cream`, and any text in the warning red (`#A33A2E`, e.g. "3 days overdue",
  "Expired 2 days ago") as `aw-warn`, so a new email can't forget. In dark mode `aw-warn` becomes a
  lighter red (`#F28B82`) that stays readable; in light mode warnings stay the same red.
- **Building blocks:** `head(title, label)` (bold typewriter label · reference, heading, short
  green rule; `rule: false` for plainer emails like the IT Project conversion); `button(url,
  label)` (green; `onGreen` gives the cream button); `greenPanel(label, text, button)` (rounded
  green panel: sign online, discovery meeting); `figurePanel()` (green panel for one key figure:
  amount due, amount received, who signed, meeting date); `panel()` (plain cream box, no edge);
  `priceTable()` (label left, bold typewriter figures right, green rule over the total);
  `itemTable(text)` (the contract's price table for the project estimate email, read with the
  same `parsePricing` as the contract PDF so they always match).
- **Received emails** (support, project, domain, consultancy) open with a large green
  "Thank you for choosing us." Invoices end "Thank you for your business."
- **Preheader:** `sendEmail({ preheader })` sets the hidden line inboxes show next to the subject.
  Client emails have one; admin emails don't need it.
- Known limit: the email signature (logo beside the contact details) needs about 345px, so on a
  375px phone the email is a little wider than the screen and phone email apps scale it down
  slightly. This was already the case before these changes.
- Tests: `tests/attachments.test.js` check 6 (thank-you first, preheader, house style leaves styled
  tags alone, dark mode styles and auto-tags, cream page only on thank-you emails, itemised estimate and its
  fallback, no green edge bars); `tests/batch.test.js` (estimate table).

## 42. Pipeline category tiles

The Pipeline page used to stack six long sections, so finding the newest request meant scrolling.
Now six large tiles sit right under the green band, above Overview and By company:
- **Each tile** shows the category, a big count, a status pill and the newest item ("Kariba Logistics · 2 h ago").
  Status pills: **"2 new"** (arrived since you last opened that category), **Needs you** (waiting on
  you, nothing new), **Ongoing** (in progress), **Waiting on client** (sign-off sent), **All clear**
  (the count fades to grey so busy tiles stand out).
- **Click a tile** to open just that list below the tiles, with the same cards as before; cards that
  were new get a small "New" tag. Click the tile again or **Close** to fold it away. The open tile is
  kept in the address (`/admin#pricing`), so a reload keeps it.
- **"New"** is remembered per browser (`localStorage`), so another computer shows recent items
  (last 2 days) as new once. A category's "new" clears when you open it. When an item "arrived"
  depends on the stage: submitted (reviews), updated (changes, pricing, estimate), estimate signed
  (in progress), sign-off sent (sign-off). Logging hours doesn't make a ticket "new".
- The company filter (By company table) also filters the tile counts.
- **Inside the cards:** labels, fields and buttons share one height (40px) and spacing; the
  time-entry row (date, start, end, note, Add entry) wraps neatly on narrow screens; hours and rate
  sit side by side; the convert-to-project panel uses the theme's amber.
- The rules live in `public/pipeline-summary.js`, which runs in the browser and in the tests.
  `views/admin.html` links its CSS/JS with `?v=` so a browser can't mix an old cached script with
  the new page (static files are cached for 10 minutes); bump it when changing those files.
- Tests: `tests/pipeline.test.js` (counts, new vs seen, states, times, every tile has its panel,
  company names escaped, no inline scripts).
