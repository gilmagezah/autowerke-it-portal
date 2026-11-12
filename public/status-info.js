// Every request status in one place: a human label, whose court the ball is in,
// and a short (slightly cheeky) line for the client. Loaded by the browser
// (tracking page, admin directory) AND the server (directory PDF), so they
// always agree.
//
// owner: 'you'  = the client needs to act
//        'us'   = we need to act
//        'both' = a meeting is booked - everyone's on court
//        'done' = finished

(function (root) {
  const S = {
    pending_review:   { label: 'Under review',          owner: 'us',   line: "We're reading through your request." },
    reviewed:         { label: 'Scope sent',            owner: 'you',  line: "Have a look at the scope we sent and confirm it's right." },
    changes_requested:{ label: 'Updating scope',        owner: 'us',   line: "We're working your changes into the scope." },
    client_confirmed: { label: 'Preparing price',       owner: 'us',   line: "We're putting your price together." },
    pricing_sent:     { label: 'Price sent',            owner: 'you',  line: "Your price is ready. Say the word and we'll get going." },
    estimate_sent:    { label: 'Estimate sent',         owner: 'you',  line: 'Sign and upload the estimate so we can start.' },
    proceeding:       { label: 'Contract sent',         owner: 'you',  line: 'Sign and upload your contract to get things moving.' },
    signed:           { label: 'In delivery',           owner: 'us',   line: "We're delivering your project, phase by phase." },
    delivered:        { label: 'Awaiting sign-off',     owner: 'you',  line: 'Your sign-off document is ready to sign.' },
    closed:           { label: 'Closed',                owner: 'done', line: 'Project closed. Thanks for working with us!' },
    in_progress:      { label: 'In progress',           owner: 'us',   line: "We're on it. Time is logged as we work." },
    awaiting_signoff: { label: 'Awaiting sign-off',     owner: 'you',  line: "Work's done. Please sign and return the sign-off." },
    completed:        { label: 'Completed',             owner: 'done', line: 'All sorted. Thanks for working with us!' },
    declined:         { label: 'Not proceeding',        owner: 'done', line: 'No problem. Reach out anytime if things change.' },
    domain_requested: { label: 'Checking availability', owner: 'us',   line: "We're checking availability and prices." },
    domain_quoted:    { label: 'Quote sent',            owner: 'you',  line: "Your domain quote is ready. Say the word and we'll grab it." },
    domain_accepted:  { label: 'Registering',           owner: 'us',   line: "We're registering and setting up your domain." },
    domain_registered:{ label: 'Registered',            owner: 'done', line: "Your domain is set up, and we'll remind you before renewal." },
    consult_requested:{ label: 'Consultant reviewing',  owner: 'us',   line: 'A consultant is looking at your challenge.' },
    consult_answered: { label: 'Advice sent',           owner: 'done', line: 'Our response is in your inbox. Follow-up questions? Just reply.' },
    consult_meeting_invited:   { label: 'Pick a meeting time', owner: 'you', line: 'Choose a time that suits you for the discovery meeting.' },
    consult_meeting_requested: { label: 'Confirming time',     owner: 'us',  line: "We're confirming a time from the options you gave us." },
    consult_meeting_confirmed: { label: 'Meeting booked',      owner: 'both', line: 'See you there. The calendar invite is in your inbox.' },
    consult_closed:   { label: 'Closed',                owner: 'done', line: 'All done. Thanks for working with us!' },
  };

  const HEADLINE = {
    you: "Ball's in your court",
    us: "Ball's in our court",
    both: 'Rally time',
    done: 'Game, set, match',
  };

  // Admin-facing wording for the same idea
  const ADMIN_OWNER = { you: 'Waiting on client', us: 'Waiting on us', both: 'Meeting booked', done: 'Finished' };

  // ctx: { requestType, signoffSentAt, signoffSignedAt }
  function statusInfo(status, ctx = {}) {
    let info = S[status] ? { ...S[status] } : { label: String(status || 'Unknown').replace(/_/g, ' '), owner: 'us', line: "We're on it." };

    // Context-dependent wording
    if (status === 'client_confirmed' && ctx.requestType === 'IT Support') {
      info = { ...info, label: 'Preparing estimate', line: "We're putting your work estimate together." };
    }
    if (status === 'signed' && ctx.signoffSentAt && !ctx.signoffSignedAt) {
      info = { label: 'Awaiting sign-off', owner: 'you', line: 'All phases are done. Please sign and return the sign-off document.' };
    }
    return { ...info, status, headline: HEADLINE[info.owner], adminOwner: ADMIN_OWNER[info.owner] };
  }

  const api = { statusInfo, STATUSES: Object.keys(S), HEADLINE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StatusInfo = api;
})(typeof window !== 'undefined' ? window : this);
