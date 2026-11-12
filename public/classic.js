// Homepage extras: reveal the information sections as they scroll into view, and make the
// closing "Start a request" button take the visitor back up to the service cards.
(function () {
  const groups = [...document.querySelectorAll('.reveal-group')];

  // Only hide what is still below the fold. Anything already on screen stays put, so
  // nothing flickers on load, and with no JavaScript every section is simply visible.
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('shown');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -80px 0px' });

    groups.forEach((g) => {
      if (g.getBoundingClientRect().top < window.innerHeight) return;
      g.classList.add('reveal');
      io.observe(g);
    });
  }

  const cta = document.getElementById('ctaStart');
  if (cta) {
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('choiceGroup').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      const first = document.querySelector('.service-grid .service');
      if (first) first.focus({ preventScroll: true });
    });
  }
})();
