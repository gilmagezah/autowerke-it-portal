// Workspace templates. Each field: { key, label, type, options?, secret? }.
// Secret fields are encrypted on the server and only shown on "Reveal".
// To add or change a template, edit it here (and its secret fields in lib/workspace.js).
window.WS = (function () {
  const MFA = ['None', 'Authenticator app', 'SMS', 'Email', 'Hardware key (FIDO2)', 'Passkey', 'Temporary Access Pass', 'Other'];

  const TEMPLATES = {
    login: {
      label: 'Login & MFA', section: 'logins', titleLabel: 'System / site', placeholder: 'e.g. Microsoft 365 admin (tanner.onmicrosoft.com)',
      fields: [
        { key: 'url', label: 'Login link', type: 'url' },
        { key: 'username', label: 'Username', type: 'text' },
        { key: 'password', label: 'Password', type: 'password', secret: true },
        { key: 'mfa_method', label: 'MFA method', type: 'select', options: MFA },
        { key: 'mfa_holder', label: 'MFA held by', type: 'text', placeholder: "Whose phone / key? e.g. Rudo's authenticator" },
        { key: 'recovery', label: 'Recovery route', type: 'text', placeholder: 'e.g. Second global admin, TAP from Entra' },
        { key: 'mfa_backup', label: 'Backup codes', type: 'password', secret: true },
        { key: 'breakglass', label: 'Break-glass / emergency account', type: 'checkbox' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    access: {
      label: 'Access & expiry', section: 'logins', titleLabel: 'What access', placeholder: 'e.g. GDAP Exchange Administrator',
      fields: [
        { key: 'access_type', label: 'Type', type: 'select', options: ['GDAP relationship', 'PIM role', 'Guest account', 'Delegated admin', 'VPN', 'Remote tool', 'Other'] },
        { key: 'granted_by', label: 'Granted by', type: 'text' },
        { key: 'granted_on', label: 'Granted on', type: 'date' },
        { key: 'expires_on', label: 'Expires on', type: 'date' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    email: {
      label: 'Email draft', section: 'emails', titleLabel: 'Draft name', placeholder: 'e.g. Status update to Rudo',
      fields: [
        { key: 'to', label: 'To', type: 'text' },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'body', label: 'Message', type: 'textarea', rows: 10 },
      ],
    },
    contact: {
      label: 'Contact', section: 'people', titleLabel: 'Name', placeholder: 'e.g. Rudo Moyo',
      fields: [
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'company', label: 'Company', type: 'text' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone', type: 'tel' },
        { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'e.g. Approves changes; prefers WhatsApp' },
      ],
    },
    checklist: { label: 'Checklist', section: 'checklists', titleLabel: 'Checklist name', placeholder: 'e.g. Go-live checks', fields: [] },
    change: {
      label: 'Change log', section: 'changes', titleLabel: 'Change', placeholder: 'e.g. Enabled Conditional Access baseline',
      fields: [
        { key: 'when', label: 'When', type: 'datetime-local' },
        { key: 'what', label: 'What changed', type: 'textarea' },
        { key: 'why', label: 'Why', type: 'textarea' },
        { key: 'rollback', label: 'Rollback plan', type: 'textarea' },
        { key: 'approved_by', label: 'Approved by', type: 'text' },
        { key: 'result', label: 'Status', type: 'select', options: ['Planned', 'Done', 'Rolled back'] },
      ],
    },
    scope: {
      label: 'Scope request', section: 'changes', titleLabel: 'Request', placeholder: "e.g. 'Can you also set up the CEO's iPad?'",
      fields: [
        { key: 'requested_by', label: 'Requested by', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'in_scope', label: 'In scope?', type: 'select', options: ['Not sure yet', 'In scope', 'Out of scope'] },
        { key: 'decision', label: 'Decision / action', type: 'textarea', placeholder: 'e.g. Quote separately as support ticket' },
      ],
    },
    waiting: {
      label: 'Waiting on', section: 'changes', titleLabel: 'Waiting on', placeholder: "e.g. Client's ISP to open port 443",
      fields: [
        { key: 'who', label: 'Who', type: 'text' },
        { key: 'what', label: 'For what', type: 'textarea' },
        { key: 'since', label: 'Since', type: 'date' },
        { key: 'chased', label: 'Last chased', type: 'date' },
        { key: 'resolved', label: 'Resolved', type: 'checkbox' },
      ],
    },
    network: {
      label: 'Network / device', section: 'tech', titleLabel: 'Device / site', placeholder: 'e.g. Head office firewall',
      fields: [
        { key: 'ip', label: 'IP address', type: 'text' }, { key: 'subnet', label: 'Subnet', type: 'text' },
        { key: 'gateway', label: 'Gateway', type: 'text' }, { key: 'dns', label: 'DNS', type: 'text' },
        { key: 'vlan', label: 'VLAN', type: 'text' }, { key: 'wifi_ssid', label: 'Wi-Fi name', type: 'text' },
        { key: 'wifi_key', label: 'Wi-Fi key', type: 'password', secret: true },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    licence: {
      label: 'Licence / subscription', section: 'tech', titleLabel: 'Product', placeholder: 'e.g. Microsoft 365 Business Premium',
      fields: [
        { key: 'seats', label: 'Seats', type: 'text' }, { key: 'renewal', label: 'Renewal', type: 'date' },
        { key: 'portal', label: 'Admin portal', type: 'url' },
        { key: 'licence_key', label: 'Licence key', type: 'password', secret: true },
        { key: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    meeting: {
      label: 'Meeting notes', section: 'meetings', titleLabel: 'Meeting', placeholder: 'e.g. Kickoff with Tanner IT',
      fields: [
        { key: 'when', label: 'When', type: 'datetime-local' },
        { key: 'attendees', label: 'Attendees', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'textarea', rows: 7 },
        { key: 'actions', label: 'Actions', type: 'textarea', placeholder: 'One per line: who - what - by when' },
      ],
    },
  };

  const SECTIONS = [
    { key: 'notes', label: 'Notes canvas', kinds: [] },
    { key: 'logins', label: 'Logins & access', kinds: ['login', 'access'] },
    { key: 'emails', label: 'Email drafts', kinds: ['email'] },
    { key: 'people', label: 'People', kinds: ['contact'] },
    { key: 'checklists', label: 'Checklists', kinds: ['checklist'] },
    { key: 'changes', label: 'Changes & scope', kinds: ['change', 'scope', 'waiting'] },
    { key: 'tech', label: 'Network & licences', kinds: ['network', 'licence'] },
    { key: 'meetings', label: 'Meetings', kinds: ['meeting'] },
    { key: 'documents', label: 'Documents', kinds: ['document'] },
  ];

  const CHECKLISTS = {
    'Support triage': ['Confirm the problem and who is affected', 'Check recent changes (updates, policies, passwords)', 'Reproduce or see the error', 'Check service health / outages', 'Apply the fix', 'Confirm with the user it works', 'Log what was done'],
    'New user onboarding': ['Create account + assign licence', 'Add to groups / Teams / shared mailboxes', 'Register MFA', 'Enrol device in Intune', 'Install apps', 'Set up email signature', 'Walk the user through first login'],
    'User offboarding': ['Block sign-in + revoke sessions', 'Reset password', 'Convert mailbox to shared / set forwarding', 'Transfer OneDrive files', 'Remove from groups', 'Wipe or retire device', 'Remove licence'],
    'New device setup': ['Name the device + record serial', 'Enrol in Intune / Autopilot', 'Check BitLocker is on', 'Install apps + updates', 'Test sign-in + MFA', 'Hand over to user'],
    'Pre-change checks': ['Change approved', 'Backup / export taken', 'Rollback plan written', 'Users told about the window', 'Second admin available', 'Test plan ready'],
    'Go-live checks': ['All phases signed off internally', 'Monitoring in place', 'Documentation updated', 'Client contact briefed', 'Support handover done'],
  };

  const EMAILS = {
    'Status update': { subject: 'Update on {{ref}}', body: 'Hi {{first}},\n\nQuick update on {{title}}:\n\n- Done: \n- Next: \n- Needed from you: nothing for now\n\nKind regards,\nAutoWerke | IT' },
    'Need access / MFA code': { subject: 'Access needed for {{ref}}', body: "Hi {{first}},\n\nTo carry on with {{title}}, we need:\n\n- \n\nIf it needs an MFA code, could you let us know a time in the next day when you're free for a couple of minutes, and we'll do it together.\n\nKind regards,\nAutoWerke | IT" },
    'Waiting on you': { subject: 'Waiting on: {{ref}}', body: "Hi {{first}},\n\nWe're ready to continue {{title}}, but we're waiting on:\n\n- \n\nOnce that's sorted, we'll pick it straight back up.\n\nKind regards,\nAutoWerke | IT" },
    'Change window notice': { subject: 'Planned change: {{ref}}', body: "Hi {{first}},\n\nWe've scheduled a change for {{title}}:\n\nWhen: \nWhat: \nImpact: \nRollback: we can undo it within minutes if needed.\n\nLet us know if this time doesn't suit.\n\nKind regards,\nAutoWerke | IT" },
    'Resolution summary': { subject: 'Resolved: {{ref}}', body: "Hi {{first}},\n\nGood news, {{title}} is resolved.\n\nWhat happened: \nWhat we did: \nTo avoid it in future: \n\nKind regards,\nAutoWerke | IT" },
    'Scope change': { subject: 'Additional request: {{ref}}', body: "Hi {{first}},\n\nThanks for the request to also: \n\nThis falls outside the agreed scope of {{title}}, so we'll quote it separately. We'll keep the current work on track in the meantime.\n\nKind regards,\nAutoWerke | IT" },
  };

  return { TEMPLATES, SECTIONS, CHECKLISTS, EMAILS };
})();
