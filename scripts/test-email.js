// Send a test email through Resend using your current .env settings.
//
//   npm run test-email -- you@example.com
//
// Tip: send it to an address that is NOT your Resend login email. If that
// arrives, your domain is verified and real clients will receive emails too.

require('dotenv').config();
const { sendEmail } = require('../lib/email');
const { emailFrom, emailReplyTo, contactInfo } = require('../lib/brand');

const to = process.argv[2];

function domainOf(from) {
  const m = String(from).match(/@([^>\s]+)/);
  return m ? m[1].toLowerCase() : null;
}

async function checkDomain(domain) {
  // Needs a "Full access" API key; a "Sending access" key can't list domains (that's fine)
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (!res.ok) return `  (couldn't read domain status - your API key is probably "sending access" only, which is fine)`;
    const { data = [] } = await res.json();
    const d = data.find((x) => x.name.toLowerCase() === domain);
    if (!d) return `  ✗ ${domain} is not added in Resend → Domains yet. Names there: ${data.map((x) => x.name).join(', ') || 'none'}`;
    return d.status === 'verified'
      ? `  ✓ ${domain} is verified in Resend`
      : `  … ${domain} status in Resend: "${d.status}" - finish the DNS records, then click Verify DNS Records`;
  } catch (err) {
    return `  (couldn't reach Resend to check the domain: ${err.message})`;
  }
}

(async () => {
  if (!to || !to.includes('@')) {
    console.log('Usage: npm run test-email -- you@example.com');
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.log('✗ RESEND_API_KEY is missing from .env');
    process.exit(1);
  }

  const from = emailFrom();
  const domain = domainOf(from);
  console.log('\nSending setup');
  console.log(`  From:      ${from}`);
  console.log(`  Reply-To:  ${emailReplyTo() || '(none - replies go to the From address)'}`);
  console.log(`  To:        ${to}`);
  console.log(`  BASE_URL:  ${process.env.BASE_URL || '(not set)'}`);

  if (domain === 'resend.dev') {
    console.log("\n  ! Still using Resend's shared test sender. It only delivers to your own Resend");
    console.log('    login address. Set EMAIL_FROM to your verified domain to send to anyone.');
  } else if (domain) {
    console.log(await checkDomain(domain));
  }

  const c = contactInfo();
  try {
    const result = await sendEmail({
      to: [to],
      subject: `Test email from ${c.name}`,
      html: `
        <h2>It works!</h2>
        <p>This test email was sent by your project intake system through Resend.</p>
        <p>If you can read this at <strong>${to}</strong>, emails are being delivered from <strong>${from.replace(/</g, '&lt;')}</strong>.</p>
        <p style="color:#5A5A5A;font-size:13px;">Check the header logo and the signature below. (While BASE_URL is localhost, the logo shows as text - that's expected.)</p>`,
    });
    console.log(`\n✓ Sent. Resend message id: ${result.id}`);
    console.log('  Check the inbox (and spam folder). In Gmail, open the email → ⋮ → "Show original"');
    console.log('  and look for SPF: PASS and DKIM: PASS.\n');
  } catch (err) {
    console.log(`\n✗ Not sent.\n  ${err.message}\n`);
    process.exit(1);
  }
})();
