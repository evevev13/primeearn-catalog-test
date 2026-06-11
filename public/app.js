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
}

tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

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

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('postbackUrl').textContent = window.location.origin + '/postback';
  loadCatalog();
});
