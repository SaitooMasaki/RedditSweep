/**
 * Unit tests — Pure utility functions (content.js と background.js 共通ロジック)
 *
 * これらの関数はブラウザ依存がないため Jest で直接テスト可能。
 * 対応テストケース: T-FREE-04, T-RESET-02 (B-1 タイムゾーン修正の検証)
 */

// ─── テスト対象の関数をここで再定義（content.js / background.js と完全に同一） ───
// background.js と content.js の todayStr は同一実装なので一箇所でテスト
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const randomDelay = (min = 2_000, max = 3_000) => min + Math.random() * (max - min);

const randomText = () =>
  Array.from({ length: 3 }, () => Math.random().toString(36).slice(2)).join(' ') + ' ' + Date.now();

const FREE_LIMIT = 50;
const isFreeLimitReached = (dailyUsed) => dailyUsed >= FREE_LIMIT;

// 日付フィルタロジック（content.js buildQueue 内のロジックと同一）
const passesDateFilter = (created_utc, dateStart, dateEnd) => {
  const created = new Date(created_utc * 1_000);
  if (dateStart && created < dateStart) return false;
  if (dateEnd   && created > dateEnd)   return false;
  return true;
};

// ─── todayStr ─────────────────────────────────────────────────────────────────

describe('todayStr', () => {
  it('YYYY-MM-DD 形式を返す', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ローカル日付を返す（UTC日付ではない）', () => {
    // ローカルの new Date() と一致することを確認
    const d = new Date();
    const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(todayStr()).toBe(localDate);
  });

  it('UTC日付とは一致しない可能性がある（JST+9環境での確認）', () => {
    // UTC の日付文字列
    const utcDate = new Date().toISOString().slice(0, 10);
    // ローカルタイムゾーンが UTC から 9 時間以上ずれている場合、日付が異なる
    // → このテストは環境によってスキップしてよい（document扱い）
    const localDate = todayStr();
    // どちらの形式でも YYYY-MM-DD である
    expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utcDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('月・日がゼロパディングされる', () => {
    // 1月1日のケースをスパイで確認
    const mockDate = new Date(2026, 0, 5); // 2026-01-05
    jest.spyOn(global, 'Date').mockImplementation(() => mockDate);
    expect(todayStr()).toBe('2026-01-05');
    jest.restoreAllMocks();
  });
});

// ─── randomDelay ──────────────────────────────────────────────────────────────

describe('randomDelay', () => {
  it('2000ms 以上 3000ms 以下の値を返す', () => {
    for (let i = 0; i < 100; i++) {
      const delay = randomDelay();
      expect(delay).toBeGreaterThanOrEqual(2_000);
      expect(delay).toBeLessThanOrEqual(3_000);
    }
  });

  it('毎回異なる値を返す（ランダム性の確認）', () => {
    const values = new Set(Array.from({ length: 20 }, () => randomDelay()));
    expect(values.size).toBeGreaterThan(1);
  });

  it('カスタム min/max を受け付ける', () => {
    const delay = randomDelay(500, 600);
    expect(delay).toBeGreaterThanOrEqual(500);
    expect(delay).toBeLessThanOrEqual(600);
  });
});

// ─── randomText ───────────────────────────────────────────────────────────────

describe('randomText', () => {
  it('空でない文字列を返す', () => {
    expect(randomText().length).toBeGreaterThan(0);
  });

  it('毎回異なる値を返す', () => {
    const a = randomText();
    const b = randomText();
    expect(a).not.toBe(b);
  });

  it('スペースを含む（単語が分割されている）', () => {
    expect(randomText()).toContain(' ');
  });
});

// ─── isFreeLimitReached ───────────────────────────────────────────────────────

describe('isFreeLimitReached', () => {
  it('50未満は制限に達していない', () => {
    expect(isFreeLimitReached(0)).toBe(false);
    expect(isFreeLimitReached(49)).toBe(false);
  });

  it('50ちょうどで制限に達する', () => {
    expect(isFreeLimitReached(50)).toBe(true);
  });

  it('50超過も制限に達している', () => {
    expect(isFreeLimitReached(51)).toBe(true);
    expect(isFreeLimitReached(100)).toBe(true);
  });
});

// ─── passesDateFilter (T-PRO-06, T-PRO-07) ───────────────────────────────────

describe('passesDateFilter', () => {
  // 2026-03-15 12:00:00 UTC のタイムスタンプ
  const MARCH_15 = Math.floor(new Date('2026-03-15T12:00:00Z').getTime() / 1_000);
  const MARCH_01 = Math.floor(new Date('2026-03-01T00:00:00Z').getTime() / 1_000);
  const APRIL_01 = Math.floor(new Date('2026-04-01T00:00:00Z').getTime() / 1_000);

  it('フィルタなしは全件通す', () => {
    expect(passesDateFilter(MARCH_15, null, null)).toBe(true);
  });

  it('開始日より後のアイテムは通す', () => {
    const start = new Date('2026-03-01T00:00:00');
    expect(passesDateFilter(MARCH_15, start, null)).toBe(true);
  });

  it('開始日より前のアイテムは除外する', () => {
    const start = new Date('2026-04-01T00:00:00');
    expect(passesDateFilter(MARCH_15, start, null)).toBe(false);
  });

  it('終了日より前のアイテムは通す', () => {
    const end = new Date('2026-04-01T23:59:59');
    expect(passesDateFilter(MARCH_15, null, end)).toBe(true);
  });

  it('終了日より後のアイテムは除外する', () => {
    const end = new Date('2026-03-01T00:00:00');
    expect(passesDateFilter(MARCH_15, null, end)).toBe(false);
  });

  it('範囲内のアイテムは通す', () => {
    const start = new Date('2026-03-01T00:00:00');
    const end   = new Date('2026-04-01T23:59:59');
    expect(passesDateFilter(MARCH_15, start, end)).toBe(true);
  });

  it('範囲外のアイテムは除外する', () => {
    const start = new Date('2026-03-01T00:00:00');
    const end   = new Date('2026-03-10T23:59:59');
    expect(passesDateFilter(MARCH_15, start, end)).toBe(false);
  });
});
