/**
 * RedditSweep アイコン生成スクリプト
 * @resvg/resvg-js (WASM) で SVG → PNG 変換
 * 実行: node generate-icons.js
 */

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

// ─── 出力先 ───────────────────────────────────────────────────────────────────
const ICONS_DIR = path.join(__dirname, 'icons');
if (!fs.existsSync(ICONS_DIR)) fs.mkdirSync(ICONS_DIR);

// ─── SVG テンプレート（viewBox 100×100 で設計、各サイズにスケール） ───────────
function buildSVG(size) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${size}" height="${size}" viewBox="0 0 100 100">

  <!-- 背景: Redditオレンジ 角丸20% -->
  <rect width="100" height="100" rx="20" ry="20" fill="#FF4500"/>

  <!-- ゴミ箱: 持ち手 -->
  <rect x="41" y="14" width="18" height="9" rx="3" fill="white"/>

  <!-- ゴミ箱: フタ -->
  <rect x="18" y="24" width="64" height="10" rx="3" fill="white"/>

  <!-- ゴミ箱: 本体 -->
  <rect x="24" y="36" width="52" height="46" rx="5" fill="white"/>

  <!-- ゴミ箱: 縦線（本体と同色の背景で刻む） -->
  <line x1="37" y1="43" x2="37" y2="75"
        stroke="#FF4500" stroke-width="4" stroke-linecap="round"/>
  <line x1="50" y1="43" x2="50" y2="75"
        stroke="#FF4500" stroke-width="4" stroke-linecap="round"/>
  <line x1="63" y1="43" x2="63" y2="75"
        stroke="#FF4500" stroke-width="4" stroke-linecap="round"/>

</svg>`;
}

// ─── 各サイズを生成 ───────────────────────────────────────────────────────────
const SIZES = [16, 48, 128];

for (const size of SIZES) {
  const svg = buildSVG(size);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const rendered = resvg.render();
  const png = rendered.asPng();

  const outPath = path.join(ICONS_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ ${outPath}  (${png.length} bytes)`);
}

console.log('\nDone! icons/ フォルダを確認してください。');
