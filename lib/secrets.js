// Field-level encryption for stored credentials (e.g. clients' registrar passwords).
// AES-256-GCM with a key that lives ONLY in .env (CREDENTIALS_KEY), never in the
// database - so a database leak alone doesn't expose any password.
//
// Generate a key once:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// Keep it safe: if it's lost, stored passwords can't be decrypted.

const crypto = require('crypto');

function getKey() {
  const raw = (process.env.CREDENTIALS_KEY || '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

function credentialsConfigured() {
  return getKey() !== null;
}

function encryptSecret(plain) {
  const key = getKey();
  if (!key) {
    const err = new Error('Password storage is off: set CREDENTIALS_KEY in .env first (see BUILD-LOG section 18).');
    err.status = 400;
    throw err;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function decryptSecret(stored) {
  if (!stored) return null;
  const key = getKey();
  if (!key) throw new Error('CREDENTIALS_KEY is not set, so stored passwords cannot be decrypted.');
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1') throw new Error('Unknown encryption format.');
  const tagBuf = Buffer.from(String(tag || ''), 'base64');
  if (tagBuf.length !== 16) throw new Error('Stored secret is damaged (bad authentication tag).'); // a cut-down tag is easier to forge
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: 16 });
  decipher.setAuthTag(tagBuf); // tampered data fails here instead of decrypting to garbage
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret, credentialsConfigured };
