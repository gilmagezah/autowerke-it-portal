// Accessories: the logic worth testing on its own (pins, Quick find ranking, where a request
// lives, and turning timed work into a work-log entry). Loaded by the browser AND by Node
// (tests/accessories.test.js), so what's tested is what runs.
(function (root) {
  const MAX_PINS = 4;

  // Pin or unpin an accessory. Unknown ids are dropped; a fifth pin is refused, not swapped in.
  function togglePin(pins, id, known) {
    const clean = (Array.isArray(pins) ? pins : []).filter((p, i, a) => known.includes(p) && a.indexOf(p) === i);
    if (clean.includes(id)) return { pins: clean.filter((p) => p !== id), ok: true };
    if (!known.includes(id)) return { pins: clean, ok: false };
    if (clean.length >= MAX_PINS) return { pins: clean, ok: false, full: true };
    return { pins: [...clean, id], ok: true };
  }

  // ---------- Quick find ----------
  // Matching happens here in the browser over a list the server sends: never a pattern match
  // in a database query (DEVELOPMENT.md: "%" would match everything).
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const digitsOf = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

  function search(rows, query, limit = 8) {
    // A query that's just a phone number ("077 123 4567", "+263 77…") matches on digits only
    const asPhone = /^[\d\s+().-]+$/.test(String(query || '').trim()) ? digitsOf(query) : '';
    if (asPhone.length >= 4) {
      return (rows || []).filter((r) => digitsOf(r.phone).includes(asPhone) || norm(r.ref).includes(String(query).trim()))
        .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))).slice(0, limit);
    }
    const words = norm(query).trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (!words.length) return [];
    const scored = [];
    for (const r of rows || []) {
      const f = {
        ref: norm(r.ref), company: norm(r.company), contact: norm(r.contact),
        email: norm(r.email), title: norm(r.title), type: norm(r.type), phone: digitsOf(r.phone),
      };
      const hay = [f.ref, f.company, f.contact, f.email, f.title, f.type].join(' ');
      let score = 0;
      let ok = true;
      for (const w of words) {
        const d = digitsOf(w);
        const phoneHit = d.length >= 4 && f.phone.includes(d);
        if (!hay.includes(w) && !phoneHit) { ok = false; break; }
        if (f.ref === w) score += 100; else if (f.ref.startsWith(w)) score += 50;
        if (f.company.startsWith(w)) score += 20; else if (f.company.includes(w)) score += 8;
        if (f.contact.split(/\s+/).some((p) => p.startsWith(w))) score += 15;
        if (f.email.startsWith(w)) score += 12;
        if (phoneHit) score += 10;
      }
      if (ok) scored.push({ r, score });
    }
    scored.sort((a, b) => b.score - a.score || String(b.r.updated || '').localeCompare(String(a.r.updated || '')));
    return scored.slice(0, limit).map((s) => s.r);
  }

  // Which admin page lists a request (Quick find opens it with #find=REF)
  function destination(row) {
    if (row.type === 'Domains') return '/admin/domains';
    if (row.type === 'Consultancy') return '/admin/consultancy';
    if (row.type === 'IT Project' && ['signed', 'delivered', 'closed'].includes(row.status)) return '/admin/projects';
    return '/admin';
  }

  // ---------- Support timer ----------
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  // Date and HH:MM in the business timezone (the server runs on UTC; Harare doesn't)
  function localParts(date, timeZone) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }

  // Timed work -> the same { date, start, end } entry the "Log hours" form sends. It ends now and
  // starts the timed minutes earlier, so pauses don't count.
  function logEntry(elapsedMs, now, timeZone = 'Africa/Harare') {
    const minutes = Math.round(elapsedMs / 60000);
    if (!(minutes >= 1)) return { error: 'Time at least a minute before logging it.' };
    if (minutes > 16 * 60) return { error: 'That is over 16 hours. Check the timer, or log it by hand on the ticket.' };
    const end = localParts(now, timeZone);
    const start = localParts(new Date(now.getTime() - minutes * 60000), timeZone);
    if (start.date !== end.date) return { error: 'This time crosses midnight. Log it in two parts on the ticket.' };
    return { date: end.date, start: start.time, end: end.time, minutes };
  }

  // ---------- Dates ('YYYY-MM-DD' strings; calendar maths in UTC so nothing drifts) ----------
  const pad = (n) => String(n).padStart(2, '0');
  function toD(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
  }
  const isDate = (s) => !!toD(s);
  const fromD = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return fromD(d); };
  const weekday = (s) => toD(s).getUTCDay(); // 0 Sunday ... 6 Saturday
  const daysBetween = (a, b) => Math.round((toD(b) - toD(a)) / 86400000);
  function addMonths(s, n) {
    const d = toD(s);
    const y = d.getUTCFullYear(); const m = d.getUTCMonth() + n; const day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // 31 Jan + 1 month = 28/29 Feb
    return fromD(new Date(Date.UTC(y, m, Math.min(day, last))));
  }

  // Easter Sunday (Anonymous Gregorian algorithm)
  function easter(y) {
    const a = y % 19; const b = Math.floor(y / 100); const c = y % 100;
    const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31); const day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${y}-${pad(month)}-${pad(day)}`;
  }

  // Zimbabwe's public holidays (Public Holidays and Prohibition of Business Act). A holiday on a
  // Sunday moves to the next day that isn't already a holiday. One-off holidays the government
  // gazettes (e.g. election days) aren't knowable in advance, so check the gazette for those.
  const holidayCache = {};
  function zimHolidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    const list = [
      [`${y}-01-01`, "New Year's Day"], [`${y}-02-21`, 'Robert Gabriel Mugabe National Youth Day'],
      [addDays(easter(y), -2), 'Good Friday'], [addDays(easter(y), -1), 'Easter Saturday'], [addDays(easter(y), 1), 'Easter Monday'],
      [`${y}-04-18`, 'Independence Day'], [`${y}-05-01`, "Workers' Day"], [`${y}-05-25`, 'Africa Day'],
    ];
    let aug = `${y}-08-01`;
    while (weekday(aug) !== 1) aug = addDays(aug, 1);
    const heroes = addDays(aug, 7); // second Monday of August
    list.push([heroes, "Heroes' Day"], [addDays(heroes, 1), 'Defence Forces Day']);
    list.push([`${y}-12-22`, 'National Unity Day'], [`${y}-12-25`, 'Christmas Day'], [`${y}-12-26`, 'Boxing Day']);
    const taken = new Set(list.map(([d]) => d));
    for (const [d, name] of list.slice()) {
      if (weekday(d) !== 0) continue;
      let o = addDays(d, 1);
      while (taken.has(o) || weekday(o) === 0) o = addDays(o, 1);
      taken.add(o);
      list.push([o, `${name} (observed)`]);
    }
    holidayCache[y] = list.map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
    return holidayCache[y];
  }
  const holidayName = (s) => { const h = zimHolidays(+String(s).slice(0, 4)).find((x) => x.date === s); return h ? h.name : null; };
  const isWorkingDay = (s) => { const w = weekday(s); return w !== 0 && w !== 6 && !holidayName(s); };
  function addWorkingDays(s, n) {
    let d = s; let left = Math.abs(Math.trunc(n)); const step = n < 0 ? -1 : 1;
    while (left > 0) { d = addDays(d, step); if (isWorkingDay(d)) left -= 1; }
    return d;
  }
  // Working days after `a`, up to and including `b` (negative if b is earlier)
  function workingDaysBetween(a, b) {
    const sign = b < a ? -1 : 1; const [from, to] = sign > 0 ? [a, b] : [b, a];
    let n = 0;
    for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isWorkingDay(d)) n += 1;
    return n * sign;
  }
  const nextWorkingDay = (s) => addWorkingDays(s, 1);
  function upcomingHolidays(from, count = 3) {
    const y = +from.slice(0, 4);
    return [...zimHolidays(y), ...zimHolidays(y + 1)].filter((h) => h.date >= from).slice(0, count);
  }

  // ---------- Password generator ----------
  // Uniform random integers from the platform's CSPRNG, with rejection sampling so no
  // character is more likely than another (a plain "% n" would be slightly biased).
  function randomInt(n, rng) {
    const getU32 = rng || (() => { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0]; });
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do { x = getU32(); } while (x >= limit);
    return x % n;
  }
  const SIMILAR = /[Il1O0o|]/g;
  const CHARSETS = { upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz', digits: '0123456789', symbols: '!@#$%^&*-_=+?' };
  function generatePassword(opts = {}, rng) {
    const length = Math.min(64, Math.max(8, Math.trunc(Number(opts.length) || 16)));
    const sets = Object.keys(CHARSETS).filter((k) => opts[k] !== false)
      .map((k) => (opts.avoidSimilar === false ? CHARSETS[k] : CHARSETS[k].replace(SIMILAR, '')));
    if (!sets.length) sets.push(CHARSETS.lower);
    const pool = sets.join('');
    const chars = sets.map((s) => s[randomInt(s.length, rng)]); // at least one from each chosen set
    while (chars.length < length) chars.push(pool[randomInt(pool.length, rng)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1, rng); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return { value: chars.join(''), bits: Math.round(length * Math.log2(pool.length)) };
  }
  // About 500 common, easy-to-type words: each one adds about 9 bits
  const WORDS = ('acid acorn actor adapt agent alarm album alert alien alley alpha amber ample angle ankle apple apron arena armor arrow aside asset atlas attic audio avoid awake badge bagel baker bamboo banjo barn basil basin batch beach beacon beard bench berry bison blade blank blaze blend bliss block bloom board boast bonus boost booth bored bottle brain brave bread brick bride brief brook brush bucket buddy budget buffet bugle bunch bunny cabin cable cactus camel camera candle canoe canvas canyon cargo carpet carrot cedar chain chalk charm chart cheese cherry chess chief chili chimney choir chorus cider cinema circle citrus civic clamp clay cliff climb cloak clock cloud clover coach coast cobalt cocoa coffee comet comic coral corner cotton couch cousin cradle crane crater crayon cream crest cricket crisp crown crumb crystal cube cupid curry cycle daisy dance delta denim depot desert dial diary diner disco dock dolphin donut dragon drama dream drift drum dune eagle easel echo eclipse elbow elder ember emerald engine enjoy equal error essay ethics event fable fabric falcon fancy farm feast fence ferry fiber field fiesta finch fjord flag flame flash fleet flock flora flute focus forest forge fossil fox frame fresh frost fruit fudge galaxy garden garlic gecko gentle giant ginger glacier glass globe glove glow goat gold gorilla grain grape gravel gravy green grill grove guard guitar habit hammer harbor harp hazel heart hedge helmet herb hero hiking hobby honey hotel humble hummus husky igloo index indigo inlet iris island ivory jacket jaguar jasmine jelly jewel jigsaw jockey jolly journal judge juice jumbo jungle kayak kernel kettle kidney kitten kiwi knight koala label ladder lagoon lake lamp lantern laptop laser lava lawn layer lemon lever lilac lime linen lion lizard llama lobby lobster locket lotus lucky lunar lunch lyric magnet mango maple marble market meadow medal melon memo mentor merit metal meteor method mint mirror mocha model monk moose mosaic motel motor mural museum music nacho napkin nectar needle nest noble noodle north novel nugget oasis ocean olive omega onion opera orange orbit orchid otter oven owl oxygen paddle palace panda panel parade parcel parrot pasta pastel patio peach peanut pearl pebble pecan pencil pepper piano pickle pilot pine pirate pixel pizza planet plaza plum poem polar pond poppy potato prism pulse puma puzzle quail quartz quest quiet quilt quiz rabbit radar radio raft rain ranch raven razor recipe reef relay remedy rhino ribbon rice ridge river robin rocket rodeo rose ruby rugby saddle safari salad salmon salsa sandal satin sauce scarf school scout sensor shadow shark shelf shell shield silk silver sketch skiing sloth smile snack solar sonic spark spice spider spinach spoon spring squid stable stamp star statue steam stone storm studio sugar summit sunny sushi swamp swan sweater syrup table tablet taco talent tango teapot temple tennis tiger timber toast tomato topaz torch tower tractor trail train trophy tulip tundra turtle tuxedo umbrella unicorn union unity urban valley vanilla velvet venus violet violin visor vivid volcano voyage wafer wagon walnut walrus water whale wheat whisk willow window winter wizard yacht yogurt zebra zenith zesty zipper zone zoom bloom').split(' ').filter((w, i, a) => a.indexOf(w) === i);
  function generatePassphrase(opts = {}, rng) {
    const n = Math.min(8, Math.max(3, Math.trunc(Number(opts.words) || 5)));
    const sep = ['-', '.', ' ', '_'].includes(opts.separator) ? opts.separator : '-';
    const words = Array.from({ length: n }, () => WORDS[randomInt(WORDS.length, rng)]);
    if (opts.capitalise !== false) words.forEach((w, i) => { words[i] = w[0].toUpperCase() + w.slice(1); });
    let bits = n * Math.log2(WORDS.length);
    if (opts.number !== false) { words[randomInt(n, rng)] += String(randomInt(10, rng)); bits += Math.log2(10 * n); }
    return { value: words.join(sep), bits: Math.round(bits) };
  }
  const strength = (bits) => (bits >= 100 ? 'Very strong' : bits >= 70 ? 'Strong' : bits >= 50 ? 'Fair' : 'Weak');

  // ---------- Currency converter (rates are "per 1 USD", typed in by an admin) ----------
  const CURRENCIES = [
    ['USD', 'US dollar'], ['ZWG', 'Zimbabwe Gold (ZiG)'], ['ZAR', 'South African rand'], ['BWP', 'Botswana pula'],
    ['ZMW', 'Zambian kwacha'], ['MZN', 'Mozambican metical'], ['GBP', 'British pound'], ['EUR', 'Euro'],
    ['AED', 'UAE dirham'], ['MYR', 'Malaysian ringgit'], ['SGD', 'Singapore dollar'], ['EGP', 'Egyptian pound'], ['MUR', 'Mauritian rupee'],
  ];
  const CODES = CURRENCIES.map((c) => c[0]);
  // Keep only known codes with sensible positive numbers; USD is always 1. Rejects strings like
  // "" (Number('') is 0, DEVELOPMENT.md #7), "1e400" and arrays.
  function cleanRates(input) {
    const out = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Send the rates as a list of currencies.");
    const unknown = Object.keys(input).find((k) => !CODES.slice(1).includes(k));
    if (unknown) throw new Error(`${String(unknown).slice(0, 12)} isn't a currency this converter knows (USD is always 1).`);
    for (const code of CODES.slice(1)) {
      const raw = input && input[code];
      if (raw === undefined || raw === null || raw === '') continue;
      if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d{1,9}(\.\d{1,8})?$/.test(raw.trim()))) throw new Error(`${code}: enter a number like 26.85.`);
      const n = Number(raw);
      if (!(n > 0 && n < 1e8)) throw new Error(`${code}: the rate must be more than 0.`);
      out[code] = Number(n.toPrecision(8));
    }
    return out;
  }
  function convert(amount, from, to, rates) {
    const r = { ...(rates || {}), USD: 1 };
    const a = Number(amount);
    if (!Number.isFinite(a) || !r[from] || !r[to]) return null;
    return (a / r[from]) * r[to];
  }

  // ---------- World clock ----------
  const CITIES = [
    ['Harare', 'Africa/Harare'], ['Johannesburg', 'Africa/Johannesburg'], ['Gaborone', 'Africa/Gaborone'], ['Lusaka', 'Africa/Lusaka'],
    ['Maputo', 'Africa/Maputo'], ['Nairobi', 'Africa/Nairobi'], ['Lagos', 'Africa/Lagos'], ['Cairo', 'Africa/Cairo'],
    ['Port Louis', 'Indian/Mauritius'], ['Dubai', 'Asia/Dubai'], ['London', 'Europe/London'], ['Dublin', 'Europe/Dublin'],
    ['Amsterdam', 'Europe/Amsterdam'], ['Berlin', 'Europe/Berlin'], ['Lisbon', 'Europe/Lisbon'], ['New York', 'America/New_York'],
    ['Toronto', 'America/Toronto'], ['Los Angeles', 'America/Los_Angeles'], ['Mumbai', 'Asia/Kolkata'], ['Kuala Lumpur', 'Asia/Kuala_Lumpur'],
    ['Singapore', 'Asia/Singapore'], ['Shanghai', 'Asia/Shanghai'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney'], ['Auckland', 'Pacific/Auckland'],
  ];
  // Wall-clock time somewhere, plus its offset from UTC in minutes
  function clockAt(date, timeZone) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
    const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
    const hh = Number(p.hour); const mm = Number(p.minute);
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, hh, mm);
    const offset = Math.round((local - Math.floor(date.getTime() / 60000) * 60000) / 60000);
    return { time: `${pad(hh)}:${pad(mm)}`, date: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday, hour: hh + mm / 60, offset };
  }
  // Office hours light: open 08-17 Mon-Fri, "edge" an hour either side, otherwise closed
  function officeState({ hour, weekday: wd }) {
    if (wd === 'Sat' || wd === 'Sun') return 'closed';
    if (hour >= 8 && hour < 17) return 'open';
    if (hour >= 7 && hour < 18) return 'edge';
    return 'closed';
  }

  // Notes edited on two devices: keep every page from the server, then add this device's pages
  // that the server doesn't already have, so nothing typed is lost. Extra pages past the
  // limit are joined onto the last page.
  function mergeNotes(server, local, { maxPages = 9, maxChars = 20000 } = {}) {
    const keep = (p, at) => ({ ...(p.savedId ? { savedId: p.savedId, savedAt: p.savedAt } : {}), text: p.text, at });
    const out = (server || []).filter((p) => p && typeof p.text === "string").map((p) => keep(p, Number(p.at) || 0));
    const have = new Set(out.map((p) => p.text.trim()));
    const extra = (local || []).filter((p) => p && typeof p.text === "string" && p.text.trim() && !have.has(p.text.trim()));
    extra.forEach((p) => {
      if (out.length < maxPages) out.push(keep(p, Number(p.at) || Date.now()));
      else { const last = out[out.length - 1]; last.text = `${last.text}

--- from another device ---
${p.text}`.slice(0, maxChars); }
    });
    if (!out.length) out.push({ text: "", at: Date.now() });
    return out.slice(0, maxPages);
  }

  const api = {
    MAX_PINS, togglePin, search, destination, clock, localParts, logEntry,
    isDate, addDays, addMonths, weekday, daysBetween, easter, zimHolidays, holidayName, isWorkingDay,
    addWorkingDays, workingDaysBetween, nextWorkingDay, upcomingHolidays,
    randomInt, generatePassword, generatePassphrase, strength, WORDS,
    CURRENCIES, CODES, cleanRates, convert, CITIES, clockAt, officeState, mergeNotes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AccCore = api;
})(typeof window !== 'undefined' ? window : this);
