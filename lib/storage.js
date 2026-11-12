// File storage (Supabase Storage). The bucket is PRIVATE: nothing is readable by URL alone.
// We still store each file's canonical "public-style" URL as its identifier (so existing data
// keeps working), but every file is served through /files/<path>, which checks who's asking and
// then redirects to a signed link that expires in 60 seconds. See lib/fileAccess.js.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'contracts';
const PUBLIC_PREFIX = `${String(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/`;

async function uploadSignedContract(projectId, fileBuffer, originalName, mimeType, label = 'signed') {
  const safeExt = (String(originalName).split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const safeLabel = String(label).replace(/[^a-z0-9-]/gi, '') || 'signed';
  const safeFolder = String(projectId).replace(/[^A-Za-z0-9_-]/g, '') || 'misc';
  const path = `${safeFolder}/${Date.now()}-${safeLabel}.${safeExt}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, fileBuffer, {
    upsert: true,
    contentType: mimeType || 'application/octet-stream',
  });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return PUBLIC_PREFIX + path; // identifier only: the bucket is private
}

// "https://<project>.supabase.co/storage/v1/object/public/contracts/TANNER-5422/x.pdf" -> "TANNER-5422/x.pdf"
function pathFromUrl(url) {
  const s = String(url || '');
  if (s.startsWith(PUBLIC_PREFIX)) return decodeURIComponent(s.slice(PUBLIC_PREFIX.length).split('?')[0]);
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function signedUrl(path, seconds = 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) throw new Error(`Could not open the file: ${error.message}`);
  return data.signedUrl;
}

async function download(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Could not read the file: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

module.exports = { uploadSignedContract, pathFromUrl, signedUrl, download, PUBLIC_PREFIX, BUCKET };
