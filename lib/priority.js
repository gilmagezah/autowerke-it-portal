// Support priority. "Can you still work at all?" decides the scale:
//   yes -> 1..3     no -> 2..5
const LABELS = {
  1: 'Whenever you get a chance ☕',
  2: "It's annoying, but I'm managing",
  3: "It's really slowing me down",
  4: "I'm stuck. Can't get my work done",
  5: "Everything's on fire 🔥",
};

function sanitizePriority(priority, canWork) {
  if (priority === undefined || priority === null || priority === '') return { priority: null, can_work: null };
  const can = canWork === true || canWork === 'true' || canWork === 'yes';
  const [min, max] = can ? [1, 3] : [2, 5];
  const p = Math.min(Math.max(parseInt(priority, 10) || min, min), max);
  return { priority: p, can_work: can };
}

module.exports = { sanitizePriority, PRIORITY_LABELS: LABELS };
