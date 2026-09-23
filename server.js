import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
app.set('trust proxy', 1);

const APP_TOKEN = process.env.APP_TOKEN;
const APP_HASH = process.env.APP_HASH;
const REVENUE_API_KEY = process.env.REVENUE_API_KEY;
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

// Login log — persisted to Postgres when DATABASE_URL is set, in-memory fallback otherwise
const loginLogFallback = [];
let dbPool = null;

if (process.env.DATABASE_URL) {
  const { Pool } = pg;
  dbPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  dbPool.query(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(err => console.error('DB init error:', err));
}

async function addLoginLog(email, name) {
  if (dbPool) {
    await dbPool.query(
      'INSERT INTO login_logs (email, name, timestamp) VALUES ($1, $2, NOW())',
      [email, name]
    ).catch(err => console.error('Login log write error:', err));
  } else {
    loginLogFallback.unshift({ email, name, timestamp: new Date().toISOString() });
    if (loginLogFallback.length > 500) loginLogFallback.length = 500;
  }
}

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
      addLoginLog(email, profile.displayName);
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
    addLoginLog(BYPASS_EMAIL, 'Evgeny (bypass)');
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

app.get('/api/login-logs', requireAdmin, async (_req, res) => {
  if (dbPool) {
    try {
      const result = await dbPool.query(
        'SELECT email, name, timestamp FROM login_logs ORDER BY timestamp DESC LIMIT 500'
      );
      return res.json({ logs: result.rows });
    } catch (err) {
      console.error('Login log read error:', err);
    }
  }
  res.json({ logs: loginLogFallback });
});

app.get('/logs', requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/logs.html'));
});

app.get('/script-preview', (req, res) => {
  const allowedModules   = ['offers', 'offers-carousel', 'surveys'];
  const allowedPlatforms = ['web', 'ios', 'android'];
  const allowedLayouts   = ['default', 'vertical', 'horizontal'];

  const appId    = String(req.query.appId    || APP_TOKEN || '').trim();
  const userId   = String(req.query.userId   || 'test_user_001').trim();
  const module   = allowedModules.includes(req.query.module)     ? req.query.module   : 'offers';
  const platform = allowedPlatforms.includes(req.query.platform) ? req.query.platform : '';
  const layout   = allowedLayouts.includes(req.query.layout)     ? req.query.layout   : '';
  const columnQty = parseInt(req.query.columnQty) || 0;
  const limit     = parseInt(req.query.limit)     || 0;
  const primaryColor = /^#[0-9a-fA-F]{3,8}$/.test(req.query.primaryColor || '') ? req.query.primaryColor : '';
  const bgColor      = /^#[0-9a-fA-F]{3,8}$/.test(req.query.bgColor      || '') ? req.query.bgColor      : '';

  const config = { container: '#primeearn-widget', appId, userId, module };
  if (platform) config.platform = platform;
  if (layout)   config.layout   = layout;
  if (columnQty > 0) config.columnQty = columnQty;
  if (limit > 0)     config.limit     = limit;
  if (primaryColor || bgColor) {
    config.customAppDesign = {};
    if (primaryColor) config.customAppDesign['--p-primary-500'] = primaryColor;
    if (bgColor)      config.customAppDesign['--ps-pages-bg']   = bgColor;
  }

  // Escape <, >, & so the JSON literal is safe inside a <script> tag
  const configJson = JSON.stringify(config, null, 2)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Script Preview</title>
  <style>body{margin:0;padding:0}#primeearn-widget{width:100%;min-height:600px}</style>
</head>
<body>
  <div id="primeearn-widget"></div>
  <script>
  (function(){
    window.psConfig = ${configJson};
    var s = document.createElement('script');
    s.src = 'https://monetize.primeearn.com/ext/integration2.js?v=' + Date.now();
    document.head.appendChild(s);
  })();
  </script>
</body>
</html>`);
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

  const perPage = String(req.query.per_page || '20').trim();
  const page    = String(req.query.page     || '1').trim();

  // Build URL manually for array params — URLSearchParams percent-encodes brackets
  // (platform%5B%5D) which most APIs don't recognise; keep them literal instead.
  let feedUrl = `${PRIMEEARN_BASE_URL}/${token}/api/v1/offers/feed?app=${encodeURIComponent(hash)}`;
  if (perPage) feedUrl += `&per_page=${encodeURIComponent(perPage)}`;
  if (page)    feedUrl += `&page=${encodeURIComponent(page)}`;
  for (const v of [].concat(req.query['countries[]']       || [])) feedUrl += `&countries[]=${encodeURIComponent(v)}`;
  for (const v of [].concat(req.query['platform[]']        || [])) feedUrl += `&platform[]=${encodeURIComponent(v)}`;
  for (const v of [].concat(req.query['conversion_type[]'] || [])) feedUrl += `&conversion_type[]=${encodeURIComponent(v)}`;

  try {
    const response = await fetch(feedUrl);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn Static Feed API.' });
  }
});

app.get('/api/revenue', async (req, res) => {
  const apiKey = String(req.query.apiKey || '').trim() || REVENUE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ status: 'error', message: 'No API key provided. Enter one in the form or set REVENUE_API_KEY on the server.' });
  }

  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) {
    return res.status(400).json({ status: 'error', message: 'start_date and end_date are required.' });
  }

  let url = `${PRIMEEARN_BASE_URL}/api/v1/reporting/daily?start_date=${encodeURIComponent(start_date)}&end_date=${encodeURIComponent(end_date)}`;
  for (const v of [].concat(req.query['group_by[]']  || [])) url += `&group_by[]=${encodeURIComponent(v)}`;
  for (const v of [].concat(req.query['app[]']       || [])) url += `&app[]=${encodeURIComponent(v)}`;
  for (const v of [].concat(req.query['country[]']   || [])) url += `&country[]=${encodeURIComponent(v)}`;
  for (const v of [].concat(req.query['product[]']   || [])) url += `&product[]=${encodeURIComponent(v)}`;
  for (const v of [].concat(req.query['offer_id[]']  || [])) url += `&offer_id[]=${encodeURIComponent(v)}`;

  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json({ ...data, _debug_url: url });
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn Revenue API.' });
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
