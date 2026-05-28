'use strict';

// ─── Daily reset alarm ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  scheduleDailyReset();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleDailyReset();
});

function scheduleDailyReset() {
  chrome.alarms.clear('dailyReset', () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const delayMinutes = (tomorrow.getTime() - now.getTime()) / 60_000;
    chrome.alarms.create('dailyReset', {
      delayInMinutes: delayMinutes,
      periodInMinutes: 1440,
    });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReset') {
    chrome.storage.local.set({ dailyUsed: 0, dailyDate: todayStr() });
  }
});

// B-1: ローカル日付を使用（Alarm のリセット時刻＝ローカル0時と一致させる）
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── License validation ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'validateLicense') {
    validateLicense(msg.key)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.action === 'deactivateLicense') {
    deactivateLicense(msg.key, msg.instanceId)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function getOrCreateInstanceId() {
  const data = await chrome.storage.local.get('instanceId');
  if (data.instanceId) return data.instanceId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ instanceId: id });
  return id;
}

async function validateLicense(key) {
  const instanceId = await getOrCreateInstanceId();

  // Try activation first
  let res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_name: `RedditSweep-${instanceId}` }),
  });
  let data = await res.json();

  // If already activated on this or another instance, fall back to validate
  if (!data.activated) {
    res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ license_key: key }),
    });
    data = await res.json();
    if (!data.valid) {
      return { ok: false, error: data.error || 'Invalid or expired license key.' };
    }
  }

  await chrome.storage.local.set({ licenseKey: key, isPro: true, instanceId });
  return { ok: true };
}

async function deactivateLicense(key, instanceId) {
  await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_id: instanceId }),
  }).catch(() => {});
  await chrome.storage.local.remove(['licenseKey', 'isPro']);
  return { ok: true };
}
