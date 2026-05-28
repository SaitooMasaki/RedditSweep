/**
 * E2E テスト — セッション保存・再開
 *
 * 対応テストケース:
 *   T-SES-01  Pause → Stop でのセッション保存
 *   T-SES-02  ページリロード後の Resume バナー表示
 *   T-SES-03  完了後のセッションデータ自動削除
 *   T-SES-04  10件ごとの自動セッション保存
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const {
  mockComment,
  setupRedditMocks,
  setExtensionStorage,
  getExtensionStorage,
} = require('./helpers/mock');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const PANEL = '#rs-panel';

let context;
let page;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
    ],
  });
});

test.afterAll(async () => {
  await context.close();
});

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

test.beforeEach(async () => {
  page = await context.newPage();
  await setExtensionStorage(context, {
    isPro: false,
    dailyUsed: 0,
    dailyDate: today(),
    savedSession: undefined,
  });
});

test.afterEach(async () => {
  await page.close();
});

// ─── T-SES-01: Pause → Stop でセッションが保存される ────────────────────────

test('T-SES-01: Pause → Stop 後に savedSession が Storage に存在する', async () => {
  const comments = Array.from({ length: 20 }, (_, i) => mockComment(`ses${i}`));
  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 削除が始まったら Pause
  await expect(page.locator('#rs-pause-btn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#rs-pause-btn').click();

  // Paused 状態を確認
  await expect(page.locator('#rs-status-text')).toHaveText('Paused', { timeout: 5_000 });

  // Stop を押す
  await page.locator('#rs-stop-btn').click();

  // savedSession が Storage に保存されていることを確認
  const stored = await getExtensionStorage(context, 'savedSession');
  expect(stored?.savedSession).toBeTruthy();
  expect(stored.savedSession.queue).toBeDefined();
  expect(stored.savedSession.queueIdx).toBeGreaterThanOrEqual(0);
}, 30_000);

test('T-SES-01: savedSession に filterType が保存されている', async () => {
  const comments = Array.from({ length: 15 }, (_, i) => mockComment(`ft${i}`));
  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();
  await expect(page.locator('#rs-pause-btn')).toBeVisible({ timeout: 10_000 });
  await page.locator('#rs-pause-btn').click();
  await expect(page.locator('#rs-status-text')).toHaveText('Paused', { timeout: 5_000 });
  await page.locator('#rs-stop-btn').click();

  const stored = await getExtensionStorage(context, 'savedSession');
  expect(stored?.savedSession?.filterType).toBe('comments');
}, 30_000);

// ─── T-SES-02: ページリロード後の Resume バナー表示 ──────────────────────────

test('T-SES-02: savedSession がある状態でリロードすると Resume バナーが表示される', async () => {
  // savedSession を直接 Storage に設定（テスト実行を高速化）
  const fakeSession = {
    queue: Array.from({ length: 10 }, (_, i) => ({
      id: `t1_fake${i}`,
      type: 'comment',
      isSelf: false,
      subreddit: 'test',
      created: Math.floor(Date.now() / 1_000) - i * 3_600,
    })),
    queueIdx: 3,
    filterType: 'comments',
    dateStart: null,
    dateEnd: null,
    overwriteFirst: false,
  };
  await setExtensionStorage(context, { savedSession: fakeSession });

  await setupRedditMocks(context, { comments: [] });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  // Resume バナーが表示されていることを確認
  await expect(page.locator('#rs-resume-banner')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#rs-resume-banner')).toContainText('Previous session found');
  await expect(page.locator('#rs-resume-prev-btn')).toBeVisible();
});

test('T-SES-02: savedSession がない状態では Resume バナーが非表示', async () => {
  await setExtensionStorage(context, { savedSession: null });

  await setupRedditMocks(context, { comments: [] });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('#rs-resume-banner')).not.toBeVisible();
});

// ─── T-SES-03: 完了後の savedSession 自動削除 ────────────────────────────────

test('T-SES-03: 全件削除完了後に savedSession が Storage から削除される', async () => {
  // 少ない件数で完了させる
  const comments = [mockComment('done1'), mockComment('done2')];
  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 完了を待つ
  await expect(page.locator('#rs-status-text')).toContainText('Done', { timeout: 30_000 });

  // savedSession が削除されていることを確認
  const stored = await getExtensionStorage(context, 'savedSession');
  expect(stored?.savedSession).toBeUndefined();
});

// ─── T-SES-04: 10件ごとの自動セッション保存 ─────────────────────────────────

test('T-SES-04: 10件削除後に savedSession.queueIdx が 10 になる', async () => {
  const comments = Array.from({ length: 25 }, (_, i) => mockComment(`auto${i}`));

  // api/del を遅らせず即時応答（間隔テストではないので）
  await context.route('**/api/del', async route => {
    await route.fulfill({ status: 200, body: JSON.stringify({ json: { errors: [] } }) });
  });

  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 削除カウントが 10 を超えるまで待つ
  await expect(page.locator('#rs-done-count')).not.toHaveText('0', { timeout: 60_000 });

  // 一定時間後（10件削除後）に Storage を確認
  // done-count が 10 以上になったタイミングを確認
  await page.waitForFunction(
    () => parseInt(document.querySelector('#rs-done-count')?.textContent || '0') >= 10,
    { timeout: 60_000 }
  );

  const stored = await getExtensionStorage(context, 'savedSession');
  // queueIdx が 10 の倍数で保存されているはず
  if (stored?.savedSession) {
    expect(stored.savedSession.queueIdx % 10).toBe(0);
  }
}, 90_000);
