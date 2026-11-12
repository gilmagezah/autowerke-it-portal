// Builds the client-facing progress update.
// ONLY phase titles, done state, and completion dates go out.
// Instructions and internal notes are deliberately never read here.
//
// Uses table layout + inline styles because email clients (Gmail, Outlook)
// strip most modern CSS.

const { computeProgress } = require('./phases');

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(str = '') {
  return esc(str).replace(/\r?\n/g, '<br>');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Fixed format (e.g. "28 Sep 2026") - toLocaleDateString output varies by Node/ICU version
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

// Brand palette + typewriter type (email apps can't load web fonts, so this
// falls back to Courier New, which every email client has)
const GREEN = '#2F4A3B';
const GREEN_2 = '#4A6A57';
const PAPER = '#F4F1E8';
const LINE = '#E0DCD0';
const INK = '#1F2622';
const MUTED = '#7B7B70';
const ON_GREEN_MUTED = '#B9C7BB';
const MONO = "'Courier Prime','Courier New',Courier,monospace";

function progressBar(percent) {
  const fill = `<td style="background:${GREEN};height:6px;width:${percent}%;font-size:0;line-height:0;">&nbsp;</td>`;
  const rest = `<td style="background:${LINE};height:6px;font-size:0;line-height:0;">&nbsp;</td>`;
  const cells = percent >= 100 ? fill : percent <= 0 ? rest : fill + rest;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 6px;"><tr>${cells}</tr></table>`;
}

function phaseRow(phase, index, currentIndex) {
  const isCurrent = index === currentIndex;
  let mark = `<span style="color:${LINE};">&middot;</span>`;
  let status = 'UPCOMING';
  let statusColor = MUTED;
  let titleColor = MUTED;
  let weight = 'normal';

  if (phase.done) {
    mark = `<span style="color:${GREEN_2};font-weight:bold;">&#10003;</span>`;
    status = phase.completed_date ? `COMPLETED ${esc(fmtDate(phase.completed_date)).toUpperCase()}` : 'COMPLETED';
    titleColor = INK;
    weight = 'bold';
  } else if (isCurrent) {
    mark = `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${GREEN};"></span>`;
    status = 'IN PROGRESS';
    statusColor = GREEN;
    titleColor = INK;
    weight = 'bold';
  }

  return `
    <tr>
      <td style="width:34px;padding:11px 0;border-bottom:1px solid ${LINE};font-family:${MONO};font-size:12px;color:${MUTED};vertical-align:top;">${String(index + 1).padStart(2, '0')}</td>
      <td style="padding:11px 0;border-bottom:1px solid ${LINE};vertical-align:top;">
        <div style="font-family:${MONO};font-size:14px;font-weight:${weight};color:${titleColor};">${esc(phase.title)}</div>
        <div style="font-family:${MONO};font-size:10.5px;letter-spacing:1px;color:${statusColor};margin-top:3px;">${status}</div>
      </td>
      <td style="width:24px;padding:11px 0;border-bottom:1px solid ${LINE};text-align:right;vertical-align:top;font-size:14px;">${mark}</td>
    </tr>`;
}

// ---------- Gantt chart (table-based, so it renders in every email app) ----------
const DAY = 86400000;
const toDay = (iso) => Date.UTC(...String(iso).slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
const shortDate = (ms) => { const d = new Date(ms); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`; };

function ganttHtml(phases, currentIndex, now = new Date()) {
  const dated = phases.map((p, i) => ({ ...p, i })).filter((p) => /^\d{4}-\d{2}-\d{2}/.test(p.planned_start || '') && /^\d{4}-\d{2}-\d{2}/.test(p.planned_end || ''));
  if (!dated.length) return '';
  const start = Math.min(...dated.map((p) => toDay(p.planned_start)));
  const end = Math.max(...dated.map((p) => toDay(p.planned_end)));
  const span = Math.max(1, Math.round((end - start) / DAY) + 1);
  // Daily columns for short projects, weekly (or wider) for longer ones: never more than 16 columns
  const step = span <= 14 ? 1 : Math.max(7, Math.ceil(span / 16 / 7) * 7);
  const cols = Math.ceil(span / step);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const colStart = (c) => start + c * step * DAY;
  const isToday = (c) => today >= colStart(c) && today < colStart(c + 1);
  const cellW = Math.max(14, Math.floor(330 / cols));

  const head = Array.from({ length: cols }, (_, c) => `<td style="width:${cellW}px;padding:0 0 4px;font-family:${MONO};font-size:9px;color:${isToday(c) ? '#A06414' : MUTED};text-align:left;white-space:nowrap;${isToday(c) ? 'font-weight:bold;' : ''}">${c % Math.ceil(cols / 6) === 0 || isToday(c) ? shortDate(colStart(c)) : ''}</td>`).join('');
  const rows = dated.map((p) => {
    const s0 = toDay(p.planned_start);
    const e0 = toDay(p.planned_end) + DAY;
    const colour = p.done ? GREEN_2 : p.i === currentIndex ? GREEN : '#CFD8CC';
    const cells = Array.from({ length: cols }, (_, c) => {
      const on = colStart(c) < e0 && colStart(c + 1) > s0;
      const bg = on ? colour : isToday(c) ? '#F5EBD7' : PAPER;
      return `<td style="height:16px;background:${bg};border-right:1px solid #FFFFFF;font-size:0;line-height:0;">&nbsp;</td>`;
    }).join('');
    return `<tr><td style="padding:3px 10px 3px 0;font-family:${MONO};font-size:11px;color:${p.done ? MUTED : INK};white-space:nowrap;${p.i === currentIndex ? 'font-weight:bold;' : ''}">${esc(p.title)}</td>${cells}</tr>`;
  }).join('');
  const key = (c, label) => `<span style="display:inline-block;width:10px;height:10px;background:${c};vertical-align:middle;margin:0 4px 0 10px;"></span>${label}`;
  return `
  <div style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${MUTED};margin:26px 0 8px;">TIMELINE</div>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
    <tr><td></td>${head}</tr>
    ${rows}
  </table>
  <div style="font-family:Arial,sans-serif;font-size:11px;color:${MUTED};margin-top:8px;">${key(GREEN_2, 'Done')}${key(GREEN, 'In progress')}${key('#CFD8CC', 'Upcoming')}${key('#F5EBD7', 'This week')}</div>`;
}

function buildProgressUpdateHtml({ project, message, baseUrl }) {
  const phases = project.phases || [];
  const { total, done, percent, currentIndex } = computeProgress(phases);
  const allDone = total > 0 && done === total;
  const title = project.project_title || 'Project progress';

  const messageHtml = message
    ? `<div class="aw-cream" style="background:${PAPER};border-radius:6px;padding:12px 14px;margin:0 0 20px;font-size:14px;line-height:1.55;color:${INK};">${nl2br(message)}</div>`
    : '';

  const summary = allDone
    ? `<div style="font-size:14px;color:${INK};margin:0 0 18px;"><strong>All phases complete!</strong> Your sign-off document will be sent to you shortly.</div>`
    : '';

  const trackUrl = `${baseUrl}/track`;
  // The header table uses border-collapse:separate: collapsed tables lose their rounded corners

  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:${INK};">
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${GREEN};border-radius:8px;margin:0 0 20px;">
    <tr>
      <td style="padding:18px 20px;">
        <div style="font-family:${MONO};font-size:11px;font-weight:bold;letter-spacing:2px;color:${ON_GREEN_MUTED};">PROJECT PROGRESS UPDATE</div>
        <div style="font-family:${MONO};font-size:19px;font-weight:bold;color:${PAPER};margin-top:5px;">${esc(title)}</div>
        <div style="font-family:${MONO};font-size:11px;letter-spacing:1px;color:${ON_GREEN_MUTED};margin-top:4px;">${esc(project.company_name).toUpperCase()} &middot; ${esc(project.project_id)}</div>
      </td>
      <td style="padding:18px 20px;text-align:right;vertical-align:bottom;white-space:nowrap;">
        <div style="font-family:${MONO};font-size:11px;font-weight:bold;letter-spacing:2px;color:${ON_GREEN_MUTED};">COMPLETE</div>
        <div style="font-family:${MONO};font-size:26px;font-weight:bold;color:${PAPER};">${percent}%</div>
        <div style="font-family:${MONO};font-size:11px;color:${ON_GREEN_MUTED};">${done} OF ${total} PHASES</div>
      </td>
    </tr>
  </table>
  ${messageHtml}
  ${summary}
  ${progressBar(percent)}
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
    <tr>
      <td style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${MUTED};padding:8px 0;border-bottom:1px solid ${LINE};">NO.</td>
      <td style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${MUTED};padding:8px 0;border-bottom:1px solid ${LINE};">PHASE</td>
      <td style="font-family:${MONO};font-size:10px;letter-spacing:2px;color:${MUTED};padding:8px 0;border-bottom:1px solid ${LINE};text-align:right;">&#10003;</td>
    </tr>
    ${phases.map((p, i) => phaseRow(p, i, currentIndex)).join('')}
  </table>
  ${ganttHtml(phases, currentIndex)}
  <p style="font-size:13px;color:${MUTED};margin-top:22px;">
    Track progress anytime at <a href="${esc(trackUrl)}" style="color:${GREEN};">${esc(trackUrl)}</a>
    using reference <strong style="font-family:${MONO};color:${INK};">${esc(project.project_id)}</strong>.
  </p>
</div>`;
}

module.exports = { buildProgressUpdateHtml, ganttHtml };
