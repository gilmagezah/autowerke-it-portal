// Public site: browser settings, legal pages, the intake form for all four services,
// tracking by reference + email, and the classic homepage.
// Mounted by server.js after the security middleware, rate limits and portal-expiry check.
const express = require('express');
const path = require('path');
const { draftRequirements, draftConsultResponse } = require('./ai');
const domainsLib = require('./domains');
const { cleanWebsite } = require('./website');
const { sendReviewEmail, sendRequestReceivedEmail, sendDomainReceivedEmail, sendDomainAdminAlert, sendConsultReceivedEmail, sendConsultAdminDraft, sendPortalLinkEmail } = require('./email');
const { trackView } = require('./track');
const db = require('./db');
const sec = require('./security');
const { uploadSignedContract } = require('./storage');
const { supportBilling } = require('./supportSignoff');
const { brandName, contactInfo } = require('./brand');
const { validateScreenshots, toClaudeImages, toClaudeText, isText } = require('./attachments');
const { sanitizePriority, PRIORITY_LABELS } = require('./priority');
const { LEGAL_VERSION } = require('./legal');
const { BASE_URL, ROOT, upload, screenshotUpload, REQUEST_TYPES } = require('./routeHelpers');

const router = express.Router();

// Public, non-secret site settings for the browser
router.get('/api/site-config', (req, res) => {
  const ga = String(process.env.GA_MEASUREMENT_ID || '').trim();
  res.json({ gaMeasurementId: /^G-[A-Z0-9]{4,20}$/.test(ga) ? ga : null });
});

// Friendly URLs for the legal pages
['privacy', 'cookies', 'terms', 'service-terms'].forEach((name) => {
  router.get(`/${name}`, (req, res) => res.sendFile(path.join(ROOT, 'public', 'legal', `${name}.html`)));
});

router.get('/api/brand', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  // The public site shows no phone number for now; PDFs and emails still use contactInfo() in full
  const { phone, ...publicInfo } = contactInfo();
  res.json(publicInfo);
});

// ---------- Public: client submits a request ----------
router.post('/api/submit', screenshotUpload.array('screenshots', 4), async (req, res) => {
  // Multipart submissions carry the form fields as one JSON "payload" part
  if (typeof req.body.payload === 'string') {
    try { req.body = { ...JSON.parse(req.body.payload) }; } catch { return res.status(400).json({ error: 'The form data could not be read.' }); }
  }
  const { requestType } = req.body;

  // Agreement to the terms + privacy policy is required, and recorded with its version
  if (req.body.agreeTerms !== true && req.body.agreeTerms !== 'true') {
    return res.status(400).json({ error: 'Please agree to our Terms of Service and Privacy Policy to continue.' });
  }
  if (!REQUEST_TYPES.includes(requestType)) return res.status(400).json({ error: 'Please choose what you need help with.' });
  req.consent = { consent_at: new Date().toISOString(), consent_version: LEGAL_VERSION };
  if (requestType === 'Domains') return submitDomains(req, res);
  if (requestType === 'Consultancy') return submitConsultancy(req, res);

  // Same contact rules (lengths + a real-looking email) as the other request types,
  // and capped free text: every character here is sent to the AI and stored
  const contact = contactFields(req.body);
  const contactProblem = contactError(contact, req.body);
  if (contactProblem) return res.status(400).json({ error: contactProblem });
  const details = String(req.body.details || '').trim().slice(0, 6000);
  if (!details) return res.status(400).json({ error: 'Please describe what you need.' });
  const short = (v) => String(v || '').trim().slice(0, 500) || null;
  const usersAffected = short(req.body.usersAffected);
  const attemptsTaken = short(req.body.attemptsTaken);
  const devicesAffected = short(req.body.devicesAffected);
  const { name, surname, company_name: companyName, email, phone, position, company_website: companyWebsite } = contact;

  let shots;
  try { shots = validateScreenshots(req.files || []); } catch (e) { return res.status(400).json({ error: e.message }); }
  const pr = requestType === 'IT Support' ? sanitizePriority(req.body.priority, req.body.canWork) : { priority: null, can_work: null };

  try {
    const aiDraft = await draftRequirements({
      requestType, details, companyName, usersAffected, attemptsTaken, devicesAffected,
      priorityLabel: pr.priority ? `P${pr.priority} - ${PRIORITY_LABELS[pr.priority]}${pr.can_work === false ? ' (cannot work at all)' : ''}` : null,
      images: toClaudeImages(shots),
      textFiles: toClaudeText(shots),
    });

    let project = await db.createProject({
      requestType, name, surname, companyName, companyWebsite, email, phone, position, details,
      aiRequirements: aiDraft.requirements,
      aiScopeSummary: aiDraft.scope_summary,
      aiTitle: aiDraft.project_title,
      usersAffected, attemptsTaken, devicesAffected,
      priority: pr.priority, canWork: pr.can_work,
      consentAt: req.consent.consent_at, consentVersion: req.consent.consent_version,
    });

    // Attachments are stored after the request exists (they're filed under its reference).
    // A failed upload never loses the request itself.
    const attachments = [];
    for (const [i, shot] of shots.entries()) {
      try {
        const url = await uploadSignedContract(project.project_id, shot.buffer, shot.name, shot.type, `${isText(shot) ? 'textfile' : 'screenshot'}-${i + 1}`);
        attachments.push({ url, name: shot.name, type: shot.type, size: shot.size });
      } catch (e) {
        console.warn(`Attachment ${i + 1} upload failed for ${project.project_id}:`, e.message);
      }
    }
    if (attachments.length) project = await db.updateProject(project.id, { attachments });

    await sendReviewEmail({ submission: { requestType, name, surname, companyName, companyWebsite, email, phone, position, details }, aiDraft, projectId: project.project_id, priority: pr.priority, canWork: pr.can_work, attachments, baseUrl: BASE_URL });
    // The client's "we've received it" email. The request is already saved, so a failed send is
    // logged, never shown as a failed submission (which would only lead to a duplicate request).
    try {
      await sendRequestReceivedEmail({
        project: { ...project, request_type: requestType, name, email, details, priority: pr.priority, can_work: pr.can_work },
        attachments, baseUrl: BASE_URL,
      });
    } catch (e) {
      console.warn(`Request-received email failed for ${project.project_id}:`, e.message);
    }

    res.json({ success: true, projectId: project.project_id, attachments: attachments.length });
  } catch (err) {
    console.error('Submission failed:', err.message);
    res.status(500).json({ error: 'Something went wrong processing your submission.' });
  }
});

// ---------- Intake: Domains ----------

// The optional company website is cleaned to a plain https/http address (or refused): lib/website.js
const contactFields = (b) => ({
  name: String(b.name || '').trim().slice(0, 120),
  surname: String(b.surname || '').trim().slice(0, 120),
  company_name: String(b.companyName || '').trim().slice(0, 160),
  email: String(b.email || '').trim().toLowerCase().slice(0, 254),
  phone: String(b.phone || '').trim().slice(0, 40),
  position: String(b.position || '').trim().slice(0, 120),
  company_website: cleanWebsite(b.companyWebsite).value || null,
});

function contactError(c, b = {}) {
  if (!c.name || !c.company_name) return 'Please enter your name and company.';
  const site = cleanWebsite(b.companyWebsite);
  if (site.error) return site.error;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) return 'Please enter a valid email address.';
  return null;
}

async function submitDomains(req, res) {
  const contact = contactFields(req.body);
  const err = contactError(contact, req.body);
  if (err) return res.status(400).json({ error: err });
  const { valid, invalid, tooMany } = domainsLib.parseDomainList(req.body.domains);
  if (invalid.length) return res.status(400).json({ error: `These don't look like domains: ${invalid.join(', ')}` });
  if (!valid.length) return res.status(400).json({ error: 'Enter at least one domain, e.g. yourcompany.co.zw' });
  if (tooMany) return res.status(400).json({ error: 'Up to 20 domains per request, please.' });
  const service = req.body.domainService === 'manage' ? 'manage' : 'register';

  try {
    const project = await db.createRequest({
      ...contact,
      ...req.consent,
      request_type: 'Domains',
      status: 'domain_requested',
      domain_service: service,
      domains: valid,
      details: String(req.body.details || '').trim().slice(0, 4000),
      project_title: `${service === 'manage' ? 'Domain management' : 'Domain registration'}: ${valid[0]}${valid.length > 1 ? ` +${valid.length - 1}` : ''}`,
    });
    await Promise.all([
      sendDomainReceivedEmail({ project, baseUrl: BASE_URL }),
      sendDomainAdminAlert({ project, baseUrl: BASE_URL }),
    ]);
    res.json({ success: true, projectId: project.project_id });
  } catch (e) {
    console.error('Domain submission failed:', e.message);
    res.status(500).json({ error: 'Something went wrong processing your request.' });
  }
}

// ---------- Intake: Consultancy ----------

async function submitConsultancy(req, res) {
  const contact = contactFields(req.body);
  const err = contactError(contact, req.body);
  if (err) return res.status(400).json({ error: err });
  const details = String(req.body.details || '').trim().slice(0, 6000);
  if (details.length < 20) return res.status(400).json({ error: 'Please describe your challenge in a little more detail.' });

  // The AI draft is a convenience: if it fails, the request still goes through
  let draft = { title: '', suggestMeeting: false, response: '' };
  try {
    draft = await draftConsultResponse({ companyName: contact.company_name, contactName: contact.name, details, brand: brandName() });
  } catch (e) {
    console.warn('Consultancy AI draft failed (request saved without a draft):', e.message);
  }

  try {
    const project = await db.createRequest({
      ...contact,
      ...req.consent,
      request_type: 'Consultancy',
      status: 'consult_requested',
      details,
      consult_draft: draft.response || null,
      project_title: draft.title || 'Consultancy request',
    });
    await Promise.all([
      sendConsultReceivedEmail({ project }),
      sendConsultAdminDraft({ project, draft: draft.response || '(The AI draft could not be generated - write your reply on the Consultancy page.)', suggestMeeting: draft.suggestMeeting, baseUrl: BASE_URL }),
    ]);
    res.json({ success: true, projectId: project.project_id });
  } catch (e) {
    console.error('Consultancy submission failed:', e.message);
    res.status(500).json({ error: 'Something went wrong processing your request.' });
  }
}


// ---------- Public: the original form-first homepage, kept as a choice ----------
router.get('/classic', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'classic.html'));
});

// ---------- Public: track a project by ID + email (no link required) ----------
router.get('/track', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'track.html'));
});

router.get('/api/track', async (req, res) => {
  const { projectId, email } = req.query;

  if (!projectId || !email) {
    return res.status(400).json({ error: 'Project ID and email are both required.' });
  }
  // Upper case, spaces typed for hyphens ("tanner 7kq 4x9"), same as everywhere else
  const ref = db.cleanRef(String(projectId).slice(0, 40)) || String(projectId).trim().toUpperCase().slice(0, 40);
  // Older references are short (TANNER-5422), so lookups are capped per reference: per connection,
  // so someone hammering a reference can't lock the real client out of tracking it, and overall
  // (higher), so guessing the email from many addresses still stalls
  const perRefIp = sec.rateLimit(`track-ref-ip:${ref}:${sec.clientIp(req)}`, { limit: 15, windowMs: 60 * 60 * 1000 });
  const perRefAll = sec.rateLimit(`track-ref:${ref}`, { limit: 150, windowMs: 60 * 60 * 1000 });
  const perRef = perRefIp.allowed ? perRefAll : perRefIp;
  if (!perRef.allowed) {
    res.set('Retry-After', String(perRef.retryAfterSec));
    return res.status(429).json({ error: `Too many lookups for that reference. Please wait ${Math.ceil(perRef.retryAfterSec / 60)} minute(s) and try again.` });
  }

  try {
    const project = await db.getProjectByIdAndEmail(ref, String(email).trim().toLowerCase().slice(0, 254));
    // lib/track.js decides what's public: status, paperwork states, dates and (support) hours.
    // Never the portal token, file links, project prices or work notes.
    res.json(trackView(project, { supportBilling }));
  } catch (err) {
    res.status(404).json({ error: 'No matching project found for that reference and email.' });
  }
});

// "Email me my private link": the tracking page never shows the private link itself (a reference
// and an email would then be as good as the link). It can only send it to the address on file.
// Same answer, at roughly the same time, whether or not anything matched.
router.post('/api/track/link', async (req, res) => {
  const started = Date.now();
  const ref = db.cleanRef(String(req.body.projectId || '').slice(0, 40));
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
  const ipLimit = sec.rateLimit(`track-link-ip:${sec.clientIp(req)}`, { limit: 6, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.allowed) {
    res.set('Retry-After', String(ipLimit.retryAfterSec));
    return res.status(429).json({ error: `Too many requests. Please wait ${Math.ceil(ipLimit.retryAfterSec / 60)} minute(s) and try again.` });
  }
  try {
    const project = ref && email ? await db.getProjectByIdAndEmail(ref, email).catch(() => null) : null;
    // At most 3 emails an hour per request, so nobody can flood the client's inbox
    if (project && trackView(project).privateLink && sec.rateLimit(`track-link-sent:${project.id}`, { limit: 3, windowMs: 60 * 60 * 1000 }).allowed) {
      await sendPortalLinkEmail({ project, baseUrl: BASE_URL });
    }
  } catch (err) {
    console.error('Private link email:', err.message);
  }
  const wait = Math.max(0, 600 - (Date.now() - started));
  setTimeout(() => res.json({ ok: true, message: "If those details match a request, we've emailed its private link to that address. It can take a minute to arrive." }), wait);
});

module.exports = router;
