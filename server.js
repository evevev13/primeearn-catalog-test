import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

const APP_TOKEN = process.env.APP_TOKEN;
const APP_HASH = process.env.APP_HASH;
const PRIMEEARN_BASE_URL = 'https://partners.primeearn.com';

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return String(xff).split(',')[0].trim();
  }
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasToken: Boolean(APP_TOKEN),
    hasAppHash: Boolean(APP_HASH),
  });
});

function resolveCredentials(req) {
  const token = String(req.query.appToken || '').trim() || APP_TOKEN;
  const hash = String(req.query.appHash || '').trim() || APP_HASH;
  return { token, hash };
}

app.get('/api/offers', async (req, res) => {
  const { token, hash } = resolveCredentials(req);
  if (!token || !hash) {
    return res.status(500).json({
      status: 'error',
      message: 'Missing APP_TOKEN or APP_HASH in server environment.',
    });
  }

  const externalUserId = String(req.query.externalUserId || 'test_user_001');
  const platform = String(req.query.platform || 'web');

  let ip = String(req.query.ip || '').trim();
  if (!ip) {
    ip = getClientIp(req);
  }

  // Local dev addresses are not usable for targeting, so we fallback to public IP lookup.
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

  // Optional targeting params
  for (const param of ['maid', 'birthday', 'age', 'gender', 'zip', 'limit']) {
    const val = String(req.query[param] || '').trim();
    if (val) url.searchParams.set(param, val);
  }

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch {
    return res.status(502).json({
      status: 'error',
      message: 'Failed to reach PrimeEarn API.',
    });
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
    return res.status(500).json({
      status: 'error',
      message: 'Missing APP_TOKEN or APP_HASH in server environment.',
    });
  }

  const externalUserId = String(req.query.externalUserId || 'test_user_001');
  let ip = String(req.query.ip || '').trim();
  if (!ip) {
    ip = getClientIp(req);
  }

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

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch {
    return res.status(502).json({
      status: 'error',
      message: 'Failed to reach PrimeEarn API.',
    });
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

  for (const v of [].concat(req.query['countries[]']      || [])) url.searchParams.append('countries[]',      v);
  for (const v of [].concat(req.query['platform[]']       || [])) url.searchParams.append('platform[]',       v);
  for (const v of [].concat(req.query['conversion_type[]']|| [])) url.searchParams.append('conversion_type[]',v);

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch {
    return res.status(502).json({ status: 'error', message: 'Failed to reach PrimeEarn Static Feed API.' });
  }
});

// S2S postback receiver — logs all incoming GET/POST requests
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
