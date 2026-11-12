// The optional company website on the intake form. It helps us spell the company's name
// right and see what they do. It's stored and shown, never fetched by the server (so there's
// nothing to point at internal addresses), and only ever as a plain https/http address.

const { DOMAIN_RE } = require('./domains');

const MAX_LENGTH = 200;

// "Acme.co.zw" -> "https://acme.co.zw"; "http://www.acme.com/about?utm=x#top" -> "http://www.acme.com/about"
// Returns { value } (null when left blank) or { error } with a message for the client.
function cleanWebsite(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { value: null };
  const bad = { error: "That website address doesn't look right. Leave it blank if you're not sure." };
  if (raw.length > MAX_LENGTH || /\s/.test(raw)) return bad;

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return bad;
  }
  // Only ordinary web addresses: no javascript:, data:, ftp:, sign-in details or odd ports,
  // and a real public-looking domain name (no IP addresses or "localhost")
  if (!['https:', 'http:'].includes(url.protocol)) return bad;
  if (url.username || url.password || url.port) return bad;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!DOMAIN_RE.test(host)) return bad;

  const path = url.pathname === '/' ? '' : url.pathname;
  const value = `${url.protocol}//${host}${path}`;
  return value.length > MAX_LENGTH ? bad : { value };
}

// "https://www.acme.co.zw/about" -> "acme.co.zw/about": how it's shown to people
function displayWebsite(value) {
  return String(value || '').replace(/^https?:\/\//, '').replace(/^www\./, '');
}

module.exports = { cleanWebsite, displayWebsite, MAX_LENGTH };
