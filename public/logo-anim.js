// Animated wordmark on the homepage: "AutoWerke | IT" morphs into "WE MAKE IT HAPPEN" and back.
// Ported from the supplied AutoWerke animation (plain JS, Web Animations API, no library).
// The SVG logo stays as the fallback: it's only swapped out once Barlow has loaded and every
// letter has been measured, so a blocked font or an old browser still shows the normal logo.
// After the page loads it rotates CYCLES times (logo held HOLD_LOGO, tagline held HOLD_LINE),
// then rests on the logo. From then on, hovering "Werke" shows the tagline; it goes back to the
// logo RETURN_AFTER once the cursor leaves, and hovering won't trigger it again for COOLDOWN.
// With "reduce motion" switched on, the static logo stays.
(function () {
  const link = document.querySelector('.brand-logo');
  const img = link && link.querySelector('img');
  if (!link || !img || !('animate' in Element.prototype) || !document.fonts) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SEMI = 600, LIGHT = 300;
  // Letters with a key (k) travel into the tagline; the rest leave, and new ones arrive
  const FROM = [
    { t: 'A', w: SEMI }, { t: 'u', w: SEMI }, { t: 't', w: SEMI }, { t: 'o', w: SEMI },
    { t: 'W', w: SEMI, k: 'w' }, { t: 'e', w: SEMI, k: 'e1' }, { t: 'r', w: SEMI },
    { t: 'k', w: SEMI, k: 'k' }, { t: 'e', w: SEMI, k: 'e2' },
    { bar: true },
    { t: 'I', w: LIGHT, k: 'i' }, { t: 'T', w: LIGHT, k: 't' },
  ];
  // IT stays light, as a nod to the wordmark
  const TO = [
    { t: 'W', w: SEMI, k: 'w' }, { t: 'E', w: SEMI, k: 'e1' }, { gap: true },
    { t: 'M', w: SEMI }, { t: 'A', w: SEMI }, { t: 'K', w: SEMI, k: 'k' }, { t: 'E', w: SEMI, k: 'e2' }, { gap: true },
    { t: 'I', w: LIGHT, k: 'i' }, { t: 'T', w: LIGHT, k: 't' }, { gap: true },
    { t: 'H', w: SEMI }, { t: 'A', w: SEMI }, { t: 'P', w: SEMI }, { t: 'P', w: SEMI }, { t: 'E', w: SEMI }, { t: 'N', w: SEMI },
  ];

  const D = 1700;              // one morph, ms
  const HOLD_LOGO = 10000;     // logo on screen before each automatic morph
  const HOLD_LINE = 8000;      // tagline on screen before morphing back
  const CYCLES = 3;            // automatic rotations per page load, then it rests on the logo
  const RETURN_AFTER = 8000;   // after a hover: back to the logo this long after the cursor leaves
  const COOLDOWN = 40000;      // after a hover rotation: no new one for this long
  const SP_A = '-0.02em', SP_B = '0.02em';

  const stage = document.createElement('span');
  stage.className = 'logo-anim';
  stage.setAttribute('aria-hidden', 'true');
  link.setAttribute('aria-label', img.alt || 'AutoWerke | IT');
  link.appendChild(stage);

  let anims = [];
  let gen = 0;
  let mode = 'auto';      // 'auto' (rotating after load) | 'idle' | 'shown' (tagline up after a hover) | 'busy' (morphing)
  let cooldownUntil = 0;
  let returnTimer = null;
  let logoWidth = 0;
  let hot = null;         // invisible hover target over "Werke"

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function makeRow(tokens, spacing) {
    const row = document.createElement('span');
    row.className = 'row';
    row.style.letterSpacing = spacing;
    tokens.forEach((tok) => {
      const s = document.createElement('span');
      if (tok.bar) { s.className = 'bar'; s.style.margin = '0 0.39em'; }
      else if (tok.gap) { s.textContent = ' '; s.style.width = '0.3em'; s.style.display = 'inline-block'; }
      else { s.textContent = tok.t; s.style.fontWeight = tok.w; }
      row.appendChild(s);
      tok.el = s;
    });
    stage.appendChild(row);
    return row;
  }

  function pos(el) {
    const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  }

  function glyph(tok, p, spacing) {
    const g = document.createElement('span');
    g.className = 'glyph';
    g.textContent = tok.t;
    g.style.fontWeight = tok.w;
    g.style.letterSpacing = spacing;
    g.style.transform = `translate(${p.x}px, ${p.y}px)`;
    stage.appendChild(g);
    return g;
  }

  // Every animation spans the same total time D (delay + endDelay), so playing in reverse stays in sync
  function anim(el, frames, start, dur, easing = 'cubic-bezier(.65,0,.35,1)') {
    if (start + dur > 1.0001) console.warn('logo-anim: an animation runs past the end of the morph and will be cut off');
    const delay = start * D, duration = dur * D;
    const a = el.animate(frames, { delay, duration, endDelay: D - delay - duration, easing, fill: 'both' });
    a.pause();
    anims.push(a);
  }

  // Size the wordmark to match the SVG logo's width, shrinking only if the tagline wouldn't fit
  function fontSize() {
    stage.style.fontSize = '100px';
    const probeA = makeRow(FROM, SP_A), probeB = makeRow(TO, SP_B);
    const wA = probeA.getBoundingClientRect().width, wB = probeB.getBoundingClientRect().width;
    probeA.remove(); probeB.remove();
    const room = link.parentElement.clientWidth;
    return Math.min((logoWidth / wA) * 100, (room / wB) * 100);
  }

  function build() {
    anims.forEach((a) => a.cancel());
    anims = [];
    stage.textContent = '';
    const fs = fontSize();
    stage.style.fontSize = `${fs}px`;
    stage.style.height = `${fs}px`;
    makeRow(FROM, SP_A);
    const toRow = makeRow(TO, SP_B);
    stage.style.width = `${Math.ceil(toRow.getBoundingClientRect().width)}px`;
    const toByKey = {};
    TO.forEach((t) => { if (t.k) toByKey[t.k] = t; });

    // Hover target: the box around "Werke" in the logo
    const first = pos(FROM[4].el), last = pos(FROM[8].el);
    hot = document.createElement('span');
    hot.className = 'logo-hot';
    hot.style.left = `${first.x}px`;
    hot.style.width = `${last.x + last.w - first.x}px`;
    hot.style.height = `${fs}px`;
    stage.appendChild(hot);
    hot.addEventListener('mouseenter', onWerke);

    FROM.forEach((tok) => {
      const a = pos(tok.el);
      if (tok.bar) {
        const b = document.createElement('span');
        b.className = 'bar-anim';
        b.style.width = `${a.w}px`; b.style.height = `${a.h}px`;
        b.style.transform = `translate(${a.x}px, ${a.y}px)`;
        stage.appendChild(b);
        anim(b, [
          { transform: `translate(${a.x}px, ${a.y}px) scaleY(1)`, opacity: 1 },
          { transform: `translate(${a.x}px, ${a.y}px) scaleY(0)`, opacity: 0 },
        ], 0, 0.35);
        return;
      }
      const g = glyph(tok, a, SP_A);
      const partner = tok.k && toByKey[tok.k];
      if (!partner) {
        // Letters that leave: "Auto" and the "r"
        anim(g, [
          { transform: `translate(${a.x}px, ${a.y}px)`, opacity: 1, filter: 'blur(0px)' },
          { transform: `translate(${a.x}px, ${a.y - 0.25 * fs}px)`, opacity: 0, filter: 'blur(4px)' },
        ], 0, 0.35, 'cubic-bezier(.4,0,1,1)');
        return;
      }
      const b = pos(partner.el);
      const move = [{ transform: `translate(${a.x}px, ${a.y}px)` }, { transform: `translate(${b.x}px, ${b.y}px)` }];
      anim(g, move, 0.15, 0.6);
      if (tok.t !== partner.t) {
        // e becomes E, k becomes K: crossfade while travelling
        anim(g, [{ opacity: 1 }, { opacity: 0 }], 0.3, 0.3, 'linear');
        const g2 = glyph(partner, a, SP_B);
        anim(g2, move, 0.15, 0.6);
        anim(g2, [{ opacity: 0 }, { opacity: 1 }], 0.3, 0.3, 'linear');
      }
    });

    // Letters that arrive: "MA" and "HAPPEN". The stagger is spread so the last letter (the N)
    // lands exactly at the end of the morph: anything still rising at D would be frozen
    // half-faded, blurred and low, because every animation is clipped to D.
    const arriving = TO.filter((tok) => !tok.gap && !tok.k);
    const ARRIVE_START = 0.5, ARRIVE_DUR = 0.3;
    const step = arriving.length > 1 ? (1 - ARRIVE_START - ARRIVE_DUR) / (arriving.length - 1) : 0;
    arriving.forEach((tok, n) => {
      const b = pos(tok.el);
      const g = glyph(tok, b, SP_B);
      anim(g, [
        { transform: `translate(${b.x}px, ${b.y + 0.25 * fs}px)`, opacity: 0, filter: 'blur(4px)' },
        { transform: `translate(${b.x}px, ${b.y}px)`, opacity: 1, filter: 'blur(0px)' },
      ], ARRIVE_START + n * step, ARRIVE_DUR, 'cubic-bezier(0,0,.2,1)');
    });
    anims.forEach((a) => { a.currentTime = 0; });
  }

  async function run(direction) {
    const set = anims;
    set.forEach((a) => { a.playbackRate = direction; a.play(); });
    await Promise.all(set.map((a) => a.finished.catch(() => {})));
  }

  // The automatic rotations after the page loads
  async function autoPlay() {
    const g = ++gen;
    mode = 'auto';
    for (let i = 0; i < CYCLES; i++) {
      await sleep(HOLD_LOGO); if (g !== gen) return;
      await run(1); if (g !== gen) return;
      await sleep(HOLD_LINE); if (g !== gen) return;
      await run(-1); if (g !== gen) return;
    }
    mode = 'idle';
  }

  // After that: hovering "Werke" brings up the tagline (unless we're in the cooldown)
  async function onWerke() {
    if (mode !== 'idle' || Date.now() < cooldownUntil) return;
    const g = gen;
    mode = 'busy';
    await run(1); if (g !== gen) return;
    mode = 'shown';
    if (!link.matches(':hover')) scheduleReturn(); // the cursor already left during the morph
  }

  function scheduleReturn() {
    clearTimeout(returnTimer);
    const g = gen;
    returnTimer = setTimeout(async () => {
      if (mode !== 'shown' || g !== gen) return;
      mode = 'busy';
      await run(-1); if (g !== gen) return;
      mode = 'idle';
      cooldownUntil = Date.now() + COOLDOWN;
    }, RETURN_AFTER);
  }

  // The 8-second countdown starts when the cursor leaves the wordmark, and stops if it comes back
  link.addEventListener('mouseleave', () => { if (mode === 'shown') scheduleReturn(); });
  link.addEventListener('mouseenter', () => { if (mode === 'shown') clearTimeout(returnTimer); });

  Promise.all([document.fonts.load('600 64px Barlow'), document.fonts.load('300 64px Barlow')])
    .then(() => {
      if (!document.fonts.check('600 64px Barlow')) return; // font blocked or offline: keep the SVG logo
      logoWidth = img.getBoundingClientRect().width || 170;
      build();
      link.classList.add('anim-ready');
      autoPlay();

      let lastWidth = link.parentElement.clientWidth, t;
      addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const w = link.parentElement.clientWidth;
          if (w === lastWidth) return;
          lastWidth = w;
          // Re-measure at the new size and pick up where it was: still rotating, or resting on the logo
          const wasAuto = mode === 'auto';
          gen++; clearTimeout(returnTimer);
          build();
          if (wasAuto) autoPlay(); else mode = 'idle';
        }, 200);
      });
    })
    .catch(() => { /* keep the SVG logo */ });
})();
