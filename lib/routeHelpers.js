// Small things several route files share: upload limits, where admin pages live, safe public
// errors, and a few parsers. Kept here so each lib/*Routes.js file stays self-contained.
const path = require('path');
const multer = require('multer');
const { uploadSignedContract } = require('./storage');
const { detectSignedDocument } = require('./attachments');
const followups = require('./followups');

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');

// Admin pages live in /views, outside the static folder: the only way to load one is its
// signed-in route (no encoded-path tricks like /admin%2Ehtml can reach them)
const VIEWS = path.join(ROOT, 'views');

// Portal uploads (signed contracts, estimates, sign-offs): up to 10 MB, kept in memory until checked
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Intake form: optional attachments (support + projects). Up to 4: images 5 MB each, text files 1 MB.
const screenshotUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 4 } });

const SIGNED_DOC_ERROR = 'Please upload the signed copy as a PDF, PNG or JPG.';

// Portal uploads: stored with the extension + type their bytes prove, never the name the browser sent
function storeSignedDocument(project, file, label) {
  const doc = detectSignedDocument(file.buffer);
  return uploadSignedContract(project.project_id, file.buffer, `signed.${doc.ext}`, doc.type, label);
}

const REQUEST_TYPES = ['IT Support', 'IT Project', 'Domains', 'Consultancy'];

// Public routes: show a message only when we raised it on purpose (err.status), never database
// or storage internals. Admin APIs keep the real detail; these are reachable by anyone.
function publicError(res, err, fallback = 'Something went wrong. Please try again.') {
  return res.status(err.status || 500).json({ error: err.status ? err.message : fallback });
}

// Money arrives from the browser as a string or number; accept only a sane amount
function parseMoney(v) {
  // Blank must be rejected explicitly: Number('') is 0, which would silently save $0
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s$]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100000000) return null;
  return Math.round(n * 100) / 100;
}

// A follow-up with its schedule in words and how overdue it is (screens and reminder emails)
function withSchedule(fu) {
  return { ...fu, schedule_label: followups.describeSchedule(fu), days_overdue: followups.daysOverdue(fu.due_date) };
}

module.exports = {
  PORT, BASE_URL, ROOT, VIEWS,
  upload, screenshotUpload, SIGNED_DOC_ERROR, storeSignedDocument,
  REQUEST_TYPES, publicError, parseMoney, withSchedule,
};
