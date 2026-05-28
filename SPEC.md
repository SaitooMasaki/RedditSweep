# RedditSweep — 製品仕様書

**プロダクト名:** RedditSweep - Bulk Delete Reddit History  
**バージョン:** 1.0.0  
**最終更新:** 2026-05-27  
**対象プラットフォーム:** Google Chrome (Manifest V3)

---

## 目次

1. [プロダクト概要](#1-プロダクト概要)
2. [ファイル構成](#2-ファイル構成)
3. [機能仕様](#3-機能仕様)
4. [UI仕様](#4-ui仕様)
5. [Reddit API仕様](#5-reddit-api仕様)
6. [削除エンジン仕様](#6-削除エンジン仕様)
7. [ストレージ仕様](#7-ストレージ仕様)
8. [ライセンス・課金仕様](#8-ライセンス課金仕様)
9. [エラーハンドリング](#9-エラーハンドリング)
10. [セキュリティ仕様](#10-セキュリティ仕様)
11. [インストール手順](#11-インストール手順)
12. [リリース前チェックリスト](#12-リリース前チェックリスト)

---

## 1. プロダクト概要

### 1.1 目的

Redditユーザーが自分の投稿・コメント履歴を一括削除できるChrome拡張機能。
全処理はブラウザ内で完結し、外部サーバーへのデータ送信は一切行わない。

### 1.2 主要ユーザーストーリー

| # | ストーリー |
|---|---|
| U-1 | ユーザーは reddit.com を閲覧中に、ページを離れることなく自分のコメントを一括削除できる |
| U-2 | 無料ユーザーは1日50件までコメントを削除できる |
| U-3 | Proユーザーはコメント・投稿を無制限に削除でき、日付フィルタや上書き削除が使える |
| U-4 | 削除途中で中断しても、次回セッションで再開できる |
| U-5 | 無料枠を使い切ったとき、残件数と課金導線が表示される |

### 1.3 制約

- Redditのレート制限に従い、削除間隔は最短2秒
- Reddit APIの仕様上、1回のスキャンで取得できるのは最大1,000件（100件×10ページ）
- 外部サーバー不要（全処理がブラウザ内で完結）
- UIは英語

---

## 2. ファイル構成

```
RedditSweep/
├── manifest.json      Chrome拡張のメタデータ・権限定義
├── background.js      Service Worker（日次リセット・ライセンス認証）
├── content.js         コンテントスクリプト（フローティングパネル・削除エンジン）
├── popup.html         拡張アイコンクリック時のポップアップHTML
├── popup.js           ポップアップのロジック
└── styles.css         フローティングパネルのスタイル
```

### 2.1 各ファイルの責務

| ファイル | 実行コンテキスト | 主な責務 |
|---|---|---|
| `manifest.json` | — | 権限宣言、スクリプト登録、アイコン設定 |
| `background.js` | Service Worker | 日次リセットAlarm管理、LemonSqueezy API呼び出し |
| `content.js` | reddit.com ページ内 | フローティングパネルUI、Reddit API、削除ループ |
| `popup.html/js` | 拡張ポップアップ | ステータス表示、ライセンス認証フォーム |
| `styles.css` | reddit.com ページ内 | フローティングパネルの全スタイル |

---

## 3. 機能仕様

### 3.1 無料版

| 機能 | 仕様 |
|---|---|
| 削除対象 | コメントのみ（`t1_*`） |
| 1日の削除上限 | 50件 |
| カウントリセット | 毎日0時（ローカル時刻） |
| 上限到達時の表示 | 残件数 + 課金導線バナー |
| フィルタ | なし（全コメントが対象） |
| 再開機能 | あり（中断した位置から再開） |

### 3.2 Pro版（ライセンスキー認証後）

| 機能 | 仕様 |
|---|---|
| 削除対象 | コメント・投稿・両方を選択可 |
| 削除上限 | 無制限 |
| 日付フィルタ | 開始日・終了日で範囲指定（ローカル時刻基準） |
| 上書き削除 | 削除前にランダム文字列で内容を上書き |
| 再開機能 | あり |
| 日次カウント表示 | 非表示（無制限のため） |

### 3.3 共通機能

| 機能 | 仕様 |
|---|---|
| スキャン | Reddit APIで全ページをページネーション取得 |
| 削除間隔 | 2,000〜3,000ms（ランダム） |
| レート制限対応 | 429レスポンス時に60秒待機してリトライ |
| 中断・再開 | Pause/Resumeボタンで任意のタイミングで制御 |
| セッション保存 | 削除キューと進捗を`chrome.storage.local`に保存 |
| ミニマイズ | フローティングパネルを折りたたみ可能 |

---

## 4. UI仕様

### 4.1 フローティングパネル

reddit.com 上の全ページで右下に固定表示（`position: fixed; bottom: 24px; right: 24px`）。  
z-index: `2147483647`（最前面）。

#### 4.1.1 レイアウト構造

```
┌─────────────────────────────────┐
│ 🧹 RedditSweep    [FREE] [–] [✕] │  ← ヘッダー
├─────────────────────────────────┤
│ Delete target                   │
│ ○ Comments only                 │
│ ○ Posts only        [PRO]       │
│ ○ Both              [PRO]       │
├─────────────────────────────────┤
│ ※ Pro Options（Pro時のみ表示）  │
│   Date range: [____] – [____]   │
│   ☐ Overwrite before delete     │
├─────────────────────────────────┤
│ ⚡ Previous session found. [Resume] │ ← セッションあり時のみ
├─────────────────────────────────┤
│ [Status message]                │
│ ████████░░░░░░░░  60%           │  ← プログレスバー
│ 30 deleted          50 total    │
├─────────────────────────────────┤
│ Free today: 30 / 50  ▓▓▓▓▓░░  │  ← 無料時のみ
├─────────────────────────────────┤
│ ※ 上限到達時CTA（上限到達後のみ）│
│ Today's free limit (50) used.   │
│ 20 items remaining.             │
│ [  ¥600で無制限に →  ]          │
├─────────────────────────────────┤
│ [     Start      ]              │
│ ← 実行中: [Pause] [Stop]        │
├─────────────────────────────────┤
│ License Key                     │
│ [XXXX-XXXX-XXXX] [Activate]    │  ← Pro時は非表示
└─────────────────────────────────┘
```

#### 4.1.2 各コントロールの状態遷移

| 状態 | Start | Pause | Stop |
|---|---|---|---|
| 待機中 | 表示・有効 | 非表示 | 非表示 |
| スキャン中 | 非表示 | 表示・有効（「Pause」） | 表示・有効 |
| 削除実行中 | 非表示 | 表示・有効（「Pause」） | 表示・有効 |
| 一時停止中 | 非表示 | 表示・有効（「Resume」） | 表示・有効 |
| 完了・停止 | 表示・有効 | 非表示 | 非表示 |

#### 4.1.3 ステータステキスト一覧

| 状況 | 表示テキスト |
|---|---|
| 初期状態 | `Ready — click Start to scan your history.` |
| スキャン中 | `Scanning... 123 items found` |
| 削除中 | `Deleting comment in r/subredditname...` |
| 一時停止中 | `Paused` |
| レート制限中 | `Rate limited. Retrying in 42s...` |
| 無料上限到達 | `Free limit (50/day) reached.` |
| 完了 | `Done! Deleted 42 item(s).` |
| 停止 | `Stopped.` |
| 未ログイン | `Please log in to Reddit first.` |

### 4.2 拡張ポップアップ（popup.html）

| 表示項目 | 内容 |
|---|---|
| プラン | FREE / PRO バッジ |
| ステータス | Running / Idle / Open Reddit |
| 本日の削除数 | `N / 50`（Pro時は非表示） |
| ライセンスキー入力 | テキストフィールド + Activateボタン（Pro時は非表示） |
| 購入リンク | LemonSqueezy商品URLへのリンク（Free時のみ） |
| Proの場合 | ライセンス解除ボタン |

### 4.3 デザイントークン

| トークン | 値 | 用途 |
|---|---|---|
| Primary | `#FF4500` | Redditオレンジ、CTAボタン、アクセント |
| Background | `#1A1A1B` | パネル背景 |
| Surface | `#272729` | セクション背景、入力フィールド |
| Border | `#343536` | 区切り線、フィールド枠 |
| Text primary | `#D7DADC` | 本文 |
| Text muted | `#818384` | ラベル、補足テキスト |
| Success | `#7FC97F` | 成功メッセージ |
| Danger | `#FF6B6B` | エラーメッセージ |

---

## 5. Reddit API仕様

### 5.1 認証方式

コンテントスクリプトがreddit.comドメイン上で動作するため、`credentials: 'include'`でセッションCookieを自動付与。  
CSRF対策として`modhash`をリクエストボディ（`uh`パラメータ）とヘッダー（`x-modhash`）の両方に付与。

### 5.2 modhash取得

```
GET https://www.reddit.com/api/me.json
Credentials: include

Response: { "data": { "name": "username", "modhash": "xxxxxxxxxxxx" } }
```

- セッション開始時に1回取得し、メモリにキャッシュ
- 削除APIが401を返した場合は再取得

### 5.3 コメント一覧取得

```
GET https://www.reddit.com/user/{username}/comments.json
    ?limit=100
    &raw_json=1
    &after={cursor}   ← ページネーション用（初回は省略）
Credentials: include

Response:
{
  "data": {
    "after": "t1_xxxxxx",   ← 次ページのカーソル（最終ページはnull）
    "children": [
      {
        "kind": "t1",
        "data": {
          "name":        "t1_xxxxxx",   ← fullname（削除・編集に使用）
          "body":        "comment text",
          "subreddit":   "subredditname",
          "created_utc": 1234567890,
          "is_self":     false
        }
      }
    ]
  }
}
```

### 5.4 投稿一覧取得（Pro版）

```
GET https://www.reddit.com/user/{username}/submitted.json
    ?limit=100
    &raw_json=1
    &after={cursor}
Credentials: include

Response: （コメントと同構造。kind="t3"、data.is_self=trueでテキスト投稿判定）
```

### 5.5 コンテンツ上書き（Proオプション）

コメントまたはテキスト投稿（`is_self: true`）に対してのみ実行可能。

```
POST https://www.reddit.com/api/editusertext
Content-Type: application/x-www-form-urlencoded
x-modhash: {modhash}

Body:
  thing_id = t1_xxxxxx   （または t3_xxxxxx）
  text      = {ランダム文字列}
  uh        = {modhash}
  api_type  = json
```

ランダム文字列生成：`Math.random().toString(36)` を複数連結 + Unix timestamp。

### 5.6 削除

```
POST https://www.reddit.com/api/del
Content-Type: application/x-www-form-urlencoded
x-modhash: {modhash}

Body:
  id       = t1_xxxxxx   （コメント）または t3_xxxxxx（投稿）
  uh       = {modhash}
  api_type = json
```

### 5.7 レスポンスコード対応表

| HTTPステータス | 意味 | 対応 |
|---|---|---|
| 200 | 成功 | 次のアイテムへ進む |
| 403 | 権限なし | スキップして続行 |
| 404 | 見つからない（既に削除済み） | スキップして続行 |
| 429 | レート制限 | 60秒待機後リトライ |
| 5xx | サーバーエラー | 一時停止、ユーザーに通知 |

---

## 6. 削除エンジン仕様

### 6.1 全体フロー

```
Start ボタン押下
  │
  ├─ username 取得（me.json）
  ├─ modhash 取得（me.json）
  │
  ├─ [キュー構築フェーズ]
  │    └─ フィルタに応じてcomments/submitted を全ページ取得
  │       ├─ Pro: 日付フィルタ適用（created_utc で比較）
  │       └─ キューにアイテムを積む
  │
  └─ [削除ループフェーズ]
       ├─ abortFlag チェック → true なら終了
       ├─ paused チェック → true なら Promise で待機
       ├─ 無料上限チェック → 上限到達ならCTA表示・セッション保存・終了
       ├─ (Pro + overwriteFirst) → editusertext → 600ms待機
       ├─ api/del 呼び出し
       │    └─ 429 → 60秒待機カウントダウン → リトライ
       ├─ queueIdx++ / dailyUsed++ / updateProgress()
       ├─ 10件ごとにセッション保存
       └─ ランダム待機（2,000〜3,000ms）
```

### 6.2 キュービルド詳細

```
function buildQueue():
  - filterType = 'comments' → /comments のみ取得
  - filterType = 'posts'    → /submitted のみ取得（Pro必須）
  - filterType = 'both'     → 両方取得（Pro必須）

  各エンドポイントでページネーション:
    after = null
    while true:
      data = fetchListingPage(endpoint, after)
      for each child in data.children:
        Proかつ日付フィルタ設定時: created_utc × 1000 をローカル時刻で比較
        queue.push({ id, type, isSelf, subreddit, created })
      after = data.after
      if after == null or children == 0: break
      sleep(300ms)  ← APIへの負荷軽減
```

### 6.3 再開（Resume）仕様

セッションデータは `chrome.storage.local` の `savedSession` キーに保存。

```typescript
interface SavedSession {
  queue:         QueueItem[];   // 削除対象アイテム全件
  queueIdx:      number;        // 次に削除するインデックス
  filterType:    string;
  dateStart:     string | null; // ISO 8601
  dateEnd:       string | null;
  overwriteFirst: boolean;
}
```

保存タイミング:
- Pause 押下時
- 10件削除ごと（自動保存）
- 無料上限到達時

クリアタイミング:
- 全件削除完了時

---

## 7. ストレージ仕様

### 7.1 `chrome.storage.local` スキーマ

| キー | 型 | 説明 | 初期値 |
|---|---|---|---|
| `dailyUsed` | `number` | 本日の削除件数 | `0` |
| `dailyDate` | `string` | カウント対象日（`YYYY-MM-DD`） | — |
| `isPro` | `boolean` | Pro認証済みフラグ | `false` |
| `licenseKey` | `string` | 認証済みライセンスキー | — |
| `instanceId` | `string` | ブラウザ固有UUID | — |
| `savedSession` | `SavedSession` | 中断セッションデータ | — |

### 7.2 日次リセット

`chrome.alarms` APIを使用。

- **Alarm名:** `dailyReset`
- **初回発火:** 翌日0時00分（ローカル時刻） 
- **以降:** 24時間ごと（`periodInMinutes: 1440`）
- **処理:** `dailyUsed = 0`、`dailyDate = today` を保存

インストール時（`onInstalled`）とブラウザ起動時（`onStartup`）にAlarmを再登録。

---

## 8. ライセンス・課金仕様

### 8.1 ライセンス方式

- **プラットフォーム:** LemonSqueezy
- **方式:** ライセンスキー（License Keys）方式
- **価格:** ¥600（買い切り）
- **購入URL:** `PURCHASE_URL` 定数として `content.js` / `popup.html` に記載（要設定）

### 8.2 認証フロー

```
ユーザーがライセンスキーを入力 → [Activate]押下
  │
  ├─ content.js / popup.js → chrome.runtime.sendMessage({ action: 'validateLicense', key })
  │
  ├─ background.js（Service Worker）が受信
  │    ├─ instanceId を取得/生成（crypto.randomUUID）
  │    ├─ POST https://api.lemonsqueezy.com/v1/licenses/activate
  │    │    Body: { license_key, instance_name: "RedditSweep-{instanceId}" }
  │    │
  │    ├─ activated: true  → storage に { isPro: true, licenseKey, instanceId } 保存
  │    ├─ activated: false → POST /v1/licenses/validate にフォールバック
  │    │    └─ valid: true  → 同様に保存
  │    │    └─ valid: false → エラーメッセージ返却
  │    │
  │    └─ sendResponse({ ok: true | false, error?: string })
  │
  └─ UIに結果を反映（バッジPRO化、Pro機能解除）
```

### 8.3 ライセンス解除フロー

```
[Deactivate License]押下（ポップアップ）
  │
  ├─ background.js → POST /v1/licenses/deactivate
  │    Body: { license_key, instance_id }
  │
  └─ storage から { isPro, licenseKey } を削除 → ページリロード
```

### 8.4 LemonSqueezy APIエンドポイント

| 用途 | Method | URL |
|---|---|---|
| ライセンス有効化 | POST | `https://api.lemonsqueezy.com/v1/licenses/activate` |
| ライセンス検証 | POST | `https://api.lemonsqueezy.com/v1/licenses/validate` |
| ライセンス無効化 | POST | `https://api.lemonsqueezy.com/v1/licenses/deactivate` |

---

## 9. エラーハンドリング

### 9.1 削除ループ内のエラー処理

| エラー種別 | 検出方法 | 対応 |
|---|---|---|
| 未ログイン | `me.json` が空 / 403 | パネルにエラー表示、処理開始不可 |
| modhash取得失敗 | APIエラー | パネルにエラー表示、リフレッシュ促す |
| レート制限 | HTTP 429 | 60秒カウントダウン表示後リトライ |
| アイテム存在なし | HTTP 404 | スキップして次へ |
| 権限なし | HTTP 403 | スキップして次へ |
| サーバーエラー | HTTP 5xx | 一時停止・エラー表示 |
| ネットワークエラー | `fetch` 例外 | 一時停止・エラー表示 |
| ライセンス認証失敗 | APIレスポンス | エラーメッセージ表示 |

### 9.2 レート制限カウントダウン

429受信後：
1. `setStatus('Rate limited. Retrying in 60s...')` を表示
2. `setInterval` で1秒ごとにカウントダウン更新
3. 60秒後にインターバルクリア → 同一APIを再実行

---

## 10. セキュリティ仕様

### 10.1 データプライバシー

| 項目 | 仕様 |
|---|---|
| 外部サーバー送信 | **なし**（LemonSqueezy認証APIのみ）|
| Redditコンテンツの送信 | **なし** |
| ライセンスキーの保管 | `chrome.storage.local`（ローカルのみ） |
| 削除キューのデータ | `chrome.storage.local`（ローカルのみ） |

### 10.2 Manifest V3 権限

| 権限 | 理由 |
|---|---|
| `storage` | 日次カウント・Pro状態・セッション保存 |
| `alarms` | 日次リセット処理 |
| `host_permissions: reddit.com` | Reddit APIへのfetch |
| `host_permissions: api.lemonsqueezy.com` | ライセンス認証 |

`tabs`、`activeTab`、`history`、`cookies` 等の広範な権限は**使用しない**。

### 10.3 クロスサイトスクリプティング対策

- `innerHTML` への外部データ直接挿入を行わない
- パネルHTMLは静的文字列テンプレートで生成
- Redditから取得したコンテンツ（コメント本文等）はUIに描画しない

---

## 11. インストール手順

### 11.1 開発版インストール

1. Chrome で `chrome://extensions` を開く
2. 右上「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `RedditSweep/` フォルダを選択
5. 拡張機能一覧に「RedditSweep」が表示されることを確認

### 11.2 動作確認

1. `https://www.reddit.com` を開く
2. Redditにログインする
3. 右下にフローティングパネルが表示されることを確認
4. 「Start」ボタンでスキャン開始 → プログレスが更新されることを確認

### 11.3 Chrome Web Storeへの公開前作業

- [ ] `PURCHASE_URL` を実際のLemonSqueezy商品URLに変更
- [ ] アイコン画像（16px, 48px, 128px）を用意してmanifest.jsonに追加
- [ ] プライバシーポリシーを用意（外部サーバー不使用の旨を明記）
- [ ] スクリーンショット（1280×800 または 640×400）を用意
- [ ] Chrome Web Storeデベロッパーアカウントに登録（$5 one-time fee）

---

## 12. リリース前チェックリスト

### 機能テスト

- [ ] 無料ユーザーでコメントが削除できる
- [ ] 50件削除後に上限CTAが表示される
- [ ] 翌日0時に削除カウントがリセットされる
- [ ] Pauseで一時停止、Resumeで再開できる
- [ ] Stopで中断後、Resume bannerが表示される
- [ ] セッション再開で正しい位置から削除が再開される
- [ ] 429レスポンス時に60秒待機してリトライされる
- [ ] ライセンスキー入力でPro機能が解除される
- [ ] Pro: 投稿削除が動作する
- [ ] Pro: 日付フィルタが正しく適用される
- [ ] Pro: 上書き削除オプションが動作する

### UXテスト

- [ ] フローティングパネルがRedditのUIを過度に妨げない
- [ ] ミニマイズが正常に動作する
- [ ] Redditの画面遷移後もパネルが維持される
- [ ] ポップアップのステータスが正しく反映される

### セキュリティ確認

- [ ] reddit.com以外のドメインではパネルが表示されない（manifest設定）
- [ ] ライセンスキーがコンソールログに出力されない
- [ ] 削除したコンテンツが外部に送信されていない（Network検証）

---

*本仕様書は `C:\Users\kam1n\RedditSweep\` 配下のソースコードと対応しています。*
