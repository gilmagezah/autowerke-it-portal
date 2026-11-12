// Delivery phases for signed IT projects: the default template, validation of
// whatever the admin page sends back, and progress maths.

const crypto = require('crypto');

// Generic IT project template. Instructions are INTERNAL ONLY - they are never
// included in anything sent to the client. Edit freely per project.
const DEFAULT_PHASES = [
  {
    title: 'Kickoff & Discovery',
    instructions:
      'Book a kickoff call with the client contact.\n' +
      'Walk through the signed scope and confirm nothing has changed.\n' +
      'Confirm key contacts, working hours, and how they want updates.',
  },
  {
    title: 'Access & Prerequisites',
    instructions:
      'Request the admin access and accounts needed for the work.\n' +
      'Check licences and any prerequisites (network, hardware, existing config).\n' +
      'Note anything blocking and chase the client for it.',
  },
  {
    title: 'Planning & Design',
    instructions:
      'Write the configuration / change plan.\n' +
      'Include a rollback plan for anything risky.\n' +
      'Agree the rollout schedule and any user communication with the client.',
  },
  {
    title: 'Build & Configuration',
    instructions:
      'Implement the planned configuration, starting with a test or pilot group.\n' +
      'Record every change made so handover docs are easy to write later.',
  },
  {
    title: 'Testing & Pilot',
    instructions:
      'Run the pilot with a small group of real users.\n' +
      'Collect feedback, fix issues, and re-test before wider rollout.',
  },
  {
    title: 'Rollout',
    instructions:
      'Roll out to the remaining users/devices in the agreed batches.\n' +
      'Monitor for issues after each batch before continuing.',
  },
  {
    title: 'Handover & Training',
    instructions:
      'Deliver any agreed user or admin training.\n' +
      'Hand over documentation and admin credentials the client should hold.',
  },
  {
    title: 'Sign-off & Close',
    instructions:
      'Walk the client through what was delivered against the scope.\n' +
      'Get written sign-off, then raise the final invoice.',
  },
];

const MAX_PHASES = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function newId() {
  return crypto.randomUUID();
}

function blankPhase(title, instructions = '') {
  return {
    id: newId(),
    title,
    instructions,
    notes: '',
    done: false,
    completed_date: null,
    planned_start: null,
    planned_end: null,
  };
}

function createDefaultPhases() {
  return DEFAULT_PHASES.map((p) => blankPhase(p.title, p.instructions));
}

function cleanDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? null : v;
}

function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Never trust the browser: rebuild every phase from known fields only.
function sanitizePhases(input) {
  if (!Array.isArray(input)) throw new Error('Phases must be a list.');
  if (input.length > MAX_PHASES) throw new Error(`Too many phases (max ${MAX_PHASES}).`);

  return input.map((raw, i) => {
    const p = raw && typeof raw === 'object' ? raw : {};
    const title = cleanText(p.title, 120);
    if (!title) throw new Error(`Phase ${i + 1} needs a title.`);
    const done = p.done === true;

    return {
      id: typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : newId(),
      title,
      instructions: cleanText(p.instructions, 4000),
      notes: cleanText(p.notes, 4000),
      done,
      completed_date: done ? cleanDate(p.completed_date) : null,
      planned_start: cleanDate(p.planned_start),
      planned_end: cleanDate(p.planned_end),
    };
  });
}

function computeProgress(phases = []) {
  const total = phases.length;
  const done = phases.filter((p) => p.done).length;
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    currentIndex: phases.findIndex((p) => !p.done), // -1 when everything is done
  };
}

module.exports = { DEFAULT_PHASES, createDefaultPhases, sanitizePhases, computeProgress };
