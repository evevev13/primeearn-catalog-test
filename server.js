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

app.get('/api/offers', async (req, res) => {
  if (!APP_TOKEN || !APP_HASH) {
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

  const url = new URL(`${PRIMEEARN_BASE_URL}/${APP_TOKEN}/api/v1/offers`);
  url.searchParams.set('app', APP_HASH);
  url.searchParams.set('external_user_id', externalUserId);
  if (ip) url.searchParams.set('ip', ip);
  if (platform) url.searchParams.set('platform', platform);

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

app.get('/api/offers/:id', async (req, res) => {
  if (!APP_TOKEN || !APP_HASH) {
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

  const url = new URL(`${PRIMEEARN_BASE_URL}/${APP_TOKEN}/api/v1/offers/${encodeURIComponent(req.params.id)}`);
  url.searchParams.set('app', APP_HASH);
  url.searchParams.set('external_user_id', externalUserId);
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

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(port, () => {
  console.log(`PrimeEarn test app running on http://localhost:${port}`);
});
