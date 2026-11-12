// Homepage extras: the example estimate on the trail follows the chosen service, and the
// closing "Start a request" button takes the visitor back up to the request sheet.
// app.js owns the form itself. Below the trail, sections are simply visible: the page's one
// authored moment is the trail being drawn and its sheets laid down (home.css).
(function () {
  // 1. Choosing a service turns the example estimate into that service's paperwork
  //    (an hourly estimate, a fixed-price quote, a domain quote or a written answer).
  const trail = document.getElementById('trail');
  if (trail) {
    document.querySelectorAll('#choiceGroup .choice').forEach((btn) => {
      btn.addEventListener('click', () => { trail.dataset.service = btn.dataset.value; });
    });
  }

  // 2. "Start a request" scrolls back to the request sheet and focuses the first service.
  const cta = document.getElementById('ctaStart');
  if (cta) {
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById('choiceGroup').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      const first = document.querySelector('#choiceGroup .service');
      if (first) first.focus({ preventScroll: true });
    });
  }
})();
