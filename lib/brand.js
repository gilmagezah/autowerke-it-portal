// Brand assets and shared branded layouts (PDF logo + email wrapper).
//
// File naming from the logo pack:
//   *-light.*  = dark artwork (#141414) for LIGHT backgrounds (paper, white pages)
//   *-dark.*   = light artwork (#F4F2EE) for DARK backgrounds

const fs = require('fs');
const path = require('path');

const BRAND_DIR = path.join(__dirname, '..', 'public', 'brand');
const LOGO_PNG = path.join(BRAND_DIR, 'autowerke-it-logo-light.png'); // 2000 x 303
const LOGO_RATIO = 303 / 2000;
const INK = '#141414';

function brandName() {
  return (process.env.COMPANY_BRAND || 'AutoWerke | IT').trim();
}

// Draws the wordmark into a pdfkit doc. Returns the drawn height (0 if the
// file is missing, so a missing logo never breaks document generation).
function drawPdfLogo(doc, x, y, width) {
  if (!fs.existsSync(LOGO_PNG)) return 0;
  doc.image(LOGO_PNG, x, y, { width });
  return width * LOGO_RATIO;
}

function esc(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Contact details (email signature, website footer, PDFs). Defaults come from
// the AutoWerke IT signature; override any of them in .env.
function contactInfo() {
  return {
    name: brandName(),
    email: (process.env.BRAND_EMAIL || 'services@autowerkeit.com').trim(),
    phone: (process.env.BRAND_PHONE || '+263 00 000 0000').trim(),
    location: (process.env.BRAND_LOCATION || 'Harare, Zimbabwe').trim(),
    tagline: (process.env.BRAND_TAGLINE || 'IT Support • Projects • Technical Consulting Services • Solutions').trim(),
  };
}

// The contact lines in PDF headers. No phone number for now: set PDF_PHONE to the work number
// to print one (BRAND_PHONE, a personal number, stays out of documents clients keep).
function pdfContactLines(c = contactInfo()) {
  const phone = String(process.env.PDF_PHONE || '').trim();
  return [c.email, phone, c.location].filter(Boolean).join('\n');
}

const telHref = (phone) => `tel:${String(phone).replace(/[^+\d]/g, '')}`;

// Email clients fetch images from the internet, so an asset hosted on
// localhost / a private IP can't load. Returns null in that case.
function publicAssetUrl(file, baseUrl = process.env.BASE_URL || '') {
  try {
    const { hostname, protocol } = new URL(baseUrl);
    const privateHost = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/.test(hostname);
    if (privateHost || !/^https?:$/.test(protocol)) return null;
    return `${baseUrl.replace(/\/+$/, '')}/brand/${file}`;
  } catch {
    return null;
  }
}

// Emails use the logo on a white rounded plate (made by scripts/make-email-logo.js). Gmail and
// Outlook dark mode ignore our dark-mode CSS but never recolour images, so the plate keeps the logo
// readable on their dark background; on a white email it can't be seen.
const LOGO_PLATE = 'autowerke-it-logo-email-plate.png'; // 648 x 127: the 600px logo plus 24/18px padding
const publicLogoUrl = (baseUrl) => publicAssetUrl(LOGO_PLATE, baseUrl);

// The AutoWerke IT email signature (layout from signature.html)
function emailSignature(baseUrl) {
  const c = contactInfo();
  const logoUrl = publicAssetUrl(LOGO_PLATE, baseUrl); // on a white plate, so Gmail's dark mode can't hide it
  const darkUrl = publicAssetUrl('autowerke-it-logo-dark.png', baseUrl); // cream version, swapped in for dark mode
  const logo = logoUrl
    ? `<img class="aw-logo-l" src="${esc(logoUrl)}" width="162" height="32" alt="${esc(c.name)}" style="display:block;border:0;outline:none;width:162px;height:32px;">`
      + `<img class="aw-logo-d" src="${esc(darkUrl)}" width="150" height="23" alt="${esc(c.name)}" style="display:none;mso-hide:all;border:0;outline:none;width:150px;height:23px;margin:0 6px;">`
    : `<span style="font-size:15px;font-weight:bold;color:${INK};white-space:nowrap;">${esc(c.name)}</span>`;
  return `
<table class="aw-sig" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:${INK};">
  <tr>
    <td style="padding:0 10px 0 0;vertical-align:middle;">${logo}</td>
    <td class="aw-sig-line" style="width:2px;background-color:${INK};font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding:0 0 0 16px;vertical-align:middle;font-size:12px;line-height:18px;">
      <a href="mailto:${esc(c.email)}" style="color:${INK};text-decoration:none;font-weight:bold;">${esc(c.email)}</a><br>
      <a href="${esc(telHref(c.phone))}" style="color:${INK};text-decoration:none;">${esc(c.phone)}</a><br>
      <span style="color:#5A5A5A;">${esc(c.location)}</span>
    </td>
  </tr>
  <tr>
    <td colspan="3" style="padding:12px 0 0 0;font-size:11px;line-height:16px;color:#5A5A5A;">${esc(c.tagline)}</td>
  </tr>
</table>`;
}

// House style for email bodies. Email apps ignore <style> blocks, so plain <h2>, <h3>, <p>, <ul>
// and <a> tags get the brand look inline here: typewriter headings, bold green section labels that
// sit close to their text, green links. Tags that already carry a style attribute are left alone.
const EMAIL_MONO = "'Courier Prime','Courier New',Courier,monospace";
const EMAIL_GREEN = '#2F4A3B';
const EMAIL_PAPER = '#F4F1E8';
function houseStyle(html) {
  return String(html)
    .replace(/<h2>/g, `<h2 style="margin:0 0 14px;font-family:${EMAIL_MONO};font-size:21px;line-height:1.3;color:#1F2622;">`)
    .replace(/<h3>/g, `<h3 style="margin:20px 0 4px;font-family:${EMAIL_MONO};font-size:13px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${EMAIL_GREEN};">`)
    .replace(/<p>/g, '<p style="margin:0 0 12px;">')
    .replace(/<ul>/g, '<ul style="margin:0 0 12px;padding-left:20px;">')
    .replace(/<a href="([^"]*)">/g, `<a href="$1" style="color:${EMAIL_GREEN};font-weight:bold;">`);
}

// Wraps any email body in the branded layout (table-based for Gmail/Outlook).
// `preheader` is the line inboxes show next to the subject; hidden in the email itself.
// `paper` puts the card on the cream background (the warm "thank you" emails). Everything else
// has no background colour, so it sits on the reader's own email background, dark mode included.
// Dark mode. Apple Mail, iOS Mail and Outlook for Mac read this and switch to light text, dark
// boxes and the cream logo when the reader uses dark mode. Gmail ignores <style> here and darkens
// emails its own way. Inline colours win over plain CSS, hence !important. Light mode is unchanged.
const EMAIL_DARK_CSS = `<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .aw, .aw .aw-card { background: transparent !important; }
    .aw .aw-card { border-color: #3B413D !important; }
    .aw td, .aw p, .aw li, .aw h2, .aw div, .aw span, .aw strong, .aw .aw-sig a { color: #E8E5DC !important; }
    .aw h3, .aw a { color: #9CC8A0 !important; }
    .aw .aw-cream { background: #262B28 !important; }
    .aw .aw-warn { color: #F28B82 !important; }
    .aw .aw-btn a { color: #FFFFFF !important; }
    .aw .aw-btn-cream a { color: #2F4A3B !important; }
    .aw .aw-bar { background: #6E9C78 !important; }
    .aw .aw-hair { background: #3B413D !important; }
    .aw .aw-sig-line { background: #E8E5DC !important; }
    .aw .aw-logo-l { display: none !important; }
    .aw .aw-logo-d { display: block !important; }
  }
</style>`;

// Tags elements for the dark-mode styles above, so no email has to remember to: any untagged box
// with the cream background turns dark (`aw-cream`), and any warning in the red (#A33A2E) becomes a
// lighter red that stays readable on dark (`aw-warn`). Light mode looks exactly the same.
function darkModeHooks(html) {
  return String(html)
    .replace(/<(\w+) style="((?:[^"]*;)?\s*background(?:-color)?:\s*#F4F1E8[^"]*)"/gi, '<$1 class="aw-cream" style="$2"')
    .replace(/<(\w+) style="((?:[^"]*;)?\s*color:\s*#A33A2E[^"]*)"/gi, '<$1 class="aw-warn" style="$2"');
}

function emailLayout(innerHtml, baseUrl, { preheader = '', paper = false } = {}) {
  const brand = brandName();
  const logoUrl = publicLogoUrl(baseUrl);
  const darkUrl = publicAssetUrl('autowerke-it-logo-dark.png', baseUrl);
  const header = logoUrl
    // The plate adds about 7px each side and 5px above and below, so the cell is pulled in by that
    // much and the lettering lines up with the text and the green bar exactly as before
    ? `<img class="aw-logo-l" src="${esc(logoUrl)}" alt="${esc(brand)}" width="184" style="display:block;width:184px;max-width:100%;height:auto;border:0;">`
      + `<img class="aw-logo-d" src="${esc(darkUrl)}" alt="${esc(brand)}" width="170" style="display:none;mso-hide:all;width:170px;max-width:100%;height:auto;border:0;margin:5px 7px;">`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:${INK};letter-spacing:-0.3px;">${esc(brand)}</span>`;
  // Padding after the preheader stops inboxes pulling body text into the preview
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${EMAIL_PAPER};opacity:0;">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(60)}</div>`
    : '';
  // Under the logo: a hairline with a short green bar at the start, as on the PDFs
  const rule = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:9px;"><tr>
        <td class="aw-bar" width="56" style="width:56px;height:3px;background:${EMAIL_GREEN};font-size:0;line-height:0;">&nbsp;</td>
        <td style="vertical-align:bottom;"><div class="aw-hair" style="height:1px;background:#E3DED2;font-size:0;line-height:0;">&nbsp;</div></td>
      </tr></table>`;

  return `${EMAIL_DARK_CSS}
<div class="aw" style="${paper ? `background:${EMAIL_PAPER};` : ''}padding:24px 12px;margin:0;">${pre}
  <table class="aw-card" role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:600px;margin:0 auto;${paper ? 'background:#ffffff;' : ''}border-radius:10px;border-collapse:separate;border:1px solid #E6E1D3;">
    <tr><td style="padding:${logoUrl ? '17px 28px 0 21px' : '22px 28px 0'};">${header}<div style="padding-left:${logoUrl ? 7 : 0}px;">${rule}</div></td></tr>
    <tr><td style="padding:22px 28px 24px;font-family:Arial,Helvetica,sans-serif;color:#1F2622;font-size:14px;line-height:1.55;">
      ${darkModeHooks(houseStyle(innerHtml))}
    </td></tr>
    <tr><td style="padding:18px 28px 24px;border-top:1px solid #EEEBE2;">${emailSignature(baseUrl)}</td></tr>
  </table>
</div>`;
}

// Who emails come from. Set EMAIL_FROM once your domain is verified in Resend.
function emailFrom() {
  return process.env.EMAIL_FROM || `"${brandName()}" <onboarding@resend.dev>`;
}

// Where client replies go (e.g. your M365 inbox) when sending from a no-reply address
function emailReplyTo() {
  const v = (process.env.EMAIL_REPLY_TO || '').trim();
  return v || null;
}

module.exports = {
  brandName, contactInfo, pdfContactLines, telHref, drawPdfLogo, emailLayout, emailSignature, emailFrom, emailReplyTo,
  publicAssetUrl, publicLogoUrl, LOGO_PNG, LOGO_RATIO,
};
