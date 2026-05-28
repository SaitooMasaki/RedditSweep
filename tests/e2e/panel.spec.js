/**
 * E2E テスト — パネル表示・UI 操作
 *
 * 対応テストケース:
 *   T-INST-03  パネル表示
 *   T-INST-04  非Redditページでの非表示
 *   T-AUTH-01  未ログイン時の挙動
 *   T-FREE-02  投稿削除が無料版で選択不可
 *   T-PRO-01   ライセンス認証（成功）
 *   T-PRO-02   ライセンス認証（失敗）
 *   T-UI-01    ミニマイズ
 *   T-UI-02    ×で閉じた後のSPA非復活 (S-3)
 *   T-UI-04    Pause/Resume ボタン切り替え
 *   T-POPUP-02 ポップアップのステータス表示 (B-2)
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');
const {
  setupRedditMocks,
  setupLicenseMocks,
  setExtensionStorage,
} = require('./helpers/mock');

const EXTENSION_PATH = path.resolve(__dirname, '../../');
const PANEL = '#rs-panel';

// ─── Context fixture（拡張機能ロード済みブラウザ） ───────────────────────────

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
  // ストレージをリセット（各テストを独立させる）
  await setExtensionStorage(context, {
    isPro: false,
    dailyUsed: 0,
    dailyDate: (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })(),
  });
});

test.afterEach(async () => {
  await page.close();
});

// ─── T-INST-03: パネル表示 ───────────────────────────────────────────────────

test('T-INST-03: reddit.com でフローティングパネルが表示される', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');

  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible({ timeout: 10_000 });
});

test('T-INST-03: パネルに FREE バッジが表示される', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');

  await expect(page.locator('#rs-badge')).toHaveText('FREE');
});

test('T-INST-03: デフォルトで「Comments only」が選択済み', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');

  const radio = page.locator('input[name="rs-filter"][value="comments"]');
  await expect(radio).toBeChecked({ timeout: 10_000 });
});

// ─── T-INST-04: 非Redditページ ───────────────────────────────────────────────

test('T-INST-04: google.com ではパネルが表示されない', async () => {
  await page.goto('https://www.google.com');
  // パネルが存在しないことを確認（3秒待って確認）
  await page.waitForTimeout(3_000);
  await expect(page.locator(PANEL)).not.toBeVisible();
});

// ─── T-AUTH-01: 未ログイン ───────────────────────────────────────────────────

test('T-AUTH-01: 未ログイン状態で Start を押すとエラーが表示される', async () => {
  await setupRedditMocks(context, { loggedIn: false });
  await page.goto('https://www.reddit.com');

  await page.locator('#rs-start-btn').click({ timeout: 10_000 });

  await expect(page.locator('#rs-status-text')).toHaveText(
    'Please log in to Reddit first.',
    { timeout: 5_000 }
  );
});

// ─── T-FREE-02: 投稿削除が無料版で選択不可 ──────────────────────────────────

test('T-FREE-02: 無料版で「Posts only」ラジオが disabled', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  const postsRadio = page.locator('input[name="rs-filter"][value="posts"]');
  await expect(postsRadio).toBeDisabled();
});

test('T-FREE-02: 無料版で「Both」ラジオが disabled', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await expect(page.locator('input[name="rs-filter"][value="both"]')).toBeDisabled();
});

// ─── T-PRO-01: ライセンス認証（成功） ────────────────────────────────────────

test('T-PRO-01: 有効なキーで Pro 認証に成功する', async () => {
  await setupRedditMocks(context);
  await setupLicenseMocks(context, { valid: true });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-license-input').fill('VALID-KEY-0001-0001');
  await page.locator('#rs-activate-btn').click();

  // バッジが PRO になる
  await expect(page.locator('#rs-badge')).toHaveText('PRO', { timeout: 8_000 });

  // 成功メッセージ
  await expect(page.locator('#rs-license-msg')).toContainText('Pro activated');

  // 投稿削除が有効になる
  await expect(page.locator('input[name="rs-filter"][value="posts"]')).toBeEnabled();

  // ライセンスエリアが非表示
  await expect(page.locator('#rs-license-area')).not.toBeVisible();

  // クォータ行が非表示
  await expect(page.locator('#rs-quota-row')).not.toBeVisible();
});

// ─── T-PRO-02: ライセンス認証（失敗） ────────────────────────────────────────

test('T-PRO-02: 無効なキーで認証が失敗する', async () => {
  await setupRedditMocks(context);
  await setupLicenseMocks(context, { valid: false });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-license-input').fill('INVALID-KEY-0000');
  await page.locator('#rs-activate-btn').click();

  // エラーメッセージ
  await expect(page.locator('#rs-license-msg')).toContainText('✗', { timeout: 8_000 });

  // バッジは FREE のまま
  await expect(page.locator('#rs-badge')).toHaveText('FREE');

  // 投稿削除は依然 disabled
  await expect(page.locator('input[name="rs-filter"][value="posts"]')).toBeDisabled();
});

// ─── T-UI-01: ミニマイズ ─────────────────────────────────────────────────────

test('T-UI-01: ミニマイズでボディが非表示になる', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-minimize-btn').click();
  await expect(page.locator('#rs-body')).not.toBeVisible();
  await expect(page.locator('#rs-minimize-btn')).toHaveText('□');
});

test('T-UI-01: 再クリックで復元される', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-minimize-btn').click();
  await page.locator('#rs-minimize-btn').click();

  await expect(page.locator('#rs-body')).toBeVisible();
  await expect(page.locator('#rs-minimize-btn')).toHaveText('–');
});

// ─── T-UI-02: ×で閉じた後 SPA 遷移でも復活しない (S-3) ──────────────────────

test('T-UI-02: ×で閉じた後 SPA 遷移でパネルが復活しない', async () => {
  await setupRedditMocks(context);
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  // パネルを閉じる
  await page.locator('#rs-close-btn').click();
  await expect(page.locator(PANEL)).not.toBeVisible();

  // Reddit 内で SPA 遷移（pushState をシミュレート）
  await page.evaluate(() => {
    history.pushState({}, '', '/r/popular');
    // MutationObserver をトリガーするためにDOMを変更
    const div = document.createElement('div');
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 100);
  });

  await page.waitForTimeout(1_500);

  // パネルが復活していない
  await expect(page.locator(PANEL)).not.toBeVisible();
});

// ─── T-UI-04: Pause / Resume ボタン切り替え ──────────────────────────────────

test('T-UI-04: Start 後は Pause・Stop が表示され Start が消える', async () => {
  await setupRedditMocks(context, {
    // 件数を多くして削除が続くようにする
    comments: Array.from({ length: 20 }, (_, i) => ({
      kind: 't1',
      data: {
        name: `t1_item${i}`,
        body: `comment ${i}`,
        subreddit: 'test',
        created_utc: Math.floor(Date.now() / 1_000) - i * 3_600,
        is_self: false,
      }
    })),
  });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();

  // 削除中の状態
  await expect(page.locator('#rs-start-btn')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#rs-pause-btn')).toBeVisible();
  await expect(page.locator('#rs-stop-btn')).toBeVisible();
  await expect(page.locator('#rs-pause-btn')).toHaveText('Pause');
});

test('T-UI-04: Pause で Resume ボタンになる', async () => {
  await setupRedditMocks(context, {
    comments: Array.from({ length: 20 }, (_, i) => ({
      kind: 't1',
      data: { name: `t1_p${i}`, body: `c${i}`, subreddit: 'test',
              created_utc: Math.floor(Date.now() / 1_000) - i * 3_600, is_self: false }
    })),
  });
  await page.goto('https://www.reddit.com');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-start-btn').click();
  await expect(page.locator('#rs-pause-btn')).toBeVisible({ timeout: 10_000 });

  await page.locator('#rs-pause-btn').click();
  await expect(page.locator('#rs-pause-btn')).toHaveText('Resume', { timeout: 5_000 });
});

// ─── T-POPUP-02: ポップアップのステータス (B-2 修正確認) ─────────────────────

test('T-POPUP-02: 非Redditタブではポップアップに「Open Reddit」が表示される', async () => {
  await page.goto('https://www.google.com');

  // ポップアップを開く（Chrome では直接 popup.html を開いて検証）
  const popupPage = await context.newPage();
  const extensionId = context.serviceWorkers()[0]?.url()?.split('/')[2];
  if (extensionId) {
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popupPage.locator('#status-val')).toHaveText('Open Reddit', { timeout: 5_000 });
    await popupPage.close();
  }
});
