// Pipeline category tiles (public/pipeline-summary.js): counts, "new since you last looked",
// whose move it is, the newest item; plus the page wiring (every tile has its panel, user text
// escaped, no inline handlers). Runs in Node exactly as the browser runs it. `npm test`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../public/pipeline-summary.js');

const NOW = Date.parse('2026-11-07T12:00:00Z');
const H = 3600 * 1000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const byKey = (tiles) => Object.fromEntries(tiles.map((t) => [t.key, t]));

// 1. Six categories, in order, all clear when there's nothing
const empty = P.summarize({}, {}, NOW);
assert.deepStrictEqual(empty.map((t) => t.key), ['reviews', 'changes', 'pricing', 'estimate', 'progress', 'signoff']);
assert(empty.every((t) => t.count === 0 && t.state === 'clear' && t.pill === 'All clear' && t.latestLine === '' && t.newIds.length === 0));
assert.deepStrictEqual(P.summarize(null, undefined, NOW).map((t) => t.count), [0, 0, 0, 0, 0, 0], 'missing data never throws');
console.log('1. six categories in order; all clear when empty, even with no data at all ✓');

// 2. "New" means arrived since that category was last opened; otherwise it says whose move it is
const lists = {
  pending: [
    { id: 'a', company_name: 'Old Co', created_at: iso(5 * 24 * H) },
    { id: 'b', company_name: 'Fresh Co', created_at: iso(2 * H) },
  ],
  changesRequested: [{ id: 'c', company_name: 'Change Co', created_at: iso(30 * 24 * H), updated_at: iso(3 * 24 * H) }],
  inProgress: [{ id: 'd', company_name: 'Busy Co', created_at: iso(20 * 24 * H), estimate_signed_at: iso(10 * 24 * H), updated_at: iso(1 * H) }],
  awaitingSupportSignoff: [{ id: 'e', company_name: 'Signing Co', updated_at: iso(1 * H), signoff_sent_at: iso(3 * 24 * H) }],
};
let t = byKey(P.summarize(lists, { reviews: NOW - 24 * H, changes: NOW - H, progress: NOW - H, signoff: NOW - H }, NOW));
assert.strictEqual(t.reviews.count, 2);
assert(t.reviews.state === 'new' && t.reviews.pill === '1 new' && t.reviews.fresh === 1, 'one arrived since the last look');
assert.deepStrictEqual(t.reviews.newIds, ['b'], 'only that one gets the "New" tag');
assert.strictEqual(t.reviews.latestLine, 'Fresh Co · 2 h ago', 'newest item shown');
assert(t.changes.state === 'action' && t.changes.pill === 'Needs you', 'seen already: waiting on you');
assert(t.progress.state === 'ongoing' && t.progress.pill === 'Ongoing', 'logging hours (updated_at) does not make it "new"; it entered the stage when the estimate was signed');
assert(t.signoff.state === 'waiting' && t.signoff.pill === 'Waiting on client' && t.signoff.latestLine === 'Signing Co · sent 3 days ago');
assert(t.pricing.state === 'clear' && t.estimate.state === 'clear');
console.log('2. "new" = arrived since last opened (just those tagged); otherwise needs you / ongoing / waiting on client; newest item shown ✓');

// 3. Never opened on this browser: the last 2 days count as new; opening it clears them
t = byKey(P.summarize(lists, {}, NOW));
assert(t.reviews.pill === '1 new' && t.changes.state === 'action' && t.signoff.state === 'waiting');
t = byKey(P.summarize(lists, { reviews: NOW }, NOW));
assert(t.reviews.state === 'action' && t.reviews.newIds.length === 0, 'opened just now: nothing new');
t = byKey(P.summarize({ inProgress: [{ id: 'z', company_name: 'Just Signed', estimate_signed_at: iso(5 * 60 * 1000) }] }, { progress: NOW - H }, NOW));
assert(t.progress.state === 'new' && t.progress.pill === '1 new', 'a newly approved estimate shows as new in progress');
console.log('3. a new browser treats the last 2 days as new; opening a category clears its "new" ✓');

// 4. Times read naturally; bad or missing dates don't break anything
assert.strictEqual(P.ago(NOW - 20 * 1000, NOW), 'just now');
assert.strictEqual(P.ago(NOW - 5 * 60 * 1000, NOW), '5 min ago');
assert.strictEqual(P.ago(NOW - 3 * H, NOW), '3 h ago');
assert.strictEqual(P.ago(NOW - 24 * H, NOW), '1 day ago');
assert.strictEqual(P.ago(NOW - 12 * 24 * H, NOW), '12 days ago');
assert(/2026/.test(P.ago(NOW - 90 * 24 * H, NOW)), 'older than a month: a date');
assert.strictEqual(P.ago(0, NOW), '');
t = byKey(P.summarize({ pending: [{ id: 'q', company_name: '  Spacey Ltd ', created_at: 'not a date' }] }, {}, NOW));
assert(t.reviews.count === 1 && t.reviews.latestLine === 'Spacey Ltd' && t.reviews.latestWhen === '' && t.reviews.state === 'action');
t = byKey(P.summarize({ pending: [{ id: 'r', name: 'Rudo', created_at: iso(H) }] }, {}, NOW));
assert.strictEqual(t.reviews.latestWho, 'Rudo', 'no company: the contact name');
console.log('4. times read naturally (just now … days ago … a date); bad or missing dates are handled ✓');

// 5. Page wiring: every tile has a panel, the shared file loads first, no inline handlers, user text escaped
const html = fs.readFileSync(path.join(__dirname, '../views/admin.html'), 'utf8');
for (const c of P.CATEGORIES) {
  assert(html.includes(`id="panel-${c.key}"`) && html.includes(`data-close="${c.key}"`), `panel for ${c.key}`);
}
for (const id of ['list', 'changesList', 'pricingList', 'estimateList', 'inProgressList', 'supportSignoffList', 'pipeTiles', 'pipeHint', 'statCards', 'companyTable']) {
  assert(html.includes(`id="${id}"`), `admin.js needs #${id}`);
}
assert(html.indexOf('pipeline-summary.js') < html.indexOf('/admin.js'), 'summary loads before admin.js');
assert(html.indexOf('id="pipeTiles"') < html.indexOf('>Overview<'), 'tiles sit between the band and the overview');
assert(!/<script>|\son[a-z]+\s*=\s*["']/i.test(html), 'no inline scripts or handlers (CSP)');
const admin = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
const tileTpl = admin.slice(admin.indexOf('function renderTiles'), admin.indexOf('function openCategory'));
for (const field of ['label', 'sub', 'pill', 'latestWho', 'latestWhen']) {
  assert(!new RegExp(`\\$\\{t\\.${field}\\}`).test(tileTpl), `tile puts t.${field} into HTML without escapeHtml()`);
  assert(tileTpl.includes(`escapeHtml(t.${field})`), `the check is looking at the real template (${field})`);
}
assert(/try \{ return JSON\.parse\(localStorage/.test(admin) && /try \{ localStorage\.setItem/.test(admin), 'browser storage wrapped in try/catch (private windows)');
assert(!/localStorage|fetch\(|document\./.test(fs.readFileSync(path.join(__dirname, '../public/pipeline-summary.js'), 'utf8')), 'the summary is pure logic');
console.log('5. page wiring: every tile has its panel, tiles above the overview, no inline scripts, company names escaped ✓');
