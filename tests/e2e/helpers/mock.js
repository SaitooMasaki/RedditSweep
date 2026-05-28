/**
 * E2E テスト用 Reddit API モックデータとルートセットアップ
 */

// ─── モックデータ生成 ─────────────────────────────────────────────────────────

/**
 * コメントアイテムを生成する
 * @param {string} id - アイテムID (例: 'abc123')
 * @param {object} opts
 */
function mockComment(id, opts = {}) {
  const daysAgo = opts.daysAgo ?? 1;
  return {
    kind: 't1',
    data: {
      name: `t1_${id}`,
      body: opts.body ?? `Test comment ${id}`,
      subreddit: opts.subreddit ?? 'testsubreddit',
      created_utc: Math.floor(Date.now() / 1_000) - daysAgo * 86_400,
      is_self: false,
    },
  };
}

/**
 * テキスト投稿（self post）アイテムを生成する
 */
function mockSelfPost(id, opts = {}) {
  const daysAgo = opts.daysAgo ?? 1;
  return {
    kind: 't3',
    data: {
      name: `t3_${id}`,
      title: opts.title ?? `Test Post ${id}`,
      selftext: opts.selftext ?? `Post body ${id}`,
      subreddit: opts.subreddit ?? 'testsubreddit',
      created_utc: Math.floor(Date.now() / 1_000) - daysAgo * 86_400,
      is_self: true,
    },
  };
}

/**
 * Reddit Listing レスポンスを生成する
 */
function mockListing(items, after = null) {
  return {
    kind: 'Listing',
    data: { after, children: items },
  };
}

/**
 * 空のリスト（アイテムなし）
 */
const EMPTY_LISTING = mockListing([]);

/**
 * me.json レスポンス（ログイン済み）
 */
const ME_LOGGED_IN = {
  data: { name: 'testuser', modhash: 'testhash123456' },
};

/**
 * me.json レスポンス（未ログイン）
 */
const ME_LOGGED_OUT = {};

// ─── Playwright ルートセットアップ ───────────────────────────────────────────

/**
 * Reddit API のルートを一括でモック設定する
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {object} options
 * @param {object[]} options.comments    - コメント一覧 (デフォルト: 3件)
 * @param {object[]} options.posts       - 投稿一覧 (デフォルト: 空)
 * @param {boolean}  options.loggedIn    - ログイン状態 (デフォルト: true)
 * @param {boolean}  options.deleteFails - 削除APIを失敗させる (デフォルト: false)
 * @param {number}   options.deleteStatus - 削除APIのステータスコード (デフォルト: 200)
 */
async function setupRedditMocks(context, options = {}) {
  const {
    comments = [mockComment('c001'), mockComment('c002'), mockComment('c003')],
    posts = [],
    loggedIn = true,
    deleteStatus = 200,
    editStatus = 200,
  } = options;

  // me.json — 認証情報
  await context.route('**/api/me.json', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(loggedIn ? ME_LOGGED_IN : ME_LOGGED_OUT),
    })
  );

  // コメント一覧
  await context.route('**/user/testuser/comments.json**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockListing(comments)),
    })
  );

  // 投稿一覧
  await context.route('**/user/testuser/submitted.json**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockListing(posts)),
    })
  );

  // 削除 API
  await context.route('**/api/del', route =>
    route.fulfill({
      status: deleteStatus,
      contentType: 'application/json',
      body: JSON.stringify({ json: { errors: [] } }),
    })
  );

  // 上書き API
  await context.route('**/api/editusertext', route =>
    route.fulfill({
      status: editStatus,
      contentType: 'application/json',
      body: JSON.stringify({ json: { errors: [] } }),
    })
  );
}

/**
 * LemonSqueezy ライセンス API をモック設定する
 */
async function setupLicenseMocks(context, { valid = true } = {}) {
  await context.route('**/api.lemonsqueezy.com/v1/licenses/activate', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        valid
          ? { activated: true, license_key: { status: 'active' } }
          : { activated: false, error: 'License not found.' }
      ),
    })
  );

  await context.route('**/api.lemonsqueezy.com/v1/licenses/validate', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        valid
          ? { valid: true }
          : { valid: false, error: 'Invalid license key.' }
      ),
    })
  );

  await context.route('**/api.lemonsqueezy.com/v1/licenses/deactivate', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  );
}

/**
 * chrome.storage.local を Extension Service Worker 経由でセットする
 */
async function setExtensionStorage(context, data) {
  const workers = context.serviceWorkers();
  let worker = workers[0];

  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 5_000 }).catch(() => null);
  }

  if (worker) {
    await worker.evaluate((d) => chrome.storage.local.set(d), data);
  }
}

/**
 * chrome.storage.local の値を取得する
 */
async function getExtensionStorage(context, keys) {
  const workers = context.serviceWorkers();
  let worker = workers[0];

  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 5_000 }).catch(() => null);
  }

  if (!worker) return null;

  return worker.evaluate(
    (k) => new Promise(resolve => chrome.storage.local.get(k, resolve)),
    keys
  );
}

module.exports = {
  mockComment,
  mockSelfPost,
  mockListing,
  EMPTY_LISTING,
  ME_LOGGED_IN,
  ME_LOGGED_OUT,
  setupRedditMocks,
  setupLicenseMocks,
  setExtensionStorage,
  getExtensionStorage,
};
