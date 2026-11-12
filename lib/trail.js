// The document trail for one request: every document from first request to receipt.
// Built from records that already exist, so it covers past requests and can't drift.
function buildTrail(p, invoices = [], receipts = []) {
  const t = [];
  const add = (when, kind, title, detail, url) => t.push({ when: when || null, kind, title, detail: detail || '', url: url || null });
  const support = p.request_type === 'IT Support';

  add(p.created_at, 'request', 'Request submitted', `${p.request_type}${p.project_title ? `: ${p.project_title}` : ''}${p.consent_version ? ` · terms ${p.consent_version} accepted` : ''}`);
  (p.attachments || []).forEach((a, i) => add(p.created_at, 'attachment', `Screenshot ${i + 1}`, a.name, a.url));

  if (support && p.estimated_hours) add(null, 'estimate', 'Work estimate', `${p.estimated_hours} h at $${p.hourly_rate}/h`, p.confirm_token ? `/api/estimate/${p.confirm_token}` : null);
  if (support && p.estimate_signed_url) add(p.estimate_signed_at, 'signed', 'Signed estimate (client approval)', '', p.estimate_signed_url);
  if (!support && p.pricing_estimate && ['pricing_sent', 'proceeding', 'signed', 'delivered', 'closed'].includes(p.status)) {
    add(null, 'contract', 'Quote / contract', p.contract_value ? `$${Number(p.contract_value).toLocaleString('en-US', { minimumFractionDigits: 2 })} excl. VAT` : '', p.confirm_token ? `/api/contract/${p.confirm_token}` : null);
  }
  if (p.signed_contract_url) add(p.signed_at, 'signed', 'Signed contract', '', p.signed_contract_url);
  if (p.request_type === 'Domains' && p.domain_quote) add(null, 'quote', 'Domain quote', `Total $${p.domain_quote.total}`);
  if (p.signoff_sent_at) add(p.signoff_sent_at, 'signoff', 'Sign-off document sent', '');
  if (p.signoff_signed_url) {
    const online = p.esign && p.esign.signed_pdf_url;
    add(p.signoff_signed_at || (p.esign && p.esign.signed_at), 'signed', online ? 'Sign-off signed online (with certificate)' : 'Signed sign-off', online ? `${p.esign.name} · ${p.esign.method}` : '', p.signoff_signed_url);
  }
  if (p.esign) (p.esign.documents || []).forEach((d) => add(p.esign.signed_at, 'payment-doc', 'Purchase order / proof of payment', d.name, d.url));
  invoices.forEach((inv) => add(inv.issued_at, 'invoice', `Invoice ${inv.number}`, `$${inv.total} · ${inv.status}`, inv.pdf_url));
  receipts.forEach((r) => add(r.received_on, 'receipt', `Receipt ${r.number}`, `$${r.amount}${r.method ? ` · ${r.method}` : ''}${r.source === 'uploaded' ? ' · uploaded' : ''}`, r.file_url));
  return t;
}
module.exports = { buildTrail };
