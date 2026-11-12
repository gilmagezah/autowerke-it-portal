// Admin sign-in: step 1 email + password, step 2 the 6-letter code we email (lib/auth.js).
// "Resend code" uses the one-off ticket step 1 hands back, so the password is never kept in
// the page: it's cleared from the field as soon as step 1 succeeds.
const $ = (id) => document.getElementById(id);
const next = new URLSearchParams(location.search).get('next') || '/admin';
let email = '';
let ticket = null;
let resendAt = 0; let resendTimer = null;

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { data });
  return data;
}
const say = (t, ok) => { $('msg').textContent = t || ''; $('msg').classList.toggle('ok', Boolean(ok)); };
$('year').textContent = String(new Date().getFullYear());

const code = CodeInput($('codeBoxes'), 6, () => verify());

// Show / hide the password
$('showPw').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('showPw').setAttribute('aria-pressed', String(show));
  $('showPw').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  $('password').focus();
});

// "Resend code in 0:45", then a live link
function countdown(seconds) {
  clearInterval(resendTimer);
  const btn = $('resendBtn');
  if (seconds === null) { btn.disabled = true; btn.textContent = 'No more new codes for this sign-in'; return; }
  resendAt = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.ceil((resendAt - Date.now()) / 1000);
    if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = 'Resend code'; return; }
    btn.disabled = true;
    btn.textContent = `Resend code in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  resendTimer = setInterval(tick, 1000);
}

$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  email = $('email').value.trim();
  if (!email || !$('password').value) return say('Enter your email and password.');
  $('pwBtn').disabled = true;
  $('pwBtn').textContent = 'Checking…';
  say('');
  try {
    const r = await post('/api/auth/login', { email, password: $('password').value });
    $('password').value = ''; // don't keep it in the page
    ticket = r.resend || null;
    $('sentTo').textContent = r.sentTo;
    $('mins').textContent = r.minutes;
    $('pwStep').classList.add('hidden');
    $('codeStep').classList.remove('hidden');
    $('footNote').textContent = 'Didn’t get it? Check your spam folder. Sessions end after 30 minutes of inactivity.';
    countdown(ticket ? r.resendIn ?? 45 : null);
    code.focus();
  } catch (err) {
    say(err.message);
  }
  $('pwBtn').disabled = false;
  $('pwBtn').textContent = 'Continue';
});

async function verify() {
  const value = code.value();
  if (value.length !== 6) return say('Enter all 6 letters.');
  if ($('codeBtn').disabled) return;
  $('codeBtn').disabled = true;
  $('codeBtn').textContent = 'Checking…';
  code.disable(true);
  try {
    const r = await post('/api/auth/verify', { email, code: value, next });
    say('Signed in. Opening the admin centre…', true);
    location.href = r.next;
  } catch (err) {
    say(err.message);
    code.disable(false);
    code.clear();
    $('codeBtn').disabled = false;
    $('codeBtn').textContent = 'Verify and sign in';
  }
}
$('codeForm').addEventListener('submit', (e) => { e.preventDefault(); verify(); });

$('resendBtn').addEventListener('click', async () => {
  if (!ticket) return;
  $('resendBtn').disabled = true;
  try {
    const r = await post('/api/auth/resend', { ticket });
    $('sentTo').textContent = r.sentTo;
    $('mins').textContent = r.minutes;
    say(`New code sent. The earlier one no longer works.${r.left === 0 ? ' That was the last new code for this sign-in.' : ''}`, true);
    code.clear();
    countdown(r.resendIn ?? null);
  } catch (err) {
    say(err.message);
    if (err.data && err.data.restart) { ticket = null; countdown(null); } else countdown(err.data && err.data.resendIn ? err.data.resendIn : 45);
  }
});

$('backBtn').addEventListener('click', () => { location.href = `/admin/login?next=${encodeURIComponent(next)}`; });
