// Country code picker for phone fields. Wraps an existing <input type="tel">:
//   const phone = PhoneInput(document.getElementById('phone'));  phone.value()  -> "+263 771234567"
(function () {
  const COUNTRIES = [
    ['ZW', 'Zimbabwe', '263'], ['ZA', 'South Africa', '27'], ['ZM', 'Zambia', '260'], ['BW', 'Botswana', '267'],
    ['MZ', 'Mozambique', '258'], ['MW', 'Malawi', '265'], ['NA', 'Namibia', '264'], ['TZ', 'Tanzania', '255'],
    ['KE', 'Kenya', '254'], ['UG', 'Uganda', '256'], ['NG', 'Nigeria', '234'], ['GH', 'Ghana', '233'],
    ['MU', 'Mauritius', '230'], ['EG', 'Egypt', '20'],
    ['AE', 'United Arab Emirates', '971'], ['GB', 'United Kingdom', '44'], ['IE', 'Ireland', '353'],
    ['US', 'United States / Canada', '1'], ['AU', 'Australia', '61'], ['DE', 'Germany', '49'],
    ['NL', 'Netherlands', '31'], ['PT', 'Portugal', '351'], ['IN', 'India', '91'], ['CN', 'China', '86'],
    ['MY', 'Malaysia', '60'], ['SG', 'Singapore', '65'],
  ];
  const flag = (cc) => cc.replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

  window.PhoneInput = function (input, defaultCode = '263') {
    const wrap = document.createElement('div');
    wrap.className = 'phone-wrap';
    const select = document.createElement('select');
    select.className = 'phone-cc';
    select.setAttribute('aria-label', 'Country code');
    select.innerHTML = COUNTRIES.map(([cc, name, code]) => `<option value="${code}" ${code === defaultCode ? 'selected' : ''}>${flag(cc)} +${code} ${name}</option>`).join('');
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(select);
    wrap.appendChild(input);
    input.placeholder = input.placeholder || '77 123 4567';

    // Closed, the picker shows just the flag and code ("🇿🇼 +263"); opened, every option shows
    // its country name too, so the list is still easy to choose from
    const full = (o) => { const [cc, name, code] = COUNTRIES[o.index]; return `${flag(cc)} +${code} ${name}`; };
    const short = (o) => { const [cc, , code] = COUNTRIES[o.index]; return `${flag(cc)} +${code}`; };
    const showShort = () => { [...select.options].forEach((o) => { o.textContent = o.selected ? short(o) : full(o); }); };
    const showFull = () => { [...select.options].forEach((o) => { o.textContent = full(o); }); };
    ['mousedown', 'focus', 'keydown'].forEach((ev) => select.addEventListener(ev, showFull));
    ['change', 'blur'].forEach((ev) => select.addEventListener(ev, showShort));
    showShort();

    // Typing or pasting a full international number picks the country automatically
    input.addEventListener('input', () => {
      const m = input.value.trim().match(/^(?:\+|00)(\d{1,3})/);
      if (!m) return;
      const hit = COUNTRIES.map((c) => c[2]).filter((code) => m[1].startsWith(code)).sort((a, b) => b.length - a.length)[0];
      if (hit) { select.value = hit; showShort(); input.value = input.value.trim().replace(/^(?:\+|00)/, '').slice(hit.length).trim(); }
    });

    // A pre-filled international number (e.g. reopening a saved form) is split the same way
    if (/^(?:\+|00)\d/.test(input.value.trim())) input.dispatchEvent(new Event('input'));

    return {
      // "+263 771234567": the country code plus the local number without its leading 0
      value() {
        const local = input.value.replace(/[^\d]/g, '').replace(/^0+/, '');
        return local ? `+${select.value} ${local}` : '';
      },
      valid() {
        const digits = input.value.replace(/[^\d]/g, '').replace(/^0+/, '');
        return !digits || (digits.length >= 6 && digits.length <= 13);
      },
      reset() { input.value = ''; select.value = defaultCode; showShort(); },
    };
  };
})();
