import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);

const APP_TOKEN = process.env.APP_TOKEN;
const APP_HASH = process.env.APP_HASH;
const PRIMEEARN_BASE_URL = 'https://partners.primeearn.com';
const ADMIN_EMAIL = 'evgeny.b@primeinsights.com';
const BYPASS_EMAIL = 'evgeny.b@primeopinion.com';
const BYPASS_PASSWORD = 'prime_earn4321@';

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Serve static assets without auth, but don't auto-serve index.html
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// Login log (in-memory, resets on restart)
const loginLog = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
      proxy: true,
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value || '';
      if (!email.endsWith('@primeinsights.com')) {
        return done(null, false);
      }
      loginLog.unshift({
        email,
        name: profile.displayName,
        timestamp: new Date().toISOString(),
      });
      if (loginLog.length > 500) loginLog.length = 500;
      return done(null, { email, name: profile.displayName });
    }
  ));
} else {
  console.warn('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set — Google OAuth disabled.');
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.user?.email === ADMIN_EMAIL) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
  res.status(403).send('Access denied.');
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

async function detectPublicIp() {
  try {
    const resp = await fetch('https://api.ipify.org?format=json');
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

// ── Public routes ─────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

app.get('/auth/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).send('Google OAuth is not configured on this server yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
  }
  passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/login?error=1' })(req, res, next);
}, (req, res) => res.redirect('/'));

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

// ── Hidden bypass login (not linked anywhere in the UI) ───────────────────────

app.get('/login/ev', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  const errorHtml = req.query.error
    ? '<p style="margin:0 0 16px;padding:10px 14px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;color:#9b1c1c;font-size:.85rem">Invalid email or password.</p>'
    : '';
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Sign in</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;font-family:'IBM Plex Sans',sans-serif;background:#f0e8d8;display:flex;align-items:center;justify-content:center;color:#182025}
    .card{background:#fffdf9;border:1px solid #d8d2c5;border-radius:16px;padding:40px;width:100%;max-width:380px;box-shadow:0 12px 30px rgba(0,0,0,.08)}
    h1{margin:0 0 24px;font-size:1.5rem;font-weight:700}
    label{display:block;font-size:.85rem;font-weight:500;margin-bottom:4px;color:#5a6168}
    input{width:100%;padding:10px 12px;border:1px solid #d8d2c5;border-radius:8px;font-size:.95rem;font-family:inherit;background:#fff;margin-bottom:16px}
    input:focus{outline:2px solid #004f5a;border-color:transparent}
    button{width:100%;padding:11px;background:#004f5a;color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;font-family:inherit;cursor:pointer;margin-top:4px}
    button:hover{opacity:.88}
  </style>
</head>
<body>
  <div class="card">
    <h1>Sign in</h1>
    ${errorHtml}
    <form method="POST" action="/login/ev">
      <label>Email</label>
      <input type="email" name="email" required autocomplete="email"/>
      <label>Password</label>
      <input type="password" name="password" required autocomplete="current-password"/>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`);
});

app.post('/login/ev', (req, res, next) => {
  const { email, password } = req.body;
  const emailOk = email === BYPASS_EMAIL;
  const pwProvided = Buffer.from(String(password || ''));
  const pwExpected = Buffer.from(BYPASS_PASSWORD);
  const pwOk = pwProvided.length === pwExpected.length &&
    crypto.timingSafeEqual(pwProvided, pwExpected);

  if (!emailOk || !pwOk) {
    return res.redirect('/login/ev?error=1');
  }

  req.login({ email: ADMIN_EMAIL, name: 'Evgeny' }, (err) => {
    if (err) return next(err);
    loginLog.unshift({ email: BYPASS_EMAIL, name: 'Evgeny (bypass)', timestamp: new Date().toISOString() });
    if (loginLog.length > 500) loginLog.length = 500;
    res.redirect('/');
  });
});

// ── All routes below require authentication ───────────────────────────────────

app.use(requireAuth);

app.get('/api/me', (req, res) => {
  res.json({
    email: req.user.email,
    name: req.user.name,
    isAdmin: req.user.email === ADMIN_EMAIL,
  });
});

app.get('/api/login-logs', requireAdmin, (_req, res) => {
  res.json({ logs: loginLog });
});

app.get('/logs', requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/logs.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasToken: Boolean(APP_TOKEN), hasAppHash: Boolean(APP_HASH) });
});

function resolveCredentials(req) {
  const token = String(req.query.appToken || '').trim() || APP_TOKEN;
  const hash = String(req.query.appHash || '').trim() || APP_HASH;
  return { token, hash };
}

app.get('/api/offers', async (req, res) => {
  const { token, hash } = resolveCredentials(req);
  if (!token || !hash) {
    return res.status(500).json({ status: 'error', message: 'Missing APP_TOKEN or APP_HASH in server environment.' });
  }

  const externalUserId = String(req.query.externalUserId || 'test_user_001');
  const platform = String(req.query.platform || 'web');

  let ip = String(req.query.ip || '').trim();
  if (!ip) ip = getClientIp(req);
  if (!ip || ip.includes('127.0.0.1') || ip.includes('::1') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    const publicIp = await detectPublicIp();
    if (publicIp) ip = publicIp;
  }

  const url = new URL(`${PRIMEEARN_BASE_URL}/${token}/api/v1/offers`);
  url.searchParams.set('app', hash);
  url.searchParams.set('external_user_id', externalUserId);
  url.searchParams.set('output', 'API');
  if (ip) url.searchParams.set('ip', ip);
  if (platform) url.searchParams.set('platform', platform);

  for (const param of ['maid', 'birthday', 'age', 'gender', 'zip', 'limit']) {
    const val = String(req.query[param] || '').trim();
    if (val) url.searchParams.set(param, val);
  }

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn API.' });
  }
});

app.get('/api/offers/active', async (req, res) => {
  const { token, hash } = resolveCredentials(req);
  if (!token || !hash) {
    return res.status(500).json({ status: 'error', message: 'Missing APP_TOKEN or APP_HASH in server environment.' });
  }

  const externalUserId = String(req.query.externalUserId || 'test_user_001');
  let ip = String(req.query.ip || '').trim();
  if (!ip) ip = getClientIp(req);
  if (!ip || ip.includes('127.0.0.1') || ip.includes('::1') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    const publicIp = await detectPublicIp();
    if (publicIp) ip = publicIp;
  }

  const url = new URL(`${PRIMEEARN_BASE_URL}/${token}/api/v1/offers/active`);
  url.searchParams.set('app', hash);
  url.searchParams.set('external_user_id', externalUserId);
  url.searchParams.set('output', 'API');
  if (ip) url.searchParams.set('ip', ip);

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn API.' });
  }
});

app.get('/api/offers/:id', async (req, res) => {
  const { token, hash } = resolveCredentials(req);
  if (!token || !hash) {
    return res.status(500).json({ status: 'error', message: 'Missing APP_TOKEN or APP_HASH in server environment.' });
  }

  const externalUserId = String(req.query.externalUserId || 'test_user_001');
  let ip = String(req.query.ip || '').trim();
  if (!ip) ip = getClientIp(req);
  if (!ip || ip.includes('127.0.0.1') || ip.includes('::1') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    const publicIp = await detectPublicIp();
    if (publicIp) ip = publicIp;
  }

  const url = new URL(`${PRIMEEARN_BASE_URL}/${token}/api/v1/offers/${encodeURIComponent(req.params.id)}`);
  url.searchParams.set('app', hash);
  url.searchParams.set('external_user_id', externalUserId);
  url.searchParams.set('output', 'API');
  if (ip) url.searchParams.set('ip', ip);

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn API.' });
  }
});

app.get('/api/static-feed', async (req, res) => {
  const token = String(req.query.appToken || '').trim() || APP_TOKEN;
  const hash  = String(req.query.appHash  || '').trim() || APP_HASH;

  if (!token || !hash) {
    return res.status(500).json({ status: 'error', message: 'Missing app token or app hash.' });
  }

  const url = new URL(`${PRIMEEARN_BASE_URL}/${token}/api/v1/offers/feed`);
  url.searchParams.set('app', hash);

  const perPage = String(req.query.per_page || '20').trim();
  const page    = String(req.query.page     || '1').trim();
  if (perPage) url.searchParams.set('per_page', perPage);
  if (page)    url.searchParams.set('page',     page);

  for (const v of [].concat(req.query['countries[]']       || [])) url.searchParams.append('countries[]',       v);
  for (const v of [].concat(req.query['platform[]']        || [])) url.searchParams.append('platform[]',        v);
  for (const v of [].concat(req.query['conversion_type[]'] || [])) url.searchParams.append('conversion_type[]', v);

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn Static Feed API.' });
  }
});

// ── S2S postback receiver ─────────────────────────────────────────────────────

const SERVER_START_TIME = new Date().toISOString();
const postbackLog = [];
const MAX_LOG_ENTRIES = 200;

function recordPostback(req) {
  postbackLog.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    method: req.method,
    query: { ...req.query },
    body: req.method !== 'GET' ? { ...req.body } : {},
    ip: getClientIp(req),
  });
  if (postbackLog.length > MAX_LOG_ENTRIES) postbackLog.length = MAX_LOG_ENTRIES;
}

app.get('/postback', (req, res) => {
  recordPostback(req);
  res.send('OK');
});

app.post('/postback', (req, res) => {
  recordPostback(req);
  res.send('OK');
});

app.get('/api/postback-logs', (_req, res) => {
  res.json({ logs: postbackLog, serverStartTime: SERVER_START_TIME });
});

app.delete('/api/postback-logs', (_req, res) => {
  postbackLog.length = 0;
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(port, () => {
  console.log(`PrimeEarn test app running on http://localhost:${port}`);
});
