// Accessory: World clock. Harare plus your clients' cities, each with an office-hours light
// (green 08:00-17:00 Mon-Fri, amber an hour either side, grey otherwise). Slide the planner to
// see what time a meeting at, say, 14:00 Harare would be everywhere else.
// Your list of cities is kept in this browser.
(function () {
  const A = window.Accessories;
  const Core = window.AccCore;
  if (!A || !Core) return;
  const { load, save, esc } = A;
  const KEY = 'aw.clock.cities';
  const MAX = 8;
  const DEFAULTS = ['Africa/Johannesburg', 'Asia/Dubai', 'Europe/London', 'Asia/Kuala_Lumpur', 'Asia/Singapore'];
  const nameOf = (tz) => (Core.CITIES.find((c) => c[1] === tz) || [tz.split('/').pop().replace(/_/g, ' ')])[0];

  A.register({
    id: 'clock',
    name: 'World clock',
    short: 'Clock',
    desc: 'Harare and your clients’ cities, with office hours and a meeting planner.',
    model: 'AW-ZONE',
    label: 'world clock',
    width: 290,
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.5 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.5-3.5-8.5s1.1-5.9 3.5-8.5z"/>',
    defaultPos: (w) => ({ x: Math.round(window.innerWidth / 2 + 10), y: Math.round(window.innerHeight * 0.18) }),

    build(win) {
      let home = 'Africa/Harare';
      let cities = (load(KEY, null) || DEFAULTS).filter((tz) => Core.CITIES.some((c) => c[1] === tz)).slice(0, MAX);
      let plan = null; // minutes past midnight (home time) while planning, or null for "now"
      let timer = null;
      A.me.then((me) => { if (me.timezone) { home = me.timezone; render(); } });

      win.body.innerHTML = `
        <div class="wc-home">
          <span class="wc-home-city"></span>
          <span class="wc-home-time"></span>
          <span class="wc-home-date"></span>
        </div>
        <div class="wc-paper">
          <ul class="wc-list" aria-live="off"></ul>
          <div class="wc-add">
            <select class="wc-pick" aria-label="Add a city"></select>
          </div>
        </div>
        <label class="wc-plan">
          <span class="wc-plan-label"></span>
          <input type="range" min="0" max="1425" step="15" class="wc-slider" aria-label="Plan a time in your timezone">
        </label>
        <div class="wc-legend"><span><i class="wc-led open"></i>office hours</span><span><i class="wc-led edge"></i>edge</span><span><i class="wc-led closed"></i>closed</span></div>`;

      const $ = (s) => win.body.querySelector(s);
      const slider = $('.wc-slider');

      // The moment shown: now, or today at the planned home time
      function moment() {
        const now = new Date();
        if (plan === null) return now;
        const h = Core.clockAt(now, home);
        const homeMidnightUtc = now.getTime() - (h.hour * 60) * 60000;
        return new Date(Math.floor(homeMidnightUtc / 60000) * 60000 + plan * 60000);
      }

      function render() {
        const when = moment();
        const h = Core.clockAt(when, home);
        $('.wc-home-city').textContent = nameOf(home);
        $('.wc-home-time').textContent = h.time;
        $('.wc-home-date').textContent = `${h.weekday} ${h.date.slice(8)}/${h.date.slice(5, 7)}${plan === null ? '' : ' · planning'}`;
        win.el.classList.toggle('is-planning', plan !== null);
        $('.wc-list').innerHTML = cities.map((tz) => {
          const c = Core.clockAt(when, tz);
          const diff = (c.offset - h.offset) / 60;
          const dayShift = c.date === h.date ? '' : c.date > h.date ? '+1 day' : '−1 day';
          const state = Core.officeState(c);
          return `<li class="wc-row">
            <i class="wc-led ${state}" title="${state === 'open' ? 'Office hours' : state === 'edge' ? 'Just outside office hours' : 'Closed'}"></i>
            <span class="wc-city">${esc(nameOf(tz))}<small>${diff === 0 ? 'same time' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}h`}${dayShift ? ` · ${dayShift}` : ''} · ${esc(c.weekday)}</small></span>
            <span class="wc-time">${esc(c.time)}</span>
            <button type="button" class="wc-remove" data-remove="${esc(tz)}" aria-label="Remove ${esc(nameOf(tz))}" title="Remove">×</button>
          </li>`;
        }).join('') || '<li class="wc-empty">Add the cities you work with.</li>';
        const choices = Core.CITIES.filter(([, tz]) => tz !== home && !cities.includes(tz));
        $('.wc-pick').innerHTML = `<option value="">${cities.length >= MAX ? `Up to ${MAX} cities` : '+ Add a city…'}</option>`
          + choices.map(([n, tz]) => `<option value="${esc(tz)}">${esc(n)}</option>`).join('');
        $('.wc-pick').disabled = cities.length >= MAX;
        $('.wc-plan-label').innerHTML = plan === null
          ? 'Slide to plan a meeting time'
          : `If it’s <strong>${esc(h.time)}</strong> in ${esc(nameOf(home))} <button type="button" class="wc-now" data-now>Back to now</button>`;
        if (plan === null) slider.value = String(Math.round((h.hour * 60) / 15) * 15);
      }

      win.body.addEventListener('click', (e) => {
        const r = e.target.closest('[data-remove]');
        if (r) { cities = cities.filter((tz) => tz !== r.dataset.remove); save(KEY, cities); render(); return; }
        if (e.target.closest('[data-now]')) { plan = null; render(); }
      });
      $('.wc-pick').addEventListener('change', (e) => {
        const tz = e.target.value;
        if (tz && cities.length < MAX) { cities.push(tz); save(KEY, cities); }
        render();
      });
      slider.addEventListener('input', () => { plan = Number(slider.value); render(); });

      win.onOpen.push(() => { render(); clearInterval(timer); timer = setInterval(() => { if (plan === null) render(); }, 15000); });
      win.onClose.push(() => { clearInterval(timer); timer = null; plan = null; });
      render();
    },
  });
})();
