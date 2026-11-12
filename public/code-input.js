// One box per character, like the code email. Auto-advances, handles paste and backspace.
// Usage: const ci = CodeInput(containerEl, 8, (code) => submit(code)); ci.value(); ci.clear(); ci.focus();
(function () {
  window.CodeInput = function (el, length, onComplete) {
    el.classList.add('code-boxes');
    el.innerHTML = Array.from({ length }, (_, i) =>
      `<input type="text" inputmode="text" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" maxlength="1" aria-label="Character ${i + 1} of ${length}" spellcheck="false">`).join('');
    const boxes = [...el.querySelectorAll('input')];
    const clean = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const value = () => boxes.map((b) => b.value).join('');
    const check = () => { if (value().length === length && onComplete) onComplete(value()); };

    function fill(from, text) {
      const chars = clean(text).split('');
      let i = from;
      for (const ch of chars) { if (i >= length) break; boxes[i].value = ch; i++; }
      boxes[Math.min(i, length - 1)].focus();
      check();
    }

    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        const v = clean(b.value);
        if (v.length > 1) return fill(i, v); // some keyboards insert several characters at once
        b.value = v;
        if (v && i < length - 1) boxes[i + 1].focus();
        check();
      });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].value = ''; boxes[i - 1].focus(); e.preventDefault(); }
        if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
        if (e.key === 'ArrowRight' && i < length - 1) boxes[i + 1].focus();
      });
      b.addEventListener('paste', (e) => { e.preventDefault(); fill(i, (e.clipboardData || window.clipboardData).getData('text')); });
      b.addEventListener('focus', () => b.select());
    });
    return {
      value,
      clear() { boxes.forEach((b) => { b.value = ''; }); boxes[0].focus(); },
      focus() { boxes[0].focus(); },
      disable(on) { boxes.forEach((b) => { b.disabled = on; }); },
    };
  };
})();
