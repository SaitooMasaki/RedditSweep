'use strict';

const PURCHASE_URL = 'https://saitoomasaki.lemonsqueezy.com/checkout/buy/f7a5c480-76ff-4de3-9e1a-49d88b99f232';
const FREE_LIMIT = 50;

async function loadState() {
  return chrome.storage.local.get([
    'isPro', 'dailyUsed', 'dailyDate', 'licenseKey', 'instanceId',
  ]);
}

// B-1: ローカル日付を使用
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function init() {
  const data = await loadState();
  const isPro = !!data.isPro;

  // Badge
  const badge = document.getElementById('plan-badge');
  badge.textContent = isPro ? 'PRO' : 'FREE';
  badge.className = `badge ${isPro ? 'badge-pro' : 'badge-free'}`;

  // Daily usage
  let dailyUsed = 0;
  if (data.dailyDate === todayStr()) {
    dailyUsed = data.dailyUsed || 0;
  }
  document.getElementById('quota-val').textContent = `${dailyUsed} / ${FREE_LIMIT}`;

  // Status — try to query the active tab's content script
  getContentScriptStatus().then(status => {
    const el = document.getElementById('status-val');
    if (status) {
      el.textContent = status.running ? 'Running' : 'Idle';
      if (status.running) el.classList.add('running');
    } else {
      el.textContent = 'Open Reddit';
    }
  });

  // Show/hide sections
  document.getElementById('free-section').style.display = isPro ? 'none' : '';
  document.getElementById('pro-section').style.display = isPro ? '' : 'none';
  document.getElementById('quota-row').style.display = isPro ? 'none' : '';

  // License activation
  document.getElementById('activate-btn')?.addEventListener('click', onActivate);

  // Deactivation
  document.getElementById('deactivate-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('deactivate-btn');
    btn.disabled = true;
    btn.textContent = '...';
    await chrome.runtime.sendMessage({
      action: 'deactivateLicense',
      key: data.licenseKey,
      instanceId: data.instanceId,
    });
    location.reload();
  });

  // Buy link
  const buyLink = document.getElementById('buy-link');
  if (buyLink) buyLink.href = PURCHASE_URL;
}

async function getContentScriptStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('reddit.com')) return null;
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }).catch(() => null);
    return resp;
  } catch {
    return null;
  }
}

async function onActivate() {
  const key = document.getElementById('license-input').value.trim();
  if (!key) return;

  const btn = document.getElementById('activate-btn');
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const result = await chrome.runtime.sendMessage({ action: 'validateLicense', key });
    if (result.ok) {
      showMsg('✓ Pro activated!', 'success');
      setTimeout(() => location.reload(), 1200);
    } else {
      showMsg(`✗ ${result.error || 'Invalid key'}`, 'error');
    }
  } catch {
    showMsg('✗ Could not connect. Try again.', 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Activate';
}

function showMsg(text, type) {
  const el = document.getElementById('license-msg');
  el.textContent = text;
  el.className = `msg-${type}`;
}

// S-2: statusUpdate リスナーは content.js が送信しないためデッドコードだったので削除。
// ステータスは init() 内の getContentScriptStatus() で開いたタイミングに1回取得する。

init();
