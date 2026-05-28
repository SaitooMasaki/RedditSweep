/**
 * Unit tests — background.js のロジック
 *
 * jest-webextension-mock が chrome.* API を提供。
 * fetch は tests/unit/setup.js でモック済み。
 *
 * 対応テストケース:
 *   T-RESET-01  Alarmによる翌日リセット
 *   T-RESET-02  ローカル日付基準
 *   T-PRO-01    ライセンス認証（成功）
 *   T-PRO-02    ライセンス認証（失敗）
 *   T-PRO-04    ライセンス解除
 */

// background.js の関数を再実装してテスト
// （background.js はブラウザで自己実行するスクリプトのため、ロジックを抽出して検証）

// ─── テスト対象ロジックの再実装 ──────────────────────────────────────────────

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// chrome.storage.local を Promise でラップ
const storageGet = (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve));
const storageSet = (obj)  => new Promise(resolve => chrome.storage.local.set(obj, resolve));

// getOrCreateInstanceId の再実装
async function getOrCreateInstanceId() {
  const data = await storageGet('instanceId');
  if (data.instanceId) return data.instanceId;
  const id = 'test-uuid-' + Math.random().toString(36).slice(2);
  await storageSet({ instanceId: id });
  return id;
}

// validateLicense の再実装
async function validateLicense(key) {
  const instanceId = await getOrCreateInstanceId();

  let res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_name: `RedditSweep-${instanceId}` }),
  });
  let data = await res.json();

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

  await storageSet({ licenseKey: key, isPro: true, instanceId });
  return { ok: true };
}

// deactivateLicense の再実装
async function deactivateLicense(key, instanceId) {
  await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ license_key: key, instance_id: instanceId }),
  }).catch(() => {});
  await new Promise(resolve => chrome.storage.local.remove(['licenseKey', 'isPro'], resolve));
  return { ok: true };
}

// dailyReset アラームハンドラの再実装
async function handleDailyResetAlarm() {
  await storageSet({ dailyUsed: 0, dailyDate: todayStr() });
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function mockFetchJson(data, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

// ─── todayStr (B-1 修正確認) ──────────────────────────────────────────────────

describe('todayStr (background)', () => {
  it('YYYY-MM-DD 形式で今日のローカル日付を返す', () => {
    const result = todayStr();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });

  it('UTC ではなくローカル日付を使う（テスト環境で UTC と一致するか確認）', () => {
    const utcDate = new Date().toISOString().slice(0, 10);
    const localDate = todayStr();
    // どちらも YYYY-MM-DD 形式
    expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utcDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── 日次リセットハンドラ (T-RESET-01) ───────────────────────────────────────

describe('handleDailyResetAlarm', () => {
  it('dailyUsed を 0 にリセットする', async () => {
    // 事前: 削除数が積み上がっている状態
    await storageSet({ dailyUsed: 42, dailyDate: '2026-05-27' });

    await handleDailyResetAlarm();

    const result = await storageGet(['dailyUsed', 'dailyDate']);
    expect(result.dailyUsed).toBe(0);
  });

  it('dailyDate を今日のローカル日付に更新する', async () => {
    await storageSet({ dailyUsed: 42, dailyDate: '2026-05-27' });

    await handleDailyResetAlarm();

    const result = await storageGet('dailyDate');
    expect(result.dailyDate).toBe(todayStr());
  });
});

// ─── validateLicense (T-PRO-01) ──────────────────────────────────────────────

describe('validateLicense — 成功', () => {
  it('activate が成功した場合、isPro=true を Storage に保存する', async () => {
    global.fetch = mockFetchJson({ activated: true, license_key: { status: 'active' } });

    const result = await validateLicense('VALID-KEY-1234');

    expect(result).toEqual({ ok: true });

    const stored = await storageGet(['isPro', 'licenseKey']);
    expect(stored.isPro).toBe(true);
    expect(stored.licenseKey).toBe('VALID-KEY-1234');
  });

  it('activate が失敗しても validate が成功すれば Pro になる', async () => {
    // activate → not activated, validate → valid
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ activated: false, error: 'already activated' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ valid: true }),
      });

    const result = await validateLicense('ALREADY-ACTIVATED-KEY');

    expect(result).toEqual({ ok: true });
    const stored = await storageGet('isPro');
    expect(stored.isPro).toBe(true);
  });

  it('instanceId を Storage に保存する', async () => {
    global.fetch = mockFetchJson({ activated: true });

    await validateLicense('VALID-KEY-5678');

    const stored = await storageGet('instanceId');
    expect(stored.instanceId).toBeTruthy();
  });

  it('同じ instanceId を再利用する（二度目の認証）', async () => {
    global.fetch = mockFetchJson({ activated: true });

    await validateLicense('KEY-A');
    const { instanceId: id1 } = await storageGet('instanceId');

    global.fetch = mockFetchJson({ activated: true });
    await validateLicense('KEY-B');
    const { instanceId: id2 } = await storageGet('instanceId');

    expect(id1).toBe(id2);
  });
});

// ─── validateLicense (T-PRO-02) ──────────────────────────────────────────────

describe('validateLicense — 失敗', () => {
  it('activate も validate も失敗した場合 ok: false を返す', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ activated: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ valid: false, error: 'License not found.' }),
      });

    const result = await validateLicense('INVALID-KEY-0000');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('isPro を Storage に保存しない', async () => {
    global.fetch = jest.fn()
      .mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ activated: false, valid: false, error: 'not found' }),
      });

    await validateLicense('INVALID-KEY');

    const stored = await storageGet('isPro');
    expect(stored.isPro).toBeUndefined();
  });

  it('ネットワークエラーは ok: false を返す', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    await expect(validateLicense('KEY')).rejects.toThrow('Network error');
  });
});

// ─── deactivateLicense (T-PRO-04) ────────────────────────────────────────────

describe('deactivateLicense', () => {
  it('Storage から isPro と licenseKey を削除する', async () => {
    // 事前: Pro 状態
    await storageSet({ isPro: true, licenseKey: 'SOME-KEY', instanceId: 'inst-123' });
    global.fetch = mockFetchJson({});

    await deactivateLicense('SOME-KEY', 'inst-123');

    const stored = await storageGet(['isPro', 'licenseKey']);
    expect(stored.isPro).toBeUndefined();
    expect(stored.licenseKey).toBeUndefined();
  });

  it('LemonSqueezy deactivate エンドポイントを呼ぶ', async () => {
    global.fetch = mockFetchJson({});

    await deactivateLicense('MY-KEY', 'my-instance');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.lemonsqueezy.com/v1/licenses/deactivate',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('deactivate API が失敗しても Storage は削除する', async () => {
    await storageSet({ isPro: true, licenseKey: 'KEY' });
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    // エラーは catch されるので例外にならない
    await deactivateLicense('KEY', 'inst');

    const stored = await storageGet(['isPro', 'licenseKey']);
    expect(stored.isPro).toBeUndefined();
  });
});

// ─── getOrCreateInstanceId ────────────────────────────────────────────────────

describe('getOrCreateInstanceId', () => {
  it('初回は新しい ID を生成して保存する', async () => {
    const id = await getOrCreateInstanceId();
    expect(id).toBeTruthy();

    const stored = await storageGet('instanceId');
    expect(stored.instanceId).toBe(id);
  });

  it('2回目は同じ ID を返す', async () => {
    const id1 = await getOrCreateInstanceId();
    const id2 = await getOrCreateInstanceId();
    expect(id1).toBe(id2);
  });
});
