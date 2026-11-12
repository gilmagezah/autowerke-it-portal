// Shared by admin.js (editable) and confirm.js (read-only).
// Renders logged work sessions as colored blocks on a per-day horizontal axis.

const TIMELINE_START_HOUR = 8;
const TIMELINE_END_HOUR = 18;

function minutesSinceStart(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60 + m) - TIMELINE_START_HOUR * 60;
}

function tlClamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function tlEscapeHtml(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// options: { editable: boolean, projectId: string }
// When editable, each block gets a small remove button - the caller wires up
// the actual delete behavior via event delegation on .remove-entry.
function renderTimeline(container, workLog, options = {}) {
  if (!workLog || workLog.length === 0) {
    container.innerHTML = '<div class="timeline-empty">No hours logged yet.</div>';
    return;
  }

  const windowMinutes = (TIMELINE_END_HOUR - TIMELINE_START_HOUR) * 60;
  const byDate = {};
  workLog.forEach((e) => {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  });
  const dates = Object.keys(byDate).sort();

  let totalMinutes = 0;

  const rowsHtml = dates.map((date) => {
    const entries = byDate[date].slice().sort((a, b) => a.start.localeCompare(b.start));

    const blocksHtml = entries.map((e) => {
      const rawStart = minutesSinceStart(e.start);
      const rawEnd = minutesSinceStart(e.end);
      totalMinutes += Math.max(rawEnd - rawStart, 0);

      const startMin = tlClamp(rawStart, 0, windowMinutes);
      const endMin = tlClamp(rawEnd, 0, windowMinutes);
      const widthMin = Math.max(endMin - startMin, 4);
      const leftPct = (startMin / windowMinutes) * 100;
      const widthPct = (widthMin / windowMinutes) * 100;

      const tooltipText = `${tlEscapeHtml(e.start)}\u2013${tlEscapeHtml(e.end)}${e.note ? ' \u00b7 ' + tlEscapeHtml(e.note) : ''}`;
      const removeBtn = options.editable
        ? `<button class="remove-entry" data-entry-id="${tlEscapeHtml(e.id)}" data-project-id="${tlEscapeHtml(options.projectId)}" title="Remove">\u2715</button>`
        : '';

      return `<div class="timeline-block" style="left:${leftPct}%;width:${widthPct}%;" data-entry-id="${tlEscapeHtml(e.id)}">
        <span class="timeline-tooltip">${tooltipText}${removeBtn}</span>
      </div>`;
    }).join('');

    return `<div class="timeline-row">
      <div class="timeline-day-label">${formatDateLabel(date)}</div>
      <div class="timeline-track">${blocksHtml}</div>
    </div>`;
  }).join('');

  const axisHtml = `<div class="timeline-axis">
    <span>${TIMELINE_START_HOUR}:00</span>
    <span>${Math.floor((TIMELINE_START_HOUR + TIMELINE_END_HOUR) / 2)}:00</span>
    <span>${TIMELINE_END_HOUR}:00</span>
  </div>`;

  const totalHours = (totalMinutes / 60).toFixed(1);

  container.innerHTML = `<div class="timeline">${rowsHtml}${axisHtml}</div><div class="timeline-total">Total logged: ${totalHours} hours</div>`;
}
