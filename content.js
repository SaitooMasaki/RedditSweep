'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  FREE_LIMIT: 50,
  PURCHASE_URL: 'https://saitoomasaki.lemonsqueezy.com/checkout/buy/f7a5c480-76ff-4de3-9e1a-49d88b99f232',
  MIN_DELAY_MS: 2_000,
  MAX_DELAY_MS: 3_000,
  RATE_LIMIT_WAIT_MS: 60_000,
  PANEL_ID: 'rs-panel',
};

// ─── Runtime state ────────────────────────────────────────────────────────────
let running = false;
let paused = false;
let abortFlag = false;
let isPro = false;
let modhash = null;
let username = null;
let queue = [];
let queueIdx = 0;
let dailyUsed = 0;
let filterType = 'comments'; // 'comments' | 'posts' | 'both'
let dateStart = null;
let dateEnd = null;
let overwriteFirst = false;
let pauseResolve = null;

// ─── Utilities ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randomDelay = () => CFG.MIN_DELAY_MS + Math.random() * (CFG.MAX_DELAY_MS - CFG.MIN_DELAY_MS);
// B-1: ローカル日付を使用（UTC日付だとJSTでは9:00にリセットされてしまう）
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const randomText = () =>
  Array.from({ length: 3 }, () => Math.random().toString(36).slice(2)).join(' ') + ' ' + Date.now();
const $ = sel => document.querySelector(sel);

// ─── Storage helpers ──────────────────────────────────────────────────────────
async function loadStorage() {
  const data = await chrome.storage.local.get([
    'isPro', 'dailyUsed', 'dailyDate', 'savedSession',
  ]);

  isPro = !!data.isPro;

  if (data.dailyDate !== todayStr()) {
    dailyUsed = 0;
    await chrome.storage.local.set({ dailyUsed: 0, dailyDate: todayStr() });
  } else {
    dailyUsed = data.dailyUsed || 0;
  }

  return data;
}

async function incDailyCount() {
  dailyUsed += 1;
  await chrome.storage.local.set({ dailyUsed, dailyDate: todayStr() });
}

async function saveSession() {
  await chrome.storage.local.set({
    savedSession: {
      queue,
      queueIdx,
      filterType,
      dateStart: dateStart ? dateStart.toISOString() : null,
      dateEnd: dateEnd ? dateEnd.toISOString() : null,
      overwriteFirst,
    },
  });
}

async function clearSession() {
  await chrome.storage.local.remove('savedSession');
}

// ─── Reddit API ───────────────────────────────────────────────────────────────
async function redditPost(endpoint, params) {
  if (!modhash) modhash = await fetchModhash();

  const body = new URLSearchParams({ ...params, uh: modhash, api_type: 'json' });
  const res = await fetch(`https://www.reddit.com${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-modhash': modhash,
    },
    body,
  });

  if (res.status === 401) {
    // B-3: modhash失効 → 再取得してから呼び出し元に再試行を促す
    modhash = await fetchModhash();
    throw { type: 'AUTH_EXPIRED' };
  }
  if (res.status === 429) throw { type: 'RATE_LIMIT' };
  if (res.status === 403) throw { type: 'FORBIDDEN' };
  if (res.status === 404) throw { type: 'NOT_FOUND' };
  return res;
}

async function fetchModhash() {
  const res = await fetch('https://www.reddit.com/api/me.json', { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.modhash || null;
}

async function fetchUsername() {
  const res = await fetch('https://www.reddit.com/api/me.json', { credentials: 'include' });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.name || null;
}

async function fetchListingPage(endpoint, after) {
  let url = `https://www.reddit.com${endpoint}.json?limit=100&raw_json=1`;
  if (after) url += `&after=${encodeURIComponent(after)}`;

  const res = await fetch(url, { credentials: 'include' });
  if (res.status === 429) throw { type: 'RATE_LIMIT' };
  if (res.status === 404) throw { type: 'NOT_FOUND' };
  if (!res.ok) throw { type: 'API_ERROR', status: res.status };
  return res.json();
}

async function apiEditItem(fullname, text) {
  await redditPost('/api/editusertext', { thing_id: fullname, text });
}

async function apiDeleteItem(fullname) {
  await redditPost('/api/del', { id: fullname });
}

// ─── Queue building ───────────────────────────────────────────────────────────
async function buildQueue() {
  queue = [];
  queueIdx = 0;

  const endpoints = [];
  if (filterType === 'comments' || filterType === 'both') {
    endpoints.push(`/user/${username}/comments`);
  }
  if (isPro && (filterType === 'posts' || filterType === 'both')) {
    endpoints.push(`/user/${username}/submitted`);
  }

  setStatus('Scanning your history...');
  updateProgress();

  for (const ep of endpoints) {
    let after = null;
    let pageNum = 0;

    while (true) {
      let data;
      try {
        data = await fetchListingPage(ep, after);
      } catch (e) {
        if (e.type === 'RATE_LIMIT') {
          await waitRateLimit();
          data = await fetchListingPage(ep, after);
        } else if (e.type === 'NOT_FOUND') {
          break;
        } else {
          throw e;
        }
      }

      const children = data?.data?.children || [];
      for (const child of children) {
        const d = child.data;
        if (!d) continue;

        // Pro date filter
        if (isPro) {
          const created = new Date(d.created_utc * 1_000);
          if (dateStart && created < dateStart) continue;
          if (dateEnd && created > dateEnd) continue;
        }

        queue.push({
          id: d.name,
          type: child.kind === 't1' ? 'comment' : 'post',
          isSelf: !!d.is_self,
          subreddit: d.subreddit,
          created: d.created_utc,
        });
      }

      after = data?.data?.after || null;
      pageNum++;
      setStatus(`Scanning... ${queue.length} items found`);
      updateProgress();

      if (!after || children.length === 0) break;
      await sleep(300);
    }
  }

  updateProgress();
}

// ─── Deletion engine ──────────────────────────────────────────────────────────
async function runDeletion() {
  running = true;
  paused = false;
  abortFlag = false;
  updateUI();

  while (queueIdx < queue.length) {
    if (abortFlag) break;

    if (paused) {
      setStatus('Paused');
      updateUI();
      await saveSession();
      await new Promise(r => { pauseResolve = r; });
      setStatus('Resuming...');
      updateUI();
    }

    if (!isPro && dailyUsed >= CFG.FREE_LIMIT) {
      const remaining = queue.length - queueIdx;
      showLimitReached(remaining);
      await saveSession();
      break;
    }

    const item = queue[queueIdx];
    setStatus(`Deleting ${item.type} in r/${item.subreddit}...`);

    try {
      if (overwriteFirst && isPro && (item.type === 'comment' || item.isSelf)) {
        await withRateLimitRetry(() => apiEditItem(item.id, randomText()));
        await sleep(600);
      }

      await withRateLimitRetry(() => apiDeleteItem(item.id));

      queueIdx++;
      if (!isPro) await incDailyCount();
      updateProgress();

      if (queueIdx % 10 === 0) await saveSession();

    } catch (e) {
      if (e.type === 'NOT_FOUND' || e.type === 'FORBIDDEN') {
        // Already deleted or no permission — skip
        queueIdx++;
        continue;
      }
      setStatus(`Error: ${e.type || 'Unknown'}. Paused.`);
      paused = true;
      await saveSession();
      updateUI();
      await new Promise(r => { pauseResolve = r; });
      continue;
    }

    await sleep(randomDelay());
  }

  running = false;

  if (queueIdx >= queue.length && !abortFlag) {
    setStatus(`Done! Deleted ${queueIdx} item(s).`);
    await clearSession();
  }

  updateUI();
}

async function withRateLimitRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e.type === 'RATE_LIMIT') {
      await waitRateLimit();
      return await fn();
    }
    if (e.type === 'AUTH_EXPIRED') {
      // B-3: modhashは redditPost 内で再取得済み → そのまま1回リトライ
      return await fn();
    }
    throw e;
  }
}

async function waitRateLimit() {
  let secs = CFG.RATE_LIMIT_WAIT_MS / 1_000;
  const iv = setInterval(() => {
    secs--;
    setStatus(`Rate limited. Retrying in ${secs}s...`);
  }, 1_000);
  await sleep(CFG.RATE_LIMIT_WAIT_MS);
  clearInterval(iv);
}

// ─── Panel HTML ───────────────────────────────────────────────────────────────
function buildPanelHTML() {
  return `
<div id="${CFG.PANEL_ID}" class="rs-panel">
  <div class="rs-header">
    <div class="rs-title">
      <svg class="rs-icon-broom" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 21l9-9m0 0l4.5-4.5M12 12l-4.5-4.5M16.5 7.5L21 3M9 15l-6 6"/>
      </svg>
      <span>RedditSweep</span>
    </div>
    <div class="rs-header-actions">
      <span id="rs-badge" class="rs-badge rs-badge-free">FREE</span>
      <button id="rs-minimize-btn" class="rs-icon-btn" title="Minimize">–</button>
      <button id="rs-close-btn" class="rs-icon-btn" title="Close">✕</button>
    </div>
  </div>

  <div id="rs-body">

    <!-- Delete type selector -->
    <div class="rs-section">
      <div class="rs-field-label">Delete target</div>
      <div class="rs-radio-group">
        <label class="rs-radio-label">
          <input type="radio" name="rs-filter" value="comments" checked>
          Comments only
        </label>
        <label class="rs-radio-label rs-pro-gate">
          <input type="radio" name="rs-filter" value="posts" disabled>
          Posts only
          <span class="rs-pro-chip">PRO</span>
        </label>
        <label class="rs-radio-label rs-pro-gate">
          <input type="radio" name="rs-filter" value="both" disabled>
          Both
          <span class="rs-pro-chip">PRO</span>
        </label>
      </div>
    </div>

    <!-- Pro options (hidden for free) -->
    <div id="rs-pro-options" class="rs-section" style="display:none">
      <div class="rs-field-label">Date range <span class="rs-muted">(optional)</span></div>
      <div class="rs-date-row">
        <input type="date" id="rs-date-start" class="rs-input" placeholder="From">
        <span class="rs-date-sep">–</span>
        <input type="date" id="rs-date-end" class="rs-input" placeholder="To">
      </div>
      <label class="rs-checkbox-label">
        <input type="checkbox" id="rs-overwrite-check">
        Overwrite content before delete
      </label>
    </div>

    <!-- Saved session resume -->
    <div id="rs-resume-banner" class="rs-section rs-resume-banner" style="display:none">
      <span>⚡ Previous session found.</span>
      <button id="rs-resume-prev-btn" class="rs-btn rs-btn-xs">Resume</button>
    </div>

    <!-- Progress -->
    <div class="rs-section">
      <div id="rs-status-text" class="rs-status-text">Ready — click Start to scan your history.</div>
      <div class="rs-progress-track">
        <div id="rs-progress-fill" class="rs-progress-fill" style="width:0%"></div>
      </div>
      <div class="rs-progress-meta">
        <span><strong id="rs-done-count">0</strong> deleted</span>
        <span><strong id="rs-total-count">–</strong> total</span>
      </div>
    </div>

    <!-- Free quota info -->
    <div id="rs-quota-row" class="rs-section rs-quota-row">
      Free today: <strong id="rs-daily-used">0</strong> / ${CFG.FREE_LIMIT}
      <div class="rs-quota-mini-bar">
        <div id="rs-quota-fill" class="rs-quota-fill" style="width:0%"></div>
      </div>
    </div>

    <!-- Limit reached CTA -->
    <div id="rs-limit-cta" class="rs-section rs-limit-cta" style="display:none">
      <div class="rs-limit-text">
        Today's free limit (${CFG.FREE_LIMIT}) used. <strong id="rs-items-left">0</strong> items remaining.
      </div>
      <a href="${CFG.PURCHASE_URL}" target="_blank" rel="noopener" class="rs-upgrade-btn">
        ¥600で無制限に →
      </a>
    </div>

    <!-- Action buttons -->
    <div class="rs-actions">
      <button id="rs-start-btn" class="rs-btn rs-btn-primary">Start</button>
      <button id="rs-pause-btn" class="rs-btn rs-btn-secondary" style="display:none">Pause</button>
      <button id="rs-stop-btn"  class="rs-btn rs-btn-danger"    style="display:none">Stop</button>
    </div>

    <!-- License key -->
    <div id="rs-license-area" class="rs-section rs-license-area">
      <div class="rs-field-label">Have a license key?</div>
      <div class="rs-license-row">
        <input type="text" id="rs-license-input" class="rs-input rs-license-input"
               placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false">
        <button id="rs-activate-btn" class="rs-btn rs-btn-xs rs-btn-accent">Activate</button>
      </div>
      <div id="rs-license-msg" class="rs-license-msg"></div>
    </div>

  </div>
</div>
`;
}

// ─── Panel events ─────────────────────────────────────────────────────────────
function bindPanelEvents() {
  // Header controls
  $('#rs-close-btn').onclick = () => {
    userClosed = true; // S-3: 意図的に閉じたのでSPA遷移でも復活させない
    document.getElementById(CFG.PANEL_ID)?.remove();
  };

  let minimized = false;
  $('#rs-minimize-btn').onclick = () => {
    minimized = !minimized;
    $('#rs-body').style.display = minimized ? 'none' : '';
    $('#rs-minimize-btn').textContent = minimized ? '□' : '–';
  };

  // Filter radios
  document.querySelectorAll('input[name="rs-filter"]').forEach(r => {
    r.addEventListener('change', () => { filterType = r.value; });
  });

  // Pro option controls
  $('#rs-date-start')?.addEventListener('change', e => {
    dateStart = e.target.value ? new Date(e.target.value + 'T00:00:00') : null;
  });
  $('#rs-date-end')?.addEventListener('change', e => {
    dateEnd = e.target.value ? new Date(e.target.value + 'T23:59:59') : null;
  });
  $('#rs-overwrite-check')?.addEventListener('change', e => {
    overwriteFirst = e.target.checked;
  });

  // Action buttons
  $('#rs-start-btn').onclick = onStart;
  $('#rs-pause-btn').onclick = onPause;
  $('#rs-stop-btn').onclick = onStop;

  // Resume previous session
  $('#rs-resume-prev-btn')?.addEventListener('click', onResumePreviousSession);

  // License activation
  $('#rs-activate-btn').onclick = onActivate;
}

async function onStart() {
  if (running) return;

  // Ensure auth info
  if (!username) username = await fetchUsername();
  if (!username) { setStatus('Please log in to Reddit first.'); return; }
  if (!modhash)  modhash = await fetchModhash();
  if (!modhash)  { setStatus('Auth failed. Please refresh the page.'); return; }

  $('#rs-limit-cta').style.display = 'none';

  await buildQueue();

  if (queue.length === 0) {
    setStatus('No items found matching your filters.');
    return;
  }

  await runDeletion();
}

function onPause() {
  if (!running) return;
  if (paused) {
    paused = false;
    pauseResolve?.();
    pauseResolve = null;
  } else {
    paused = true;
  }
  updateUI();
}

function onStop() {
  abortFlag = true;
  paused = false;
  pauseResolve?.();
  pauseResolve = null;
  running = false;
  setStatus('Stopped.');
  updateUI();
}

async function onActivate() {
  const key = $('#rs-license-input')?.value.trim();
  if (!key) return;

  const btn = $('#rs-activate-btn');
  btn.disabled = true;
  btn.textContent = '...';
  $('#rs-license-msg').textContent = '';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'validateLicense', key });
    if (result.ok) {
      isPro = true;
      showLicenseMsg('✓ Pro activated! All limits removed.', 'success');
      refreshUIForProStatus();
    } else {
      showLicenseMsg(`✗ ${result.error || 'Invalid key'}`, 'error');
    }
  } catch (e) {
    showLicenseMsg('✗ Could not connect. Try again.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Activate';
}

async function onResumePreviousSession() {
  const data = await chrome.storage.local.get('savedSession');
  const s = data.savedSession;
  if (!s) return;

  queue = s.queue || [];
  queueIdx = s.queueIdx || 0;
  filterType = s.filterType || 'comments';
  dateStart = s.dateStart ? new Date(s.dateStart) : null;
  dateEnd = s.dateEnd ? new Date(s.dateEnd) : null;
  overwriteFirst = !!s.overwriteFirst;

  $('#rs-resume-banner').style.display = 'none';

  if (!username) username = await fetchUsername();
  if (!modhash)  modhash = await fetchModhash();

  await runDeletion();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(msg) {
  const el = $('#rs-status-text');
  if (el) el.textContent = msg;
}

function updateProgress() {
  const total = queue.length;
  const done  = queueIdx;
  const pct   = total > 0 ? (done / total) * 100 : 0;

  const fill = $('#rs-progress-fill');
  if (fill) fill.style.width = `${pct.toFixed(1)}%`;

  const dc = $('#rs-done-count');
  if (dc) dc.textContent = done;

  const tc = $('#rs-total-count');
  if (tc) tc.textContent = total > 0 ? total : '–';

  const du = $('#rs-daily-used');
  if (du) du.textContent = dailyUsed;

  const qf = $('#rs-quota-fill');
  if (qf) qf.style.width = `${Math.min((dailyUsed / CFG.FREE_LIMIT) * 100, 100)}%`;
}

function updateUI() {
  const startBtn = $('#rs-start-btn');
  const pauseBtn = $('#rs-pause-btn');
  const stopBtn  = $('#rs-stop-btn');

  if (running) {
    startBtn && (startBtn.style.display = 'none');
    pauseBtn && (pauseBtn.style.display = '');
    stopBtn  && (stopBtn.style.display  = '');
    if (pauseBtn) pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  } else {
    startBtn && (startBtn.style.display = '');
    pauseBtn && (pauseBtn.style.display = 'none');
    stopBtn  && (stopBtn.style.display  = 'none');
  }

  updateProgress();
}

function refreshUIForProStatus() {
  const badge = $('#rs-badge');
  if (badge) {
    badge.textContent = isPro ? 'PRO' : 'FREE';
    badge.className = `rs-badge ${isPro ? 'rs-badge-pro' : 'rs-badge-free'}`;
  }

  document.querySelectorAll('.rs-pro-gate input').forEach(r => {
    r.disabled = !isPro;
  });

  const proOpts = $('#rs-pro-options');
  if (proOpts) proOpts.style.display = isPro ? '' : 'none';

  const licArea = $('#rs-license-area');
  if (licArea) licArea.style.display = isPro ? 'none' : '';

  const quotaRow = $('#rs-quota-row');
  if (quotaRow) quotaRow.style.display = isPro ? 'none' : '';
}

function showLimitReached(remaining) {
  const cta = $('#rs-limit-cta');
  if (cta) cta.style.display = '';
  const il = $('#rs-items-left');
  if (il) il.textContent = remaining;
  setStatus(`Free limit (${CFG.FREE_LIMIT}/day) reached.`);
}

function showLicenseMsg(text, type) {
  const el = $('#rs-license-msg');
  if (!el) return;
  el.textContent = text;
  el.className = `rs-license-msg rs-license-msg-${type}`;
}

// ─── Panel injection ──────────────────────────────────────────────────────────
let userClosed = false; // S-3: ユーザーが×で閉じた場合はSPA遷移でも再表示しない

function injectPanel() {
  if (document.getElementById(CFG.PANEL_ID)) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = buildPanelHTML();
  document.body.appendChild(tmp.firstElementChild);
  bindPanelEvents();
  refreshUIForProStatus();
  updateProgress();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (document.getElementById(CFG.PANEL_ID)) return;

  const data = await loadStorage();
  injectPanel();

  // Show resume banner if there is a saved session
  if (data.savedSession && data.savedSession.queue?.length > 0) {
    const banner = $('#rs-resume-banner');
    if (banner) banner.style.display = '';
  }

  // Keep panel alive through Reddit's SPA navigations
  // S-3: userClosed=true の場合は再注入しない（ユーザーが意図的に閉じた）
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (!userClosed && !document.getElementById(CFG.PANEL_ID)) {
        injectPanel();
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// B-2: popup.js からの getStatus リクエストに応答する
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getStatus') {
    sendResponse({
      running,
      paused,
      dailyUsed,
      total: queue.length,
      done: queueIdx,
    });
    return true;
  }
});

init();
