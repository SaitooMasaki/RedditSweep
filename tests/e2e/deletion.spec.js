/**
 * E2E テスト — 削除エンジン・レート制限・無料制限
 *
 * 対応テストケース:
 *   T-FREE-01  コメント削除（基本動作）
 *   T-FREE-03  1日50件制限 + CTA 表示
 *   T-DEL-01   削除間隔 2〜3秒
 *   T-DEL-02   404 スキップ
 *   T-RATE-01  429 レート制限 + カウントダウン
 *   T-ERR-02   0件の場合
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

test.beforeEach(async () => {
  page = await context.newPage();
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  await setExtensionStorage(context, { isPro: false, dailyUsed: 0, dailyDate: today });
});

test.afterEach(async () => {
  await page.close();
});

// ─── T-FREE-01: コメント削除（基本動作） ─────────────────────────────────────

test('T-FREE-01: スキャン後に正しいアイテム数が表示される', async () => {
  const comments = [mockComment('a1'), mockComment('a2'), mockComment('a3')];
  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 全件削除完了を待つ
  await expect(page.locator('#rs-status-text')).toContainText('Done', { timeout: 30_000 });

  // 3件削除されたことを確認
  await expect(page.locator('#rs-done-count')).toHaveText('3');
  await expect(page.locator('#rs-total-count')).toHaveText('3');
});

test('T-FREE-01: 削除 API (api/del) が正しく呼ばれる', async () => {
  const comments = [mockComment('b1'), mockComment('b2')];
  const deletedIds = [];

  await setupRedditMocks(context, { comments });

  // Fix: page.route() はコンテキストルートより優先されるため登録順序に依存しない
  await page.route('**/api/del', async route => {
    const postData = route.request().postData() || '';
    const id = new URLSearchParams(postData).get('id');
    if (id) deletedIds.push(id);
    await route.fulfill({ status: 200, body: JSON.stringify({ json: { errors: [] } }) });
  });

  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();
  await expect(page.locator('#rs-status-text')).toContainText('Done', { timeout: 30_000 });

  expect(deletedIds).toContain('t1_b1');
  expect(deletedIds).toContain('t1_b2');
});

test('T-FREE-01: dailyUsed が Storage に正しく積み上がる', async () => {
  const comments = [mockComment('c1'), mockComment('c2')];
  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();
  await expect(page.locator('#rs-status-text')).toContainText('Done', { timeout: 30_000 });

  const stored = await getExtensionStorage(context, 'dailyUsed');
  expect(stored?.dailyUsed).toBe(2);
});

// ─── T-FREE-03: 50件制限 + CTA 表示 ──────────────────────────────────────────

test('T-FREE-03: dailyUsed=49 の状態で1件削除後に上限 CTA が表示される', async () => {
  // すでに49件使用済みの状態を設定
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  })();
  await setExtensionStorage(context, { dailyUsed: 49, dailyDate: today });

  // コメントを5件用意（1件だけ削除されて停止するはず）
  const comments = Array.from({ length: 5 }, (_, i) => mockComment(`lim${i}`));
  await setupRedditMocks(context, { comments });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 上限 CTA が表示されるまで待つ
  await expect(page.locator('#rs-limit-cta')).toBeVisible({ timeout: 30_000 });

  // 残件数が表示されていることを確認（4件 = 5件 - 1件削除）
  await expect(page.locator('#rs-items-left')).toHaveText('4');

  // 購入リンクが表示されていることを確認
  await expect(page.locator('.rs-upgrade-btn')).toBeVisible();
  await expect(page.locator('.rs-upgrade-btn')).toContainText('¥600');
});

// ─── T-DEL-01: 削除間隔の確認 ───────────────────────────────────────────────

test('T-DEL-01: 削除リクエスト間隔が 2〜3 秒', async () => {
  const comments = [mockComment('int1'), mockComment('int2'), mockComment('int3')];
  const timestamps = [];

  await setupRedditMocks(context, { comments });

  // Fix: page.route() で優先的にインターセプト
  await page.route('**/api/del', async route => {
    timestamps.push(Date.now());
    await route.fulfill({ status: 200, body: JSON.stringify({ json: { errors: [] } }) });
  });

  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();
  await expect(page.locator('#rs-status-text')).toContainText('Done', { timeout: 30_000 });

  // 少なくとも2件以上削除された場合に間隔をチェック
  expect(timestamps.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < timestamps.length; i++) {
    const interval = timestamps[i] - timestamps[i - 1];
    expect(interval).toBeGreaterThanOrEqual(1_800); // 余裕を持たせて 1.8s 以上
    expect(interval).toBeLessThanOrEqual(3_500);    // 3.5s 以下
  }
}, 60_000); // タイムアウトを60秒に延長

// ─── T-DEL-02: 404 スキップ ──────────────────────────────────────────────────

test('T-DEL-02: 404 が返っても次のアイテムへスキップして継続する', async () => {
  const comments = [mockComment('skip1'), mockComment('skip2'), mockComment('skip3')];
  let callCount = 0;

  await setupRedditMocks(context, { comments });

  // Fix: page.route() で優先的にインターセプト（1件目のみ 404 を返す）
  await page.route('**/api/del', async route => {
    callCount++;
    const status = callCount === 1 ? 404 : 200;
    await route.fulfill({ status, body: JSON.stringify({ json: { errors: [] } }) });
  });

  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // エラーで止まらずに完了する
  await expect(page.locator('#rs-status-text')).toContainText('Done', { timeout: 30_000 });

  // 3件分のリクエストが出たことを確認
  expect(callCount).toBe(3);
});

// ─── T-RATE-01: 429 レート制限 ───────────────────────────────────────────────

test('T-RATE-01: 429 が返ったとき「Rate limited」のステータスが表示される', async () => {
  const comments = [mockComment('rate1')];
  let firstCall = true;

  await setupRedditMocks(context, { comments });

  // Fix: page.route() で優先的にインターセプト（1回目のみ 429 を返す）
  await page.route('**/api/del', async route => {
    if (firstCall) {
      firstCall = false;
      await route.fulfill({ status: 429, body: 'Too Many Requests' });
    } else {
      await route.fulfill({ status: 200, body: JSON.stringify({ json: { errors: [] } }) });
    }
  });

  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 「Rate limited」が表示されることを確認
  await expect(page.locator('#rs-status-text')).toContainText('Rate limited', { timeout: 10_000 });
  await expect(page.locator('#rs-status-text')).toContainText('Retrying in');
}, 30_000);

// ─── T-ERR-02: 0件のケース ───────────────────────────────────────────────────

test('T-ERR-02: コメントが 0 件の場合「No items found」が表示される', async () => {
  await setupRedditMocks(context, { comments: [] });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  await expect(page.locator('#rs-status-text')).toHaveText(
    'No items found matching your filters.',
    { timeout: 15_000 }
  );
});
