// 리소스 폴더(manifest.json + PNG)를 읽어 게임용 데이터를 만든다. 원본 PNG 는 읽기만 한다.
//   node tools/prepare.cjs            (리소스 폴더 = js/config.js 의 assetBase)
// 만드는 것: data/assets.js (manifest 정규화 — v1 측정 rect / v2 정규 격자 모두 같은 형태로)
//            data/metrics.js (프레임별 접지점·머리·입·앞발·클릭 마스크), data/icon.png·icon.ico
// 동물을 추가하거나 시트를 다시 만들거나 assetBase 를 바꾸면 이것만 다시 돌리면 된다.
'use strict';
const fs = require('fs'), path = require('path');
const zlib = require('zlib');
const { decode } = require('./png.cjs');
const root = path.join(__dirname, '..');
const cfgSrc = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
const baseRel = cfgSrc.match(/assetBase:\s*'([^']+)'/)[1], assetBase = path.join(root, baseRel);
const manifest = normalize(JSON.parse(fs.readFileSync(path.join(assetBase, 'manifest.json'), 'utf8').replace(/^﻿/, '')));

// manifest 형식 정규화. v1 = 측정 rect + origin(칸 중심) / v2 = 256 정규 격자 + 공통 기준점(높이 변화는 칸 안에 그려져 있음)
function normalize(m) {
  if (m.format === 'uniform_grid' || m.version >= 2) {
    const pv = m.pivot_pixels || [128, 220], actions = [], seen = new Set(), characters = {};
    for (const [cid, ch] of Object.entries(m.characters)) {
      const animations = {};
      for (const [aid, an] of Object.entries(ch.animations)) {
        animations[aid] = { sheet: an.sheet, frames: an.rects.map(r => ({ rect: r, origin: pv.slice(), offset: [0, 0] })) };
        if (!seen.has(aid)) { seen.add(aid); actions.push({ id: aid, label: an.label, sheet: an.sheet, row: an.row, frames: an.frame_count, fps: an.fps, loop: an.loop }); }
      }
      characters[cid] = { sheets: Object.fromEntries(Object.entries(ch.sheets).map(([k, v]) => [k, { file: v.file }])), animations };
    }
    const shared = Object.fromEntries(Object.entries(m.shared).map(([k, a]) => [k, { file: a.file, items: Object.fromEntries(Object.entries(a.items).map(([i, it]) => [i, { rect: it.rect }])) }]));
    return { version: 2, pivotMode: 'manifest', actions, characters, shared, backgrounds: [m.backgrounds.room_day.file, m.backgrounds.room_night.file] };
  }
  return { version: 1, pivotMode: 'measured', actions: m.actions, characters: m.characters, shared: m.shared, backgrounds: m.backgrounds };
}
const MASK = 24, A = 32;

function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// rect 안(clip 적용)의 불투명 픽셀 → 가장 큰 덩어리 기준 측정값
function measure(img, rect, clip) {
  const [rx, ry, rw, rh] = rect, on = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++)
    if (img.alpha(rx + x, ry + y) >= A && (!clip || inPoly(clip, x + .5, y + .5))) on[y * rw + x] = 1;
  // 가장 큰 연결 덩어리 = 몸
  const lab = new Int32Array(rw * rh), sizes = [0];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || lab[i]) continue;
    const id = sizes.length, st = [i]; lab[i] = id; let n = 0;
    while (st.length) {
      const q = st.pop(), qx = q % rw, qy = (q / rw) | 0; n++;
      if (qx > 0 && on[q - 1] && !lab[q - 1]) { lab[q - 1] = id; st.push(q - 1); }
      if (qx < rw - 1 && on[q + 1] && !lab[q + 1]) { lab[q + 1] = id; st.push(q + 1); }
      if (qy > 0 && on[q - rw] && !lab[q - rw]) { lab[q - rw] = id; st.push(q - rw); }
      if (qy < rh - 1 && on[q + rw] && !lab[q + rw]) { lab[q + rw] = id; st.push(q + rw); }
    }
    sizes.push(n);
  }
  const body = sizes.indexOf(Math.max(...sizes));
  let x0 = rw, y0 = rh, x1 = -1, y1 = -1, sx = 0, sy = 0, n = 0;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (lab[y * rw + x] === body) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; sy += y; n++;
  }
  const h = y1 - y0 + 1;
  const band = (ya, yb) => { // [ya,yb] 행 구간의 몸 픽셀 x 평균, 최소, 최대
    let s = 0, c = 0, mn = rw, mx = -1, ymx = ya;
    for (let y = Math.max(0, ya | 0); y <= Math.min(rh - 1, yb | 0); y++) for (let x = 0; x < rw; x++) if (lab[y * rw + x] === body) {
      s += x; c++; if (x < mn) mn = x; if (x > mx) { mx = x; ymx = y; }
    }
    return { mean: c ? s / c : (x0 + x1) / 2, min: mn, max: mx, ymax: ymx };
  };
  const ground = band(y1 - Math.max(6, h * .15), y1), top = band(y0, y0 + Math.max(4, h * .08));
  const lower = band(y0 + h * .5, y1), head = band(y0 + h * .22, y0 + h * .6);
  // 클릭 판정용 24x24 마스크(칸의 25% 이상이 불투명이면 1), clip 안 전체 픽셀 기준
  const bits = new Uint8Array(MASK * MASK / 8);
  for (let cy = 0; cy < MASK; cy++) for (let cx = 0; cx < MASK; cx++) {
    const ax = Math.floor(cx * rw / MASK), bx = Math.floor((cx + 1) * rw / MASK), ay = Math.floor(cy * rh / MASK), by = Math.floor((cy + 1) * rh / MASK);
    let c = 0, t = 0;
    for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) { t++; c += on[y * rw + x]; }
    if (t && c / t > .25) bits[(cy * MASK + cx) >> 3] |= 1 << ((cy * MASK + cx) & 7);
  }
  const r = v => Math.round(v * 10) / 10;
  return {
    bbox: [x0, y0, x1 - x0 + 1, h], ground: [r(ground.mean), y1], top: [r(top.mean), y0],
    center: [r(sx / n), r(sy / n)], reachR: [lower.max, lower.ymax], reachL: [lower.min, lower.ymax],
    mouth: [head.max, head.ymax], area: n, mask: Buffer.from(bits).toString('base64'),
  };
}

const imgs = {};
const img = file => imgs[file] || (imgs[file] = decode(path.join(assetBase, file)));
const out = { source: path.basename(assetBase), made: new Date().toISOString(), mask: MASK, characters: {}, shared: {} };
const report = [];
for (const [cid, ch] of Object.entries(manifest.characters)) {
  const c = out.characters[cid] = {};
  for (const [aid, an] of Object.entries(ch.animations)) {
    const file = ch.sheets[an.sheet].file;
    c[aid] = an.frames.map(f => measure(img(file), f.rect, f.clipPolygon));
    // 같은 행 안 접지점 흔들림(칸 기준 origin 과 실제 접지점 차이)
    const drift = an.frames.map((f, i) => c[aid][i].ground[0] - f.origin[0]);
    const spread = Math.max(...drift) - Math.min(...drift);
    if (spread > 12) report.push(`${cid}.${aid}: manifest origin 대비 접지점 좌우 차이 ${spread.toFixed(0)}px`);
  }
  // 시트별 몸 폭 중앙값(축척 확인용)
  const bySheet = {};
  for (const [aid, an] of Object.entries(ch.animations)) (bySheet[an.sheet] ||= []).push(...c[aid].map(m => m.bbox[2]));
  for (const [s, ws] of Object.entries(bySheet)) { ws.sort((a, b) => a - b); report.push(`${cid} ${s}: 몸 폭 중앙값 ${ws[ws.length >> 1]}px`); }
}
for (const [aid, atlas] of Object.entries(manifest.shared)) {
  const s = out.shared[aid] = {};
  for (const [iid, it] of Object.entries(atlas.items)) {
    const m = measure(img(atlas.file), it.rect);
    s[iid] = { bbox: m.bbox, ground: m.ground };
  }
}
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
// 앱 아이콘: 기본 동물 idle_breathe 0번을 정사각형에 맞춰 줄인다(면적 평균, 알파 곱셈)
{
  const cid = cfgSrc.match(/character:\s*'([^']+)'/)[1], ch = manifest.characters[cid] || Object.values(manifest.characters)[0];
  const f = ch.animations.idle_breathe.frames[0], im = img(ch.sheets[ch.animations.idle_breathe.sheet].file);
  const m = out.characters[cid] ? out.characters[cid].idle_breathe[0].bbox : [0, 0, f.rect[2], f.rect[3]];
  const N = 128, pad = 6, k = Math.max(m[2], m[3]) / (N - pad * 2), ox = (N - m[2] / k) / 2, oy = (N - m[3] / k) / 2;
  const px = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0, c = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const X = Math.floor(f.rect[0] + m[0] + (x - ox + (sx + .5) / 4) * k), Y = Math.floor(f.rect[1] + m[1] + (y - oy + (sy + .5) / 4) * k); c++;
      if (X < f.rect[0] || Y < f.rect[1] || X >= f.rect[0] + f.rect[2] || Y >= f.rect[1] + f.rect[3]) continue;
      const o = (Y * im.w + X) * 4, al = im.px[o + 3]; r += im.px[o] * al; g += im.px[o + 1] * al; b += im.px[o + 2] * al; a += al;
    }
    const o = (y * N + x) * 4; if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = a / c; }
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(N * (N * 4 + 1)); for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(root, 'data/icon.png'), png);
  const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = N; ico[7] = N; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(root, 'data/icon.ico'), Buffer.concat([ico, png]));
}
fs.writeFileSync(path.join(root, 'data/assets.js'),
  '// tools/prepare.cjs 가 ' + baseRel + 'manifest.json 에서 만든 파일. 손으로 고치지 않는다.\nwindow.PET_ASSETS=' + JSON.stringify(Object.assign({ base: baseRel }, manifest)) + ';\n');
fs.writeFileSync(path.join(root, 'data/metrics.js'),
  '// tools/prepare.cjs 가 만든 파일. 손으로 고치지 않는다.\nwindow.PET_METRICS=' + JSON.stringify(out) + ';\n');
console.log(report.join('\n'));
console.log(`metrics: ${Object.keys(out.characters).join(', ')} / 출처 ${out.source}`);
