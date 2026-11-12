// Accessories logic (public/acc-core.js): pins, Quick find ranking and destinations, and the
// support timer's work-log entries, dates and holidays, passwords, currency, world clock and the
// notes merge. Run in Node exactly as the browser runs it. `npm test`.
// The server side (the Quick find list, log-hours checks) is covered in hardening.test.js.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../public/acc-core.js');

// 1. Pins: up to 4, no duplicates, unknown ids dropped, a fifth refused (not swapped in)
const known = ['calc', 'find', 'notes', 'timer', 'clock'];
let p = A.togglePin([], 'calc', known);
assert.deepStrictEqual(p.pins, ['calc']);
p = A.togglePin(['calc', 'calc', 'ghost'], 'find', known);
assert.deepStrictEqual(p.pins, ['calc', 'find']);
p = A.togglePin(['calc', 'find', 'notes', 'timer'], 'clock', known);
assert(p.full && !p.ok && p.pins.length === 4);
p = A.togglePin(['calc', 'find', 'notes', 'timer'], 'find', known);
assert.deepStrictEqual(p.pins, ['calc', 'notes', 'timer']);
assert.deepStrictEqual(A.togglePin('not an array', 'nope', known).pins, []);
console.log('1. pins: max 4, no duplicates, unknown ids dropped, a fifth is refused ✓');

// 2. Quick find ranking
const rows = [
  { ref: 'TANNER-5422', company: 'Tanner Republic', contact: 'Bryan Cherfi', email: 'bryan@tanner.co.zw', phone: '+263 771234567', type: 'IT Support', status: 'in_progress', updated: '2026-10-01' },
  { ref: 'KOPJE-1001', company: 'Kopje Engineering', contact: 'Rudo Chari', email: 'rudo@kopje.com', phone: '', type: 'IT Project', status: 'signed', updated: '2026-10-20' },
  { ref: 'AGRICF-3300', company: 'AgricFert', contact: 'Tanaka Moyo', email: 'tanaka@agricfert.co.zw', phone: '+27 821112222', type: 'Consultancy', status: 'consult_closed', updated: '2026-09-02' },
  { ref: 'APU-7788', company: 'APU', contact: 'Rudo Moyo', email: 'rudo@apu.ac.zw', phone: '', type: 'Domains', status: 'domain_quoted', updated: '2026-11-01' },
];
assert.strictEqual(A.search(rows, 'tanner-5422')[0].ref, 'TANNER-5422', 'exact reference first');
assert.strictEqual(A.search(rows, 'tan')[0].ref, 'TANNER-5422', 'reference/company prefix beats a contact');
assert.deepStrictEqual(A.search(rows, 'moyo').map((r) => r.ref), ['APU-7788', 'AGRICF-3300'], 'ties go to the most recent');
assert.deepStrictEqual(A.search(rows, 'moyo agric').map((r) => r.ref), ['AGRICF-3300'], 'every word must match');
assert.strictEqual(A.search(rows, '0771 234')[0].ref, 'TANNER-5422', 'phone digits match with or without the leading 0');
assert.strictEqual(A.search(rows, 'kopje.com')[0].ref, 'KOPJE-1001');
assert.strictEqual(A.search(rows, 'agricfért')[0].ref, 'AGRICF-3300', 'accents are ignored');
assert.deepStrictEqual(A.search(rows, '   '), []);
assert.deepStrictEqual(A.search(rows, '%'), [], '"%" is just a character here, never a wildcard');
assert.deepStrictEqual(A.search(rows, '.*'), [], 'nor is a regex');
assert.strictEqual(A.search(Array.from({ length: 50 }, (_, i) => ({ ref: `X-${i}`, company: 'Same' })), 'same').length, 8, 'at most 8 results');
console.log('2. Quick find: exact ref first, prefixes rank higher, all words must match, phone digits, accents, % is literal, max 8 ✓');

// 3. Where each request lives
assert.strictEqual(A.destination({ type: 'Domains', status: 'domain_quoted' }), '/admin/domains');
assert.strictEqual(A.destination({ type: 'Consultancy', status: 'consult_requested' }), '/admin/consultancy');
assert.strictEqual(A.destination({ type: 'IT Project', status: 'signed' }), '/admin/projects');
assert.strictEqual(A.destination({ type: 'IT Project', status: 'pricing_sent' }), '/admin');
assert.strictEqual(A.destination({ type: 'IT Support', status: 'in_progress' }), '/admin');
console.log('3. results open the page that lists them (pipeline, delivery, domains, consultancy) ✓');

// 4. Timer clock and work-log entries in Harare time, whatever timezone the machine runs in
assert.strictEqual(A.clock(0), '00:00:00');
assert.strictEqual(A.clock(3723000), '01:02:03');
assert.strictEqual(A.clock(-5), '00:00:00');
const now = new Date('2026-11-05T08:47:30Z'); // 10:47:30 in Harare (UTC+2)
let e = A.logEntry(42 * 60000 + 20000, now, 'Africa/Harare');
assert.deepStrictEqual(e, { date: '2026-11-05', start: '10:05', end: '10:47', minutes: 42 });
e = A.logEntry(89 * 60000 + 40000, now, 'Africa/Harare');
assert.strictEqual(e.minutes, 90, 'rounded to the nearest minute');
assert.strictEqual(e.start, '09:17');
assert.match(A.logEntry(20000, now).error, /at least a minute/);
assert.match(A.logEntry(17 * 3600000, now).error, /16 hours/);
const late = new Date('2026-11-05T22:20:00Z'); // 00:20 on the 6th in Harare
assert.match(A.logEntry(45 * 60000, late, 'Africa/Harare').error, /midnight/);
assert.strictEqual(A.logEntry(15 * 60000, late, 'Africa/Harare').date, '2026-11-06', 'the date is Harare’s, not the server’s');
console.log('4. timer: HH:MM:SS, entries end now and start the timed minutes earlier, in Harare time; <1 min, >16 h and past-midnight are refused ✓');

// 5. Front-end hygiene: no eval, no inline handlers, user text escaped in templates
const files = ['accessories.js', 'quickfind.js', 'notes.js', 'timer.js', 'calculator.js', 'acc-core.js'];
for (const f of files) {
  const src = fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
  assert(!/\beval\s*\(|new Function|\son[a-z]+\s*=\s*["'`]/.test(src), `${f}: no eval or inline handlers`);
}
// Lines that build HTML (they contain a tag) must wrap every request field in esc().
// Plain-text messages (textContent) are safe without it.
const htmlLines = fs.readFileSync(path.join(__dirname, '../public/quickfind.js'), 'utf8').split('\n').filter((l) => /<[a-z]/.test(l));
for (const field of ['ref', 'company', 'contact', 'title', 'email', 'phone', 'type', 'statusLabel']) {
  const raw = htmlLines.find((l) => new RegExp(`\\$\\{h\\.${field}\\}`).test(l)); // dropped straight in, unescaped
  assert(!raw, `quickfind.js puts h.${field} into HTML without esc(): ${raw}`);
}
assert(htmlLines.some((l) => /esc\(h\.ref\)/.test(l)), 'the check is looking at the real template');
const shell = fs.readFileSync(path.join(__dirname, '../public/admin-shell.js'), 'utf8');
assert(/accessories\.js/.test(shell), 'every admin page loads the accessories');
console.log('5. no eval or inline handlers; Quick find escapes every field it prints; the admin shell loads it all ✓');

// 6. Dates: Zimbabwe public holidays (Sunday ones move to Monday) and working-day maths
const hol = (y) => Object.fromEntries(A.zimHolidays(y).map((h) => [h.date, h.name]));
const h26 = hol(2026);
for (const d of ['2026-01-01', '2026-02-21', '2026-04-03', '2026-04-04', '2026-04-06', '2026-04-18', '2026-05-01', '2026-05-25', '2026-08-10', '2026-08-11', '2026-12-22', '2026-12-25', '2026-12-26']) {
  assert(h26[d], `${d} is a 2026 public holiday`);
}
assert.strictEqual(A.easter(2026), '2026-04-05');
assert.strictEqual(A.easter(2027), '2027-03-28');
assert(/Heroes/.test(h26['2026-08-10']) && /Defence/.test(h26['2026-08-11']), 'Heroes = 2nd Monday of August, Defence Forces the day after');
const h22 = hol(2022);
assert(/observed/.test(h22['2022-12-27'] || ''), 'Christmas on a Sunday (2022): Boxing Day is Monday, so the observed day is Tuesday 27th');
assert(/observed/.test(hol(2027)['2027-04-19'] || ''), '18 April 2027 is a Sunday, observed Monday 19th');
assert.strictEqual(A.isWorkingDay('2026-11-07'), false, 'Saturday');
assert.strictEqual(A.isWorkingDay('2026-12-25'), false, 'Christmas');
assert.strictEqual(A.isWorkingDay('2026-11-05'), true);
assert.strictEqual(A.addWorkingDays('2026-11-05', 1), '2026-11-06', 'Thu + 1 = Fri');
assert.strictEqual(A.addWorkingDays('2026-11-06', 1), '2026-11-09', 'Fri + 1 = Mon');
assert.strictEqual(A.addWorkingDays('2026-12-21', 3), '2026-12-28', 'skips Unity Day, Christmas and the weekend (Boxing Day 2026 is a Saturday)');
assert.strictEqual(A.addWorkingDays('2026-11-09', -1), '2026-11-06', 'backwards too');
assert.strictEqual(A.workingDaysBetween('2026-11-02', '2026-11-09'), 5);
assert.strictEqual(A.workingDaysBetween('2026-11-09', '2026-11-02'), -5);
assert.strictEqual(A.daysBetween('2026-02-28', '2026-03-01'), 1);
assert.strictEqual(A.addMonths('2026-01-31', 1), '2026-02-28', 'month-end clamps');
assert.strictEqual(A.addMonths('2028-01-31', 1), '2028-02-29', 'leap year');
assert.strictEqual(A.nextWorkingDay('2026-12-24'), '2026-12-28');
assert.deepStrictEqual(A.upcomingHolidays('2026-11-05', 2).map((h) => h.date), ['2026-12-22', '2026-12-25']);
assert(!A.isDate('2026-02-30') && !A.isDate('26-1-1') && A.isDate('2026-02-28'));
console.log('6. dates: Zimbabwe holidays (Easter, Heroes, Sunday to Monday), working days skip weekends and holidays, month ends clamp ✓');

// 7. Passwords: cryptographic, every chosen set present, look-alikes avoided, honest strength
const seen = new Set();
for (let i = 0; i < 300; i++) {
  const { value, bits } = A.generatePassword({ length: 16, upper: true, lower: true, digits: true, symbols: true, avoidSimilar: true });
  assert.strictEqual(value.length, 16);
  assert(/[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value), `every set present: ${value}`);
  assert(!/[Il1O0o|]/.test(value), `no look-alikes: ${value}`);
  assert(bits > 90);
  seen.add(value);
}
assert.strictEqual(seen.size, 300, 'no repeats');
assert(/^\d{12}$/.test(A.generatePassword({ length: 12, upper: false, lower: false, digits: true, symbols: false }).value));
assert.strictEqual(A.generatePassword({ length: 3 }).value.length, 8, 'never shorter than 8');
assert.strictEqual(A.generatePassword({ length: 500 }).value.length, 64, 'never longer than 64');
// Uniform: 60,000 draws from 0-9 should land within a few percent of 6,000 each (no modulo bias)
const counts = Array(10).fill(0);
for (let i = 0; i < 60000; i++) counts[A.randomInt(10)] += 1;
assert(counts.every((c) => c > 5600 && c < 6400), `uniform: ${counts}`);
const ph = A.generatePassphrase({ words: 5, separator: '-', capitalise: true, number: true });
const words = ph.value.split('-');
assert(words.length === 5 && words.every((w) => /^[A-Z][a-z]+\d?$/.test(w)) && (ph.value.match(/\d/g) || []).length === 1, `5 capitalised words, one digit: ${ph.value}`);
assert(ph.bits >= 45, 'about 9 bits a word');
assert.strictEqual(new Set(A.WORDS).size, A.WORDS.length, 'no duplicate words');
assert(A.WORDS.length >= 512);
assert.strictEqual(A.strength(40), 'Weak');
assert.strictEqual(A.strength(110), 'Very strong');
console.log('7. passwords: crypto random (unbiased), every chosen character set present, no look-alikes, 8-64 long; passphrases from 512+ words ✓');

// 8. Currency: rates per 1 USD, typed text checked first, conversions through USD
assert.deepStrictEqual(A.cleanRates({ ZWG: '26.85', ZAR: 18.2 }), { ZWG: 26.85, ZAR: 18.2 });
for (const bad of [{ ZWG: '1,000' }, { ZWG: '-2' }, { ZWG: '0' }, { ZWG: '1e3' }, { NOPE: 2 }, { USD: 1 }, null, [1]]) assert.throws(() => A.cleanRates(bad), JSON.stringify(bad));
const rates = { ZWG: 26.85, ZAR: 18.2 };
assert.strictEqual(A.convert(100, 'USD', 'ZWG', rates), 2685);
assert(Math.abs(A.convert(1820, 'ZAR', 'USD', rates) - 100) < 1e-9);
assert(Math.abs(A.convert(2685, 'ZWG', 'ZAR', rates) - 1820) < 1e-9, 'ZiG to rand via USD');
assert.strictEqual(A.convert(5, 'USD', 'GBP', rates), null, 'no rate set: no answer, not a made-up one');
console.log('8. currency: rates checked as text, conversions go through USD, a missing rate gives no answer ✓');

// 9. World clock and the notes merge
const at = new Date('2026-11-05T06:30:00Z');
assert.deepStrictEqual([A.clockAt(at, 'Africa/Harare').time, A.clockAt(at, 'Africa/Harare').offset], ['08:30', 120]);
assert.strictEqual(A.clockAt(at, 'Asia/Kuala_Lumpur').time, '14:30');
assert.strictEqual(A.clockAt(at, 'Europe/London').offset, 0, 'London in November: GMT');
assert.strictEqual(A.clockAt(new Date('2026-07-05T06:30:00Z'), 'Europe/London').offset, 60, 'and BST in summer');
assert.strictEqual(A.officeState(A.clockAt(at, 'Africa/Harare')), 'open');
assert.strictEqual(A.officeState({ hour: 7.5, weekday: 'Thu' }), 'edge');
assert.strictEqual(A.officeState({ hour: 10, weekday: 'Sat' }), 'closed');
assert.deepStrictEqual(A.mergeNotes([{ text: 'laptop' }], [{ text: 'laptop' }, { text: 'phone' }, { text: '  ' }]).map((p) => p.text), ['laptop', 'phone'], 'merge keeps both, once');
const full = A.mergeNotes(Array.from({ length: 9 }, (_, i) => ({ text: `p${i}` })), [{ text: 'extra' }]);
assert(full.length === 9 && /extra/.test(full[8].text), 'over 9 pages: joined onto the last');
console.log('9. world clock: real offsets (incl. daylight saving), office-hours lights; notes merge never drops a page ✓');

// 10. The new accessories: no eval or inline handlers either, user text escaped
for (const f of ['passgen.js', 'worldclock.js', 'fx.js', 'dates.js']) {
  const src = fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
  assert(!/\beval\s*\(|new Function|\son[a-z]+\s*=\s*["'`]/.test(src), `${f}: no eval or inline handlers`);
}
const dateLines = fs.readFileSync(path.join(__dirname, '../public/dates.js'), 'utf8').split('\n').filter((l) => /<[a-z]/.test(l));
for (const field of ['title', 'note', 'ref', 'why', 'key', 'id']) {
  const raw = dateLines.find((l) => new RegExp(`\\$\\{(r|s)\\.${field}\\}`).test(l));
  assert(!raw, `dates.js puts .${field} into HTML without esc(): ${raw}`);
}
assert(dateLines.some((l) => /esc\(r\.title\)/.test(l)), 'the check is looking at the real template');
const passgen = fs.readFileSync(path.join(__dirname, '../public/passgen.js'), 'utf8');
assert(!/localStorage|fetch\(|sendBeacon/.test(passgen) && !/save\([^)]*current/.test(passgen), 'generated passwords are never stored or sent');
console.log('10. passwords, clock, currency and dates: no eval/inline handlers, reminder text escaped, passwords never saved or sent ✓');

// 11. Saved notes in the notepad: titles and previews escaped; a page keeps its saved-note link through a merge
const noteLines = fs.readFileSync(path.join(__dirname, '../public/notes.js'), 'utf8').split('\n').filter((l) => /<[a-z]/.test(l));
for (const field of ['title', 'preview', 'id']) {
  const raw = noteLines.find((l) => new RegExp(`\$\{n\.${field}\}`).test(l));
  assert(!raw, `notes.js puts n.${field} into HTML without esc(): ${raw}`);
}
assert(noteLines.some((l) => /esc\(n\.title\)/.test(l)), 'the check is looking at the real template');
const linked = A.mergeNotes([{ text: 'a', savedId: 'x1', savedAt: 9 }], [{ text: 'b', savedId: 'x2', savedAt: 3 }]);
assert(linked[0].savedId === 'x1' && linked[1].savedId === 'x2' && linked[1].savedAt === 3);
const fxSrc = fs.readFileSync(path.join(__dirname, '../public/fx.js'), 'utf8');
assert(!/\beval\s*\(|new Function|\son[a-z]+\s*=\s*["'`]/.test(fxSrc) && /rel="noopener noreferrer"/.test(fxSrc), 'source links open safely');
console.log('11. notepad: saved-note titles and previews escaped; pages keep their saved-note link through a merge ✓');
