// Runs every end-to-end suite in turn. `npm test`
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['auth', 'signoff', 'workspace', 'batch', 'hardening', 'calculator', 'accessories', 'reminders', 'documents', 'attachments', 'pipeline', 'home', 'website', 'audit', 'track', 'debrief', 'signin', 'tidy', 'demo'];
let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, `${s}.test.js`)], { encoding: 'utf8', timeout: 180000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const passed = (out.match(/✓/g) || []).length;
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.padEnd(10)} ${passed} checks${ok ? '' : `\n${out.split('\n').filter((l) => /FAIL|Error|assert/i.test(l)).slice(0, 5).join('\n')}`}`);
}
console.log(failed ? `\n${failed} suite(s) failed.` : '\nAll suites passed.');
process.exit(failed ? 1 : 0);
