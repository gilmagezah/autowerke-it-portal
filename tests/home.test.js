// Homepage ("the paper trail"): the page still carries everything app.js and home.js need,
// keeps the CSP rules, gives every service its example paperwork, marks sample figures as
// examples, and speaks as a team ("we"), never as one person. Static checks, no server. `npm test`.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pub = (f) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const html = pub('index.html');
const css = pub('home.css');
const appJs = pub('app.js');
const homeJs = pub('home.js');

// 1. Every element the request form's script looks up is still on the page, exactly once
const ids = new Set([...appJs.matchAll(/(?:el|getElementById)\('([A-Za-z]+)'\)/g)].map((m) => m[1]));
assert(ids.size > 20, 'found the ids app.js uses');
for (const id of [...ids, 'trail', 'choiceGroup', 'ctaStart']) {
  const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
  assert.strictEqual(count, 1, `#${id} should appear once (found ${count})`);
}
console.log(`1. all ${ids.size} elements app.js needs are on the page, once each ✓`);

// 2. The four services are real buttons and the first thing after the heading: before the form and the example paperwork
const services = [...html.matchAll(/class="choice service" data-value="([^"]+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(services, ['IT Support', 'IT Project', 'Domains', 'Consultancy']);
assert(html.indexOf('id="choiceGroup"') < html.indexOf('id="intakeForm"'), 'services come before the form');
assert(html.indexOf('<h1 id="askTitle">') < html.indexOf('id="choiceGroup"'), 'the heading asks the question the services answer');
assert(!/<(section|div|figure)[^>]*>/.test(html.slice(html.indexOf('</header>') + 9, html.indexOf('id="choiceGroup"')).replace(/<div class="trail"[^>]*>|<section class="trail-step step-ask"[^>]*>/g, '')), 'nothing sits between the heading and the services');
assert(html.indexOf('id="choiceGroup"') < html.indexOf('class="trail-step step-example step-price"'), 'services come before the example paperwork');
console.log('2. four service buttons straight under the heading, ahead of the form and the paperwork ✓');

// 3. Each service has its own example paperwork, shown by a matching CSS rule, and labelled as an example
for (const s of services) {
  assert(html.includes(`class="est" data-for="${s}"`), `example paperwork for ${s}`);
  assert(css.includes(`.trail[data-service="${s}"] .est[data-for="${s}"]`), `CSS shows the ${s} example`);
}
const sheets = html.split('class="sheet sheet-doc').slice(1);
assert(sheets.length === 3, 'three example sheets');
for (const est of html.split('class="est"').slice(1)) assert(/<span>Example<\/span>/.test(est.slice(0, 300)), 'every estimate variant says Example');
assert((html.match(/<span>Example<\/span>/g) || []).length >= 6, 'sign-off and invoice sheets say Example too');
assert(/trail\.dataset\.service = btn\.dataset\.value/.test(homeJs), 'home.js switches the example on click');
console.log('3. every service has its own example paperwork, each labelled "Example" ✓');

// 4. CSP: no inline scripts, handlers or styles; scripts load from files
assert(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), 'no inline <script> blocks');
assert(!/\son[a-z]+\s*=\s*["']/i.test(html), 'no inline event handlers');
assert(!/\sstyle\s*=\s*["']/i.test(html), 'no inline styles');
assert(html.indexOf('/app.js') < html.indexOf('/home.js'), 'app.js loads before home.js');
console.log('4. CSP-safe: no inline scripts, handlers or styles ✓');

// 5. The site speaks for a team of two: no first-person singular in our own copy.
//    The form labels and FAQ questions are the visitor talking ("How do I pay?"), so skip those.
const text = html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<form[\s\S]*?<\/form>/g, '')
  .replace(/<summary>[\s\S]*?<\/summary>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/AutoWerke \| IT/g, '');
const firstPerson = text.match(/\b(I'm|I've|I'll|I'd|my team|myself)\b|\bI\b/);
assert(!firstPerson, `no "I" voice in our copy (found "${firstPerson && firstPerson[0]}")`);
assert(/\bWe\b/.test(text) && /small team/.test(text), 'speaks as "we", a small team');
assert(!/one-person|sole trader|freelancer/i.test(text), 'never presents as one person');
console.log('5. copy speaks as "we", never "I" ✓');

// 6. Wide-screen layout and motion rules hold
assert(/overflow-x:\s*clip/.test(css), 'the bleeding sheet is clipped, so no sideways scroll');
assert(/@media \(prefers-reduced-motion: reduce\)/.test(css), 'reduced-motion fallback');
assert(!/transition:\s*all/.test(css), 'no "transition: all"');
assert(!/section-kicker/.test(html), 'no eyebrow labels above headings');
console.log('6. no sideways scroll, reduced-motion fallback, no eyebrows ✓');

// 7. v2.3 extras survive: dark mode covers the trail, the light/dark switch, the animated wordmark
//    and the trademark notice are still on the page
const dark = pub('home-dark.css');
for (const sel of ['.step-example::before', '.doc-stamp', '.cert-code', '.price-row dd', '.service.selected .service-name']) {
  assert(dark.includes(sel), `dark mode styles ${sel}`);
}
assert(html.includes('id="themeToggle"') && html.includes('/theme-mode.js') && html.includes('/home-dark.css'), 'light/dark switch wired');
assert(html.indexOf('/theme-mode.js') < html.indexOf('</head>'), 'theme script runs before paint');
assert(html.includes('/logo-anim.js') && html.includes('data-logo'), 'animated wordmark and dark logo swap kept');
assert(/class="tm-note"/.test(html) && /not affiliated with, or endorsed by, Microsoft/.test(html), 'trademark notice kept');
assert(/US\$50–\$75/.test(html) && /excl\. VAT/.test(html), 'prices in US dollars, excluding VAT');
console.log('7. dark mode covers the trail; switch, wordmark, trademark notice and US$ pricing kept ✓');

// 8. The original form-first homepage is kept at /classic, with its own styles, and each page links to the other.
//    Certifications are shown as codes only; the full title stays available on hover and to screen readers.
const classic = pub('classic.html');
const server = fs.readFileSync(path.join(__dirname, '../lib/publicRoutes.js'), 'utf8');
assert(/router\.get\('\/classic'/.test(server), 'server answers /classic');
assert(classic.includes('/classic.css') && classic.includes('/classic-dark.css') && classic.includes('/classic.js'), 'classic page has its own styles and script');
assert(!/href="\/home(-dark)?\.css/.test(classic), 'classic page is untouched by the new homepage styles');
assert(classic.includes('/app.js') && classic.includes('id="intakeForm"'), 'classic page still takes requests');
assert(html.includes('href="/classic"') && classic.includes('<a href="/" class="view-switch">'), 'each page links to the other');
assert(!/<script>|\son[a-z]+="/i.test(classic), 'classic page stays CSP-safe');
const certs = [...html.matchAll(/<abbr class="cert-code" title="([^"]+)">([A-Z]{2}-\d{3})<\/abbr>/g)].map((m) => m[2]);
assert.deepStrictEqual(certs, ['SC-300', 'AZ-500', 'MS-900'], 'certifications listed as codes');
assert(html.includes('title="Azure Security Engineer Associate">AZ-500'), 'AZ-500 keeps its confirmed full title');
assert(/<h3>A small team with Microsoft certifications, including<\/h3>/.test(html), 'the certifications block names the team and lists example codes');
assert(!/hero-cred/.test(html + css), 'no certification line in the hero');
console.log('8. classic page kept at /classic with a two-way switch; certifications shown as codes ✓');

// 9. Gil's picks: Barlow (the wordmark's family) replaces the typewriter face on this page, and the
//    chosen service is lifted on its own surface, never outlined with a green line (stageshow's rule)
assert(/--mono:\s*'Barlow'/.test(css), 'the homepage sets its type in Barlow');
assert(/family=Barlow:wght@[^"]*600/.test(html) && !/Courier\+Prime/.test(html), 'Barlow weights loaded; the typewriter font is no longer fetched here');
const selRules = [...(css + dark).matchAll(/\.home \.service\.selected\s*\{([^}]*)\}/g)]   // homepage rules (they win over client.css).map((m) => m[1]).join(' ');
assert(/background:\s*var\(--green-soft\)/.test(selRules), 'the chosen service takes the green-soft surface');
assert(!/inset 0 0 0 1px var\(--green|inset 0 3px 0/.test(selRules), 'no green ring or line on the chosen service');
assert(/\.service:active\s*\{\s*transform:\s*scale\(0\.97\)/.test(css), 'services press to 0.97');
assert(/text-box:\s*trim-both cap alphabetic/.test(css), 'service names centre on their capitals');
assert(/\.service:hover\s*\{\s*background:\s*var\(--green\)/.test(css) && /\.service:hover \.service-name\s*\{\s*color:\s*var\(--on-green\)/.test(css), 'services turn racing green on hover, with light text');
assert(/\.service:hover\s*\{\s*background:\s*var\(--green\)/.test(dark), 'and in dark mode');
assert(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.theme\.client\.home \.service:hover/.test(css), 'hover only on real pointers, so taps never stick green');
console.log('9. Barlow type; chosen service lifted, not outlined; racing green on hover; stageshow press and label rules ✓');

// 10. Top bar, smooth scroll and closing the form
assert(/\.home-top \{[^}]*flex-wrap: wrap/.test(css), 'the top bar wraps the menu under the logo when both do not fit');
assert(/\.brand-logo\.anim-ready \{ width: auto; max-width: none; \}/.test(css), 'the animated wordmark takes its real width');
assert(/@media \(prefers-reduced-motion: no-preference\) \{\s*html:has\(> body\.home\) \{ scroll-behavior: smooth; \}/.test(css), 'top-bar links glide, unless reduced motion is on');
assert(/scroll-margin-top/.test(css), 'sections stop short of the top edge');
assert(/function closeForm\(\)/.test(appJs) && /btn\.classList\.contains\('selected'\) && !form\.classList\.contains\('hidden'\)/.test(appJs), 'clicking the chosen service again closes the form');
assert(/aria-expanded/.test(appJs), 'the buttons tell screen readers whether the form is open');
assert(/\.intake-form\.closing \{ animation: home-rollup 180ms/.test(css), 'the form rolls up faster than it unrolls');
console.log('10. top bar wraps instead of overlapping; smooth section links; click again to close the form ✓');
