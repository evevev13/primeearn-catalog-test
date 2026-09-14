const filtersForm = document.getElementById('filters');
const statusEl = document.getElementById('status');
const gridEl = document.getElementById('grid');
const offerTemplate = document.getElementById('offerCardTemplate');

// ── Tab switching ─────────────────────────────────────────────────────────────

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
let postbackPollTimer = null;

function switchTab(name) {
  tabBtns.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
  tabPanels.forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${name}`));
  if (name === 'postbacks') {
    startPostbackPolling();
  } else {
    stopPostbackPolling();
  }
  if (name === 'installed') {
    loadInstalled();
  }
  if (name === 'static-feed') {
    loadStaticFeed(staticCurrentPage);
  }
}

tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

function getCredentials() {
  const formData = new FormData(filtersForm);
  return {
    appToken: String(formData.get('appToken') || '').trim(),
    appHash: String(formData.get('appHash') || '').trim(),
  };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'error', message: text };
  }
}

function currencyFromReward(value) {
  if (value === null || value === undefined) return 'Reward unavailable';
  return `Reward: ${value}`;
}

function createTaskMarkup(rewards = []) {
  if (!Array.isArray(rewards) || rewards.length === 0) {
    return '<p class="task-empty">No task-level rewards returned.</p>';
  }
  return rewards
    .map((reward) => {
      const task = reward.task || 'Task';
      const amount = reward.reward_amount ?? 'N/A';
      const kind = reward.type || 'unknown';
      return `<p class="task">${task} - <strong>${amount}</strong> (${kind})</p>`;
    })
    .join('');
}

// ── Offer details ─────────────────────────────────────────────────────────────

async function loadOfferDetails(offerId, externalUserId, ip, detailsContainer, button) {
  button.disabled = true;
  button.textContent = 'Loading...';
  try {
    const params = new URLSearchParams({ externalUserId });
    if (ip) params.set('ip', ip);
    const { appToken, appHash } = getCredentials();
    if (appToken) params.set('appToken', appToken);
    if (appHash) params.set('appHash', appHash);

    updateCurlView('curlDetails', buildCurlCommand(`/api/v1/offers/${encodeURIComponent(offerId)}`, {
      external_user_id: externalUserId, ip,
    }));

    const response = await fetch(`/api/offers/${encodeURIComponent(offerId)}?${params.toString()}`);
    const payload = await readResponsePayload(response);
    updateOfferDetailsApiResponseView(payload);
    if (!response.ok) throw new Error(payload.message || 'Could not load details');
    const offer = payload.data || {};
    detailsContainer.innerHTML = createTaskMarkup(offer.rewards);
    detailsContainer.classList.add('open');
    button.textContent = 'Hide Reward Tasks';
    button.dataset.open = 'true';
  } catch (err) {
    detailsContainer.innerHTML = `<p class="task-empty">${err.message}</p>`;
    detailsContainer.classList.add('open');
    button.textContent = 'Show Reward Tasks';
    button.dataset.open = 'false';
  } finally {
    button.disabled = false;
  }
}

// ── Shared offer card renderer ────────────────────────────────────────────────

function populateOfferCard(clone, offer, externalUserId, ip, { installationTime } = {}) {
  const banner = clone.querySelector('.banner');
  const title = clone.querySelector('.title');
  const meta = clone.querySelector('.meta');
  const installTimeEl = clone.querySelector('.install-time');
  const reward = clone.querySelector('.reward');
  const playBtn = clone.querySelector('.play-btn');
  const detailsBtn = clone.querySelector('.details-btn');
  const detailsBox = clone.querySelector('.details');

  banner.src = offer.large_image_url || offer.icon || 'https://placehold.co/800x450?text=Offer';
  title.textContent = offer.title || offer.app_name || 'Untitled game';

  const rawPlatforms = offer.platforms ?? offer.platform ?? [];
  const platforms = Array.isArray(rawPlatforms)
    ? rawPlatforms.join(', ')
    : String(rawPlatforms || 'multi-platform');
  meta.textContent = `${offer.genre || 'Unknown genre'} - ${offer.sub_genre || 'General'} - ${platforms}`;

  if (installationTime && installTimeEl) {
    installTimeEl.textContent = `Installed: ${new Date(installationTime).toLocaleString()}`;
  }

  reward.textContent = currencyFromReward(offer.reward ?? offer.total_reward);

  const playUrl = offer.tracking_url || '#';
  playBtn.href = playUrl;
  if (!offer.tracking_url) {
    playBtn.textContent = 'Tracking URL not provided';
    playBtn.classList.add('disabled');
    playBtn.removeAttribute('target');
  }

  detailsBtn.addEventListener('click', async () => {
    const isOpen = detailsBtn.dataset.open === 'true';
    if (isOpen) {
      detailsBox.classList.remove('open');
      detailsBox.innerHTML = '';
      detailsBtn.dataset.open = 'false';
      detailsBtn.textContent = 'Show Reward Tasks';
      return;
    }
    await loadOfferDetails(offer.id, externalUserId, ip, detailsBox, detailsBtn);
  });
}

// ── Catalog tab ───────────────────────────────────────────────────────────────

function renderOffers(offers, externalUserId, ip) {
  gridEl.innerHTML = '';
  if (!offers.length) {
    gridEl.innerHTML = '<p class="empty">No offers returned for this user/context.</p>';
    return;
  }
  offers.forEach((offer) => {
    const clone = offerTemplate.content.cloneNode(true);
    populateOfferCard(clone, offer, externalUserId, ip);
    gridEl.appendChild(clone);
  });
}

// ── Curl tab ──────────────────────────────────────────────────────────────────

const PRIMEEARN_BASE = 'https://partners.primeearn.com';

function buildCurlCommand(path, queryParams) {
  const { appToken, appHash } = getCredentials();
  const token = appToken || '{APP_TOKEN}';
  const hash = appHash || '{APP_HASH}';

  const url = new URL(`${PRIMEEARN_BASE}/${token}${path}`);
  url.searchParams.set('app', hash);
  url.searchParams.set('output', 'API');
  for (const [k, v] of Object.entries(queryParams)) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
  }
  return `curl "${url.toString()}"`;
}

function updateCurlView(elementId, curl) {
  const el = document.getElementById(elementId);
  if (el) el.textContent = curl;
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.curl-copy-btn');
  if (!btn) return;
  const targetId = btn.dataset.target;
  const text = document.getElementById(targetId)?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
});

// ── API Response tab ──────────────────────────────────────────────────────────

function updateApiResponseView(payload) {
  document.getElementById('apiResponseJson').textContent = JSON.stringify(payload, null, 2);
}

function updateInstalledApiResponseView(payload) {
  document.getElementById('installedResponseJson').textContent = JSON.stringify(payload, null, 2);
}

function updateOfferDetailsApiResponseView(payload) {
  document.getElementById('offerDetailsResponseJson').textContent = JSON.stringify(payload, null, 2);
}

// ── Load catalog ──────────────────────────────────────────────────────────────

async function loadCatalog(evt) {
  evt?.preventDefault();

  const formData = new FormData(filtersForm);
  const externalUserId = String(formData.get('externalUserId') || '').trim();
  const platform = String(formData.get('platform') || 'web').trim();
  const ip = String(formData.get('ip') || '').trim();

  const maid = String(formData.get('maid') || '').trim();
  const birthday = String(formData.get('birthday') || '').trim();
  const age = String(formData.get('age') || '').trim();
  const gender = String(formData.get('gender') || '').trim();
  const zip = String(formData.get('zip') || '').trim();
  const limit = String(formData.get('limit') || '').trim();

  if (!externalUserId) {
    setStatus('Please enter a user ID.', true);
    return;
  }

  setStatus('Loading offers...');
  document.getElementById('loadBtn').disabled = true;

  try {
    const params = new URLSearchParams({ externalUserId, platform });
    if (ip) params.set('ip', ip);
    if (maid) params.set('maid', maid);
    if (birthday) params.set('birthday', birthday);
    if (age) params.set('age', age);
    if (gender) params.set('gender', gender);
    if (zip) params.set('zip', zip);
    if (limit) params.set('limit', limit);
    const { appToken, appHash } = getCredentials();
    if (appToken) params.set('appToken', appToken);
    if (appHash) params.set('appHash', appHash);

    updateCurlView('curlOffers', buildCurlCommand('/api/v1/offers', {
      external_user_id: externalUserId, platform, ip, maid, birthday, age, gender, zip, limit,
    }));

    const response = await fetch(`/api/offers?${params.toString()}`);
    const payload = await readResponsePayload(response);
    updateApiResponseView(payload);

    if (!response.ok) throw new Error(payload.message || 'Catalog request failed');

    const offers = Array.isArray(payload.data) ? payload.data : [];
    renderOffers(offers, externalUserId, ip);
    setStatus(`Loaded ${offers.length} offer(s).`);
  } catch (err) {
    gridEl.innerHTML = '';
    setStatus(err.message, true);
  } finally {
    document.getElementById('loadBtn').disabled = false;
  }
}

filtersForm.addEventListener('submit', loadCatalog);

// ── Installed tab ─────────────────────────────────────────────────────────────

async function loadInstalled() {
  const countEl = document.getElementById('installedCount');
  const installedGrid = document.getElementById('installedGrid');

  const formData = new FormData(filtersForm);
  const externalUserId = String(formData.get('externalUserId') || '').trim() || 'test_user_001';
  const ip = String(formData.get('ip') || '').trim();

  countEl.textContent = 'Loading…';
  installedGrid.innerHTML = '';

  try {
    const params = new URLSearchParams({ externalUserId });
    if (ip) params.set('ip', ip);
    const { appToken, appHash } = getCredentials();
    if (appToken) params.set('appToken', appToken);
    if (appHash) params.set('appHash', appHash);

    updateCurlView('curlActive', buildCurlCommand('/api/v1/offers/active', {
      external_user_id: externalUserId, ip,
    }));

    const response = await fetch(`/api/offers/active?${params.toString()}`);
    const payload = await readResponsePayload(response);

    updateInstalledApiResponseView(payload);
    if (!response.ok) throw new Error(payload.message || 'Failed to load installed games');

    const offers = Array.isArray(payload.data) ? payload.data : [];
    countEl.textContent = `${offers.length} installed game${offers.length !== 1 ? 's' : ''}`;

    if (!offers.length) {
      installedGrid.innerHTML = '<p class="empty">No installed games for this user. Click "Play &amp; Earn" on any offer to get started.</p>';
      return;
    }

    offers.forEach((offer) => {
      const clone = offerTemplate.content.cloneNode(true);
      populateOfferCard(clone, offer, externalUserId, ip, { installationTime: offer.installation_time });
      installedGrid.appendChild(clone);
    });
  } catch (err) {
    installedGrid.innerHTML = `<p class="empty">${err.message}</p>`;
    countEl.textContent = '';
  }
}

document.getElementById('refreshInstalledBtn').addEventListener('click', loadInstalled);

// ── Static Feed tab ───────────────────────────────────────────────────────────

let staticCurrentPage = 1;
let staticHasNext = false;

function createEventMarkup(events = []) {
  if (!Array.isArray(events) || events.length === 0) {
    return '<p class="task-empty">No events returned.</p>';
  }
  return events
    .map((e) => {
      const label = e.name || 'Event';
      const revenue = e.revenue_usd != null ? `$${Number(e.revenue_usd).toFixed(2)}` : 'N/A';
      const points = e.points != null ? `${e.points} pts` : '';
      return `<p class="task">${label} — <strong>${revenue}</strong>${points ? ` / ${points}` : ''}</p>`;
    })
    .join('');
}

function renderStaticOffers(offers) {
  const grid = document.getElementById('staticGrid');
  grid.innerHTML = '';
  if (!offers.length) {
    grid.innerHTML = '<p class="empty">No offers returned for these filters.</p>';
    return;
  }
  offers.forEach((offer) => {
    const clone = offerTemplate.content.cloneNode(true);

    clone.querySelector('.banner').src = offer.large_image_url || offer.icon_url || 'https://placehold.co/800x450?text=Offer';
    clone.querySelector('.title').textContent = offer.name || 'Untitled';

    const countries = [...new Set((offer.geo_targets || []).map((g) => g.country_code))].join(', ') || 'All';
    const platforms = (offer.platforms || []).join(', ') || 'All';
    clone.querySelector('.meta').textContent = `${platforms} · ${countries} · Score: ${offer.score ?? '—'}`;
    clone.querySelector('.install-time').textContent = offer.cpi ? `CPI: $${offer.cpi}` : offer.revenue_usd ? `Revenue: $${Number(offer.revenue_usd).toFixed(2)}` : '';
    clone.querySelector('.reward').textContent = offer.points ? `Points: ${offer.points}` : '';

    const playBtn = clone.querySelector('.play-btn');
    playBtn.href = offer.tracking_url || '#';
    if (!offer.tracking_url) {
      playBtn.textContent = 'No tracking URL';
      playBtn.classList.add('disabled');
      playBtn.removeAttribute('target');
    }

    const detailsBtn = clone.querySelector('.details-btn');
    detailsBtn.textContent = 'Show Events';
    const detailsBox = clone.querySelector('.details');
    detailsBtn.addEventListener('click', () => {
      const isOpen = detailsBtn.dataset.open === 'true';
      if (isOpen) {
        detailsBox.classList.remove('open');
        detailsBox.innerHTML = '';
        detailsBtn.dataset.open = 'false';
        detailsBtn.textContent = 'Show Events';
      } else {
        detailsBox.innerHTML = createEventMarkup(offer.events);
        detailsBox.classList.add('open');
        detailsBtn.dataset.open = 'true';
        detailsBtn.textContent = 'Hide Events';
      }
    });

    grid.appendChild(clone);
  });
}

function buildStaticFeedCurl({ appToken, appHash, perPage, page, countries, platform, conversionType }) {
  const token = appToken || '{APP_TOKEN}';
  const hash = appHash || '{APP_HASH}';
  let url = `https://partners.primeearn.com/${token}/api/v1/offers/feed?app=${hash}`;
  if (perPage) url += `&per_page=${perPage}`;
  if (page && page !== '1') url += `&page=${page}`;
  if (platform) url += `&platform[]=${platform}`;
  if (conversionType) url += `&conversion_type[]=${conversionType}`;
  if (countries) {
    countries.split(',').map((c) => c.trim()).filter(Boolean).forEach((c) => { url += `&countries[]=${c}`; });
  }
  return `curl "${url}"`;
}

async function loadStaticFeed(page = 1) {
  const form = document.getElementById('staticFilters');
  const statusEl = document.getElementById('staticStatus');
  const countEl = document.getElementById('staticCount');
  const loadBtn = document.getElementById('loadStaticBtn');

  const formData = new FormData(form);
  const perPage = String(formData.get('per_page') || '20').trim();
  const countries = String(formData.get('countries') || '').trim();
  const platform = String(formData.get('platform') || '').trim();
  const conversionType = String(formData.get('conversion_type') || '').trim();
  const appToken = String(formData.get('appToken') || '').trim();
  const appHash = String(formData.get('appHash') || '').trim();

  const curl = buildStaticFeedCurl({ appToken, appHash, perPage, page: String(page), countries, platform, conversionType });
  updateCurlView('curlStaticFeed', curl);
  updateCurlView('curlStaticFeedInline', curl);

  statusEl.textContent = 'Loading…';
  statusEl.classList.remove('error');
  loadBtn.disabled = true;
  document.getElementById('staticPrevBtn').disabled = true;
  document.getElementById('staticNextBtn').disabled = true;

  try {
    const params = new URLSearchParams({ per_page: perPage, page: String(page) });
    if (appToken) params.set('appToken', appToken);
    if (appHash) params.set('appHash', appHash);
    if (platform) params.append('platform[]', platform);
    if (conversionType) params.append('conversion_type[]', conversionType);
    if (countries) {
      countries.split(',').map((c) => c.trim()).filter(Boolean).forEach((c) => params.append('countries[]', c));
    }

    const response = await fetch(`/api/static-feed?${params.toString()}`);
    const payload = await readResponsePayload(response);
    document.getElementById('staticResponseJson').textContent = JSON.stringify(payload, null, 2);

    if (!response.ok) throw new Error(payload.message || 'Static feed request failed');

    const offers = Array.isArray(payload.data) ? payload.data : [];
    staticCurrentPage = payload.metadata?.page ?? page;
    staticHasNext = Boolean(payload.metadata?.next);

    renderStaticOffers(offers);
    countEl.textContent = `${offers.length} offer(s) on page ${staticCurrentPage}`;
    document.getElementById('staticPageIndicator').textContent = `Page ${staticCurrentPage}`;
    statusEl.textContent = `Loaded ${offers.length} offer(s).`;

    document.getElementById('staticPrevBtn').disabled = staticCurrentPage <= 1;
    document.getElementById('staticNextBtn').disabled = !staticHasNext;
  } catch (err) {
    document.getElementById('staticGrid').innerHTML = '';
    statusEl.textContent = err.message;
    statusEl.classList.add('error');
    countEl.textContent = '';
  } finally {
    loadBtn.disabled = false;
  }
}

document.getElementById('staticFilters').addEventListener('submit', (e) => {
  e.preventDefault();
  staticCurrentPage = 1;
  loadStaticFeed(1);
});

document.getElementById('staticPrevBtn').addEventListener('click', () => loadStaticFeed(staticCurrentPage - 1));
document.getElementById('staticNextBtn').addEventListener('click', () => loadStaticFeed(staticCurrentPage + 1));

// ── S2S Postback log ──────────────────────────────────────────────────────────

async function fetchPostbackLogs() {
  try {
    const res = await fetch('/api/postback-logs');
    const data = await res.json();
    renderPostbackLogs(data.logs || [], data.serverStartTime);
  } catch {}
}

function renderPostbackLogs(logs, serverStartTime) {
  const countEl = document.getElementById('postbackCount');
  const logEl = document.getElementById('postbackLog');
  const uptimeEl = document.getElementById('serverStartTime');

  if (serverStartTime && uptimeEl) {
    uptimeEl.textContent = `Log started: ${new Date(serverStartTime).toLocaleString()} (resets on each deploy/restart)`;
  }

  if (!logs.length) {
    countEl.textContent = 'No postbacks received yet.';
    logEl.innerHTML = '<p class="empty">Waiting for incoming postbacks…</p>';
    return;
  }

  countEl.textContent = `${logs.length} postback${logs.length !== 1 ? 's' : ''} received`;

  logEl.innerHTML = logs
    .map((log) => {
      const params = { ...log.query, ...log.body };
      const hasParams = Object.keys(params).length > 0;
      const timeStr = new Date(log.timestamp).toLocaleString();
      return `<div class="postback-entry">
        <div class="postback-entry-header">
          <span class="postback-method ${log.method.toLowerCase()}">${log.method}</span>
          <span class="postback-time" title="${log.timestamp}">${timeStr}</span>
          <span class="postback-ip">${log.ip}</span>
        </div>
        <pre class="postback-params">${hasParams ? JSON.stringify(params, null, 2) : '(no parameters)'}</pre>
      </div>`;
    })
    .join('');
}

function startPostbackPolling() {
  if (postbackPollTimer) return;
  fetchPostbackLogs();
  postbackPollTimer = setInterval(fetchPostbackLogs, 3000);
}

function stopPostbackPolling() {
  clearInterval(postbackPollTimer);
  postbackPollTimer = null;
}

document.getElementById('testPostbackBtn').addEventListener('click', async () => {
  const externalUserId = document.getElementById('externalUserId').value || 'test_user_001';
  const params = new URLSearchParams({ source: 'ui_test', user: externalUserId, reward: '100', tx_id: `test-${Date.now()}` });
  await fetch(`/postback?${params.toString()}`);
  fetchPostbackLogs();
});

document.getElementById('clearPostbacksBtn').addEventListener('click', async () => {
  await fetch('/api/postback-logs', { method: 'DELETE' });
  fetchPostbackLogs();
});

// ── Script Test tab ───────────────────────────────────────────────────────────

function scriptTestConfig() {
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const appId        = val('stAppId');
  const userId       = val('stUserId') || 'test_user_001';
  const module       = val('stModule') || 'offers';
  const platform     = val('stPlatform');
  const layout       = val('stLayout');
  const columnQty    = parseInt(val('stColumnQty')) || 0;
  const limit        = parseInt(val('stLimit')) || 0;
  const primaryOn    = document.getElementById('stPrimaryColorEnabled')?.checked;
  const bgOn         = document.getElementById('stBgColorEnabled')?.checked;
  const primaryColor = primaryOn ? (val('stPrimaryColorHex') || val('stPrimaryColor')) : '';
  const bgColor      = bgOn     ? (val('stBgColorHex')      || val('stBgColor'))      : '';
  return { appId, userId, module, platform, layout, columnQty, limit, primaryColor, bgColor };
}

function buildScriptConfigDisplay(cfg) {
  const config = {
    container: '#primeearn-widget',
    appId: cfg.appId || '{APP_ID}',
    userId: cfg.userId,
    module: cfg.module,
  };
  if (cfg.platform) config.platform = cfg.platform;
  if (cfg.layout)   config.layout   = cfg.layout;
  if (cfg.columnQty > 0) config.columnQty = cfg.columnQty;
  if (cfg.limit > 0)     config.limit     = cfg.limit;
  if (cfg.primaryColor || cfg.bgColor) {
    config.customAppDesign = {};
    if (cfg.primaryColor) config.customAppDesign['--p-primary-500'] = cfg.primaryColor;
    if (cfg.bgColor)      config.customAppDesign['--ps-pages-bg']   = cfg.bgColor;
  }
  return `window.psConfig = ${JSON.stringify(config, null, 2)};`;
}

function buildScriptPreviewUrl(cfg) {
  const params = new URLSearchParams({ module: cfg.module, userId: cfg.userId });
  if (cfg.appId)       params.set('appId', cfg.appId);
  if (cfg.platform)    params.set('platform', cfg.platform);
  if (cfg.layout)      params.set('layout', cfg.layout);
  if (cfg.columnQty > 0) params.set('columnQty', String(cfg.columnQty));
  if (cfg.limit > 0)     params.set('limit', String(cfg.limit));
  if (cfg.primaryColor)  params.set('primaryColor', cfg.primaryColor);
  if (cfg.bgColor)       params.set('bgColor', cfg.bgColor);
  return `/script-preview?${params.toString()}`;
}

function syncColorHex(colorInputId, hexInputId) {
  const colorEl = document.getElementById(colorInputId);
  const hexEl   = document.getElementById(hexInputId);
  if (!colorEl || !hexEl) return;
  colorEl.addEventListener('input', () => { hexEl.value = colorEl.value; updateScriptCode(); });
  hexEl.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{3,8}$/.test(hexEl.value)) colorEl.value = hexEl.value;
    updateScriptCode();
  });
}

function updateScriptCode() {
  const cfg = scriptTestConfig();
  const el = document.getElementById('stGeneratedCode');
  if (el) el.textContent = buildScriptConfigDisplay(cfg);
}

function initScriptTestTab() {
  const form = document.getElementById('scriptConfigForm');
  if (!form) return;

  syncColorHex('stPrimaryColor', 'stPrimaryColorHex');
  syncColorHex('stBgColor', 'stBgColorHex');

  form.querySelectorAll('select, input[type=text], input[type=number], input[type=checkbox]').forEach((el) => {
    el.addEventListener('input', updateScriptCode);
    el.addEventListener('change', updateScriptCode);
  });

  updateScriptCode();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const cfg = scriptTestConfig();
    const frame = document.getElementById('stPreviewFrame');
    if (frame) frame.src = buildScriptPreviewUrl(cfg);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function initUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    const user = await res.json();
    const emailEl = document.getElementById('userEmail');
    if (emailEl) emailEl.textContent = user.name || user.email;
    if (user.isAdmin) {
      const logsLink = document.getElementById('logsLink');
      if (logsLink) logsLink.style.display = '';
    }
  } catch {
    window.location.href = '/login';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initUser();
  initScriptTestTab();
  document.getElementById('postbackUrl').textContent = window.location.origin + '/postback';
  loadCatalog();
});
