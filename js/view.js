// 화면: 리소스 읽기, 창 크기 맞춤, 그리기(동물 1~2마리), 입력, 메뉴, 효과음 연결, 저장, 프레임 루프.
(function () {
'use strict';
const cfg = window.MP_CONFIG, room = cfg.room, { clamp } = MP.util;
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const bar = document.getElementById('bar'), hint = document.getElementById('hint'), menuBtn = document.getElementById('menuBtn');
const SAVE = 'miniPet.v1', APP = new URLSearchParams(location.search).has('app');
let w, data, imgs = {}, bg = null, dayMode = 'auto', soundOn = true;
let s = 1, ox = 0, oy = 0, dpr = 1, W = 0, H = 0;

const loadScript = src => new Promise((ok, no) => { const e = document.createElement('script'); e.src = src; e.onload = ok; e.onerror = () => no(Error('읽을 수 없음: ' + src)); document.head.append(e); });
const loadImg = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(Error('그림을 읽을 수 없음: ' + src)); im.src = src; });
const A = f => cfg.assetBase + f;
const loadAnimal = id => Promise.all(Object.values(data.characters[id].sheets).map(async f => { if (!imgs[f]) imgs[f] = await loadImg(A(f)); }));

// ---------- 시작 ----------
(async function boot() {
  try {
    await loadScript('data/assets.js').catch(() => { throw Error('data/assets.js 가 없음 — node tools/prepare.cjs 를 먼저 실행'); });
    if (window.PET_ASSETS.base !== cfg.assetBase) throw Error('config.js 의 assetBase 가 바뀜 — node tools/prepare.cjs 를 다시 실행');
    try { await loadScript('data/metrics.js'); } catch (e) { console.warn('metrics.js 없음 — manifest 기준점만 씀'); }
    const metrics = window.PET_METRICS || null;
    data = MP.buildData(window.PET_ASSETS, metrics, window.MP_TUNING);
    if (!data.available.length) throw Error('행동 시트가 다 갖춰진 동물이 없음: ' + JSON.stringify(data.missing));
    const save = load();
    const first = save.char && data.characters[save.char] ? save.char : data.characters[cfg.character] ? cfg.character : data.available[0];
    const friend = save.friend && data.characters[save.friend] ? save.friend : null;
    const files = new Set(data.backgrounds);
    for (const a of Object.values(data.shared)) files.add(a.file);
    for (const id of friend ? [first, friend] : [first]) for (const f of Object.values(data.characters[id].sheets)) files.add(f);   // 선택한 동물 것만(리소스 README 지침)
    await Promise.all([...files].map(async f => { imgs[f] = await loadImg(A(f)); }));
    if (APP && save.win) restoreWin(save.win);
    w = MP.createWorld(data, cfg, { character: first, friend, scene: save.greet ? 'greet' : 'calm' });
    window.pet = w;   // 점검용(tools/*.cjs)
    w.imgCount = () => Object.keys(imgs).length;
    w._render = render;   // 점검용(그리기 비용 측정)
    w.toScreen = (x, y) => [x * s + ox, y * s + oy];
    if (save.needs) Object.assign(w.pets[0].needs, save.needs);
    if (save.affection != null) w.pets[0].mood.affection = save.affection;
    if (save.plush !== false) w.placeToy('plush', true, true);
    if (save.rope) w.placeToy('rope', true, true);
    soundOn = save.sound !== false;
    w.sfxN = 0;
    w.sfx = (kind, q) => { w.sfxN++; if (soundOn && window.MP_AUDIO) MP_AUDIO.play(q.ch.id, kind); };
    dayMode = save.dayMode || 'auto';
    buildBar(); layout(); updateNight(true);
    setInterval(() => updateNight(false), 30000);
    setInterval(store, 30000);
    addEventListener('pagehide', store);
    if (!save.hint) showHint();
    wake();
  } catch (e) { hint.textContent = '시작 실패: ' + e.message; hint.style.opacity = 1; console.error(e); }
})();

function load() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(SAVE)) || {}; } catch (e) { o = {}; }
  const away = o.lastSeen ? (Date.now() - o.lastSeen) / 60000 : 1e9;
  if (o.needs && away > 5) {   // 꺼져 있던 동안: 푹 잤고, 조금 배고프고 심심하다(벌점 없음)
    o.needs.energy = Math.max(o.needs.energy, Math.min(1, .5 + away / 240));
    o.needs.hunger = Math.min(1, o.needs.hunger + away / 300);
    o.needs.fun = Math.max(.15, o.needs.fun - away / 400);
  }
  o.greet = away > 45 && away < 1e8;
  return o;
}
function store() {
  if (!w) return;
  const win = APP ? { x: screenX, y: screenY, w: outerWidth, h: outerHeight } : undefined;
  try {
    localStorage.setItem(SAVE, JSON.stringify({
      needs: w.pets[0].needs, affection: w.pets[0].mood.affection, dayMode, char: w.pets[0].ch.id,
      friend: w.pets[1] ? w.pets[1].ch.id : null, sound: soundOn,
      hint: 1, plush: !!w.plush, rope: !!w.rope, lastSeen: Date.now(), win,
    }));
  } catch (e) { /* 저장 불가여도 게임은 돈다 */ }
}
// 실행기(Chrome 앱 창)는 창 크기를 스스로 기억하지 않아서 페이지가 되돌린다
function restoreWin(o) {
  if (!(o.w >= 300 && o.h >= 220 && o.w <= screen.availWidth + 80 && o.h <= screen.availHeight + 80)) return;
  try { resizeTo(o.w, o.h); if (Math.abs(o.x) < 20000 && Math.abs(o.y) < 20000) moveTo(o.x, o.y); } catch (e) { /* 일반 탭에선 무시된다 */ }
}
function showHint() {
  hint.textContent = '문지르면 쓰다듬기 · 꾹 누르거나 위로 끌면 들기 · 오른쪽 위 발바닥 = 메뉴';
  hint.style.opacity = 1;
  setTimeout(() => { hint.style.opacity = 0; store(); }, 9000);
}

// ---------- 창 크기 → 방 좌표 ----------
// 방 가로 전체가 늘 보이게 맞추고, 창이 넓으면 위쪽(벽)만 잘린다. 바닥 아래 minVisibleH 는 늘 보인다.
// 세로로 긴 창은 방을 tallFill 만큼 키워 가로가 잘리고(pan), 카메라(camX)가 동물을 따라간다.
// pan 일 때 시뮬의 view 는 방 가로 전체(동물은 방 어디든 다님), 화면 폭은 view.w 로 따로 알려 준다.
let pan = false, camX = 0, camMoving = false, focusQ = null;
function layout() {
  W = innerWidth; H = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  s = Math.min(Math.max(Math.min(W / room.w, H / room.minVisibleH), H * room.tallFill / room.h), W / room.minVisibleW);
  pan = room.w * s > W + 1;
  oy = H - room.h * s;
  if (pan) { w.view = { left: 0, right: room.w, top: -oy / s, bottom: room.h, w: W / s }; updateCam(0, true); }
  else { ox = (W - room.w * s) / 2; w.view = { left: Math.max(0, -ox / s), right: Math.min(room.w, (W - ox) / s), top: -oy / s, bottom: room.h }; w.view.w = w.view.right - w.view.left; }
  // 새 창 크기에서 안 보이게 된 것들을 안으로
  const top = w.floorTopNow();
  for (const q of w.pets) if (!q.on && !q.hold && q.y < top) q.y = top;
  for (const o of [w.ball, w.plush, w.rope]) if (o && o.y < top - 40) o.y = top - 40;
  buildBg(); wake();
}
// 카메라: 따라갈 x(두 마리가 가까우면 가운데, 멀면 마지막으로 만진 동물)가 화면 가운데 40~60% 를 벗어나면 부드럽게 따라가고,
// 30~70% 밖으로는 못 나가게 붙잡는다. 손가락을 대고 있는 동안은 멈춘다(움직이면 손 아래 그림이 미끄러진다).
function updateCam(dt, snap) {
  if (!pan) return false;
  const vw = W / s, xs = w.pets.map(q => w.pose(q).x), lo = Math.min(...xs), hi = Math.max(...xs);
  const fx = hi - lo < vw * .5 ? (lo + hi) / 2 : w.pose(w.pets.includes(focusQ) ? focusQ : w.pets[0]).x;
  let c = camX;
  if (snap) c = fx - vw / 2;
  else if (!gest) {
    const goal = fx < c + vw * .4 ? fx - vw * .4 : fx > c + vw * .6 ? fx - vw * .6 : c;
    c = clamp(c + (goal - c) * Math.min(1, dt * 3), fx - vw * .7, fx - vw * .3);
  }
  c = clamp(c, 0, room.w - vw);
  const moved = Math.abs(c - camX) > .05;
  camX = c; ox = -camX * s;
  return moved;
}
const toWorld = e => [(e.clientX - ox) / s, (e.clientY - oy) / s];
// 회전 직후엔 innerWidth/innerHeight 가 늦게 바뀌는 브라우저(삼성 인터넷 등)가 있어 몇 번 더 잰다
let resizeT = 0, sizeT = [];
function onResize() {
  if (!w) return;
  const check = () => { if (innerWidth !== W || innerHeight !== H || Math.min(2, devicePixelRatio || 1) !== dpr) layout(); };
  sizeT.forEach(clearTimeout); check(); sizeT = [150, 400, 900].map(ms => setTimeout(check, ms));
  clearTimeout(resizeT); resizeT = setTimeout(store, 800);
}
addEventListener('resize', onResize);
addEventListener('orientationchange', onResize);
if (window.visualViewport) visualViewport.addEventListener('resize', onResize);

// pan 이면 방 가로 전체를 미리 그려 두고 render 에서 카메라만큼 밀어 찍는다
function buildBg() {
  const img = imgs[w.night ? data.backgrounds[1] : data.backgrounds[0]], bx = pan ? 0 : ox;
  bg = bg || document.createElement('canvas'); bg.width = pan ? Math.ceil(room.w * s * dpr) : cv.width; bg.height = cv.height;
  const c = bg.getContext('2d');
  c.setTransform(dpr * s, 0, 0, dpr * s, dpr * bx, dpr * oy);
  const top = -oy / s, l = -bx / s;
  if (top < 0) c.drawImage(img, 0, 0, room.w, 2, l - 2, top - 2, room.w - 2 * l + 4, -top + 4);        // 위: 벽 색을 늘린다
  if (l < 0) { c.drawImage(img, 0, 0, 2, room.h, l - 2, top, -l + 4, room.h - top); c.drawImage(img, room.w - 2, 0, 2, room.h, room.w - 2, top, -l + 4, room.h - top); }
  c.drawImage(img, 0, 0);
  for (const f of w.furnList) if (f.def.flat) { nightFilter(c); drawItem(c, 'furniture', f.item, f.x, f.y, f.s); c.filter = 'none'; }
}
function updateNight(force) {
  const h = new Date().getHours(), auto = h >= room.nightFrom || h < room.nightTo;
  const night = dayMode === 'night' || (dayMode === 'auto' && auto);
  if (night !== w.night || force) { w.night = night; buildBg(); setDayIcon(); wake(); }
}
const nightFilter = c => { c.filter = w.night ? 'brightness(0.84) saturate(0.88)' : 'none'; };

// ---------- 그리기 ----------
function drawItem(c, atlas, id, x, y, sc, o = {}) {
  const at = data.shared[atlas], it = at.items[id], r = it.rect;
  c.save(); c.translate(x, y); if (o.rot) c.rotate(o.rot); c.scale(sc * (o.flip ? -1 : 1) * (o.sx || 1), sc * (o.sy || 1));
  if (o.alpha != null) c.globalAlpha = o.alpha;
  c.drawImage(imgs[at.file], r[0], r[1], r[2], r[3], -(o.px != null ? o.px : it.pivot[0]), -(o.py != null ? o.py : it.pivot[1]), r[2], r[3]);
  c.restore();
}
function drawPet(q) {
  if (q.hidden) return;
  const o = w.pose(q), fr = o.fr, r = fr.rect, img = imgs[q.ch.sheets[fr.sheet]];
  if (!img) return;
  ctx.save(); ctx.translate(o.x, o.y); if (o.rot) ctx.rotate(o.rot);
  ctx.scale(o.s * o.sx * (o.flip ? -1 : 1), o.s * o.sy);
  if (fr.clip) { ctx.beginPath(); fr.clip.forEach(([x, y], i) => i ? ctx.lineTo(x - o.px, y - o.py) : ctx.moveTo(x - o.px, y - o.py)); ctx.closePath(); ctx.clip(); }
  ctx.drawImage(img, r[0], r[1], r[2], r[3], -o.px, -o.py, r[2], r[3]);
  ctx.restore();
}
function shadow(x, y, rx, a) { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#5a3e2e'; ctx.beginPath(); ctx.ellipse(x, y, rx, rx * .24, 0, 0, 7); ctx.fill(); ctx.restore(); }
function drawFurniture(f) {
  drawItem(ctx, 'furniture', f.item, f.x, f.y, f.s);
  const riders = w.pets.filter(q => q.on === f).sort((a, b) => a.y - b.y);
  if (!riders.length) return;
  for (const q of riders) {
    if (q.dim) ctx.filter = 'brightness(0.62)';   // 숨숨집 안쪽 그늘
    drawPet(q);
    nightFilter(ctx);
  }
  if (f.def.front) drawItem(ctx, 'furniture', f.def.front, f.x, f.y, f.s);   // 앞 파츠(상자 앞판·숨숨집 앞 고리)
}
// 줄: 그림 속 두 매듭을 끝점 A·B 에 맞춰 돌린다
function drawRope(r) {
  if (!r.A) return;
  const bb = r.it.bbox, K = w.props.rope.knots, ka = [bb[0] + K[0][0] * bb[2], bb[1] + K[0][1] * bb[3]], kb = [bb[0] + K[1][0] * bb[2], bb[1] + K[1][1] * bb[3]];
  const [ax, ay] = r.A, [bx, by] = r.B, a0 = Math.atan2(kb[1] - ka[1], kb[0] - ka[0]), kd = Math.hypot(kb[0] - ka[0], kb[1] - ka[1]);
  const sc = r.len / kd;
  drawItem(ctx, 'toys_food', w.props.rope.item, ax, ay, sc, { rot: Math.atan2(by - ay, bx - ax) - a0, px: ka[0], py: ka[1] });
}
function drawFx(front) {
  for (const f of w.fx) {
    if (!!f.front !== front) continue;
    const u = f.t / f.life, it = data.shared.effects.items[f.name];
    const sc = f.size / it.rect[2] * (f.grow ? .7 + u * .6 : 1) * (f.pulse ? 1 + .12 * Math.sin(f.t * 14) : 1);
    drawItem(ctx, 'effects', f.name, f.x, f.y, sc, { alpha: f.alpha * Math.min(1, (1 - u) * 3) * Math.min(1, u * 8 + .2) });
  }
}
function render() {
  const b = w.ball;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bg, pan ? Math.round(dpr * ox) : 0, 0);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
  // 그림자
  for (const q of w.pets) {
    if (q.on || q.hidden || q.glassK > 0) continue;
    const bw = w.bodyW(q.y, q);
    shadow(q.hold ? q.hold.x : q.x, q.y, .43 * bw * (q.hold ? .7 : 1), q.hold ? .1 : .16 * Math.max(.3, 1 - q.z / 300));
  }
  if (!b.heldBy || b.heldBy === 'user') shadow(b.x, b.y, b.r * .9 * Math.max(.4, 1 - b.z / 400), .17);
  for (const t of [w.plush, w.rope]) if (t && !t.heldBy) shadow(t.x, t.y, t.r * .7, .12);
  if (w.treat && w.treat.state !== 'hand') shadow(w.treat.x, w.treat.y, 24, .12);
  shadow(w.bowl.x, w.bowl.y, w.bowl.r * 1.05, .14);
  // 깊이(y) 순서로
  const list = [];
  for (const f of w.furnList) if (!f.def.flat) list.push([f.y, () => drawFurniture(f)]);
  for (const q of w.pets) if (!q.on && !q.hold && q.glassK === 0) list.push([q.y, () => drawPet(q)]);
  list.push([w.bowl.y, () => drawItem(ctx, 'toys_food', w.props.bowl.item, w.bowl.x, w.bowl.y, w.bowl.s)]);
  const sq = o => ({ sx: 1 + o.squash * .5, sy: 1 - o.squash * .6 });
  const bh = b.heldBy && b.heldBy !== 'user' ? b.heldBy : null, bb = b.it.bbox;
  list.push([bh ? bh.y + 1 : b.y, () => drawItem(ctx, 'toys_food', w.props.ball.item, b.x, b.y - b.z - b.r * (1 - b.squash * .6), b.s, Object.assign({ rot: b.rot, px: bb[0] + bb[2] / 2, py: bb[1] + bb[3] / 2 }, sq(b)))]);
  if (w.plush) { const t = w.plush, th = t.heldBy && t.heldBy !== 'user' ? t.heldBy : null; list.push([th ? th.y + 1 : t.y, () => drawItem(ctx, 'toys_food', w.props.plush.item, t.x, t.y - t.z, t.s * (th ? .8 : 1), Object.assign({ flip: th ? th.face < 0 : t.vx < 0 }, sq(t)))]); }
  if (w.rope) { const r = w.rope, rh = r.heldBy && r.heldBy !== 'user' ? r.heldBy : null; list.push([rh ? rh.y + 1 : r.y, () => drawRope(r)]); }
  if (w.treat && w.treat.state !== 'hand') { const t = w.treat; list.push([t.y, () => drawItem(ctx, 'toys_food', w.props.treat.item, t.x, t.y, t.s)]); }
  list.sort((a, c) => a[0] - c[0]);
  nightFilter(ctx);
  for (const [, fn] of list) fn();
  for (const q of w.pets) if (q.hold) drawPet(q);
  ctx.filter = 'none';
  drawFx(false);
  for (const q of w.pets) if (q.glassK > 0) { nightFilter(ctx); drawPet(q); ctx.filter = 'none'; }
  drawFx(true);
  // 손에 든 것: 낚싯대·간식·쓰다듬는 손
  const T = w.teaser, ptr = w.pointer;
  if (T.on && ptr.inside) {
    ctx.strokeStyle = 'rgba(110,80,60,.75)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(ptr.x, ptr.y);
    ctx.quadraticCurveTo((ptr.x + T.x) / 2, Math.max(ptr.y, T.y) + 18, T.x, T.y - 30); ctx.stroke();
    // 막대: 끝(줄 달린 곳)이 포인터, 손잡이는 오른쪽 위 창 밖으로
    const wi = data.shared.toys_food.items.wand, wb = wi.bbox, WP = w.props.wand;
    drawItem(ctx, 'toys_food', WP.item, ptr.x, ptr.y, WP.w / wb[2], { rot: Math.PI, px: wb[0] + WP.tip[0] * wb[2], py: wb[1] + WP.tip[1] * wb[3] });
    // 깃털: 고리에서 아래로 매달려 흔들린다
    const fi = data.shared.toys_food.items.feather, fb = fi.bbox, FP = w.props.feather;
    drawItem(ctx, 'toys_food', FP.item, T.x, T.y - 30, FP.w / fb[2], { rot: FP.hang + clamp(-T.vx * .0007, -.7, .7), px: fb[0] + FP.ring[0] * fb[2], py: fb[1] + FP.ring[1] * fb[3] });
  }
  if (w.treat && w.treat.state === 'hand' && ptr.inside) drawItem(ctx, 'toys_food', w.props.treat.item, w.treat.x, w.treat.y, w.treat.s);
  if (gest && gest.mode === 'stroke') drawItem(ctx, 'ui_icons', 'pet', ptr.x, ptr.y + 20, 150 / data.shared.ui_icons.items.pet.bbox[2], { flip: gest.pet && gest.pet.face < 0, rot: Math.sin(w.t * 9) * .08 });
}

// ---------- 프레임 루프 ----------
let raf = 0, timer = 0, last = 0, errN = 0;
function frame(now) {
  raf = 0;
  const dt = last ? Math.min(.1, (now - last) / 1000) : .016; last = now;
  try { w.update(dt); camMoving = updateCam(dt); render(); w.renders = (w.renders || 0) + 1; errN = 0; }
  catch (e) { if (errN++ < 3) console.error('[mini_pet]', e); if (errN > 120) { w.startScene('calm', 10, undefined, w.pets[0]); errN = 0; } }
  schedule();
}
// 3단계: 위치가 움직일 땐 화면 주사율, 말풍선 같은 잔잔한 것만 있으면 20fps,
// 아무것도 없으면 다음 애니메이션 프레임 "직후"까지 쉰다(직전에 깨면 같은 프레임을 두 번 그린다).
function schedule() {
  if (raf || timer || document.hidden) return;
  if (gest || w.activeHeavy || camMoving) { raf = requestAnimationFrame(frame); return; }
  const wait = w.activeLight ? 50 : Math.max(16, w.nextFrameIn() * 1000 + 3);
  timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, wait);
}
function wake() { if (!w) return; if (timer) { clearTimeout(timer); timer = 0; } schedule(); }
document.addEventListener('visibilitychange', () => { last = 0; wake(); });

// ---------- 입력 ----------
// 동물 위: 누른 채 문지르기 = 쓰다듬기 / 꾹 누르기(0.35초) 또는 위로 끌기 = 들기 / 짧게 누르기 = 클릭
// 공·인형·줄: 끌어서 던지기, 짧게 누르면 톡 / 빈 곳: 유리 톡톡(간식을 들고 있으면 떨어뜨리기)
let gest = null, lastMoveT = 0, ptrType = 'mouse';
cv.addEventListener('pointerdown', e => {
  ptrType = e.pointerType;
  if (!w || e.button !== 0) return;
  if (window.MP_AUDIO) MP_AUDIO.unlock();
  closeMenu();
  cv.setPointerCapture(e.pointerId);
  const [x, y] = toWorld(e), t = performance.now();
  w.input('pointer', { x, y });
  if (w.teaser.on) { gest = { kind: 'none' }; return wake(); }
  if (w.treat && w.treat.state === 'hand') { w.input('tapGlass', { x, y }); gest = { kind: 'none' }; return wake(); }
  const hitQ = w.petAt(x, y);
  if (hitQ) {
    focusQ = hitQ;
    gest = { kind: 'pet', pet: hitQ, x0: x, y0: y, t0: t, mode: null };
    gest.timer = setTimeout(() => { if (gest && gest.kind === 'pet' && !gest.mode) startLift(); }, 350);
  } else {
    const k = w.hitProp(x, y);
    gest = k ? { kind: 'prop', prop: k, x0: x, y0: y, t0: t, grabbed: false } : { kind: 'empty', x0: x, y0: y, t0: t };
  }
  wake();
});
function startLift() { gest.mode = 'lift'; w.input('liftStart', { x: w.pointer.x, y: w.pointer.y, pet: gest.pet }); cv.style.cursor = 'grabbing'; wake(); }
cv.addEventListener('pointermove', e => {
  if (!w) return;
  const [x, y] = toWorld(e), t = performance.now(), dt = Math.max(.004, (t - (lastMoveT || t)) / 1000); lastMoveT = t;
  w.input('pointer', { x, y });
  if (gest && gest.kind === 'pet') {
    // 화면 픽셀로 판정: 처음 10px 이상 움직인 방향이 위쪽(대각선 포함, 약 30도 이상)이면 들기, 아니면 문지르기
    const dx = (x - gest.x0) * s, dy = (y - gest.y0) * s;
    if (!gest.mode && Math.hypot(dx, dy) > 10) {
      if (-dy > 4 && -dy > Math.abs(dx) * .6) startLift();
      else { gest.mode = 'stroke'; w.input('strokeStart', { pet: gest.pet }); }
    }
    if (gest.mode === 'stroke') w.input('stroke');
    if (gest.mode === 'lift') w.input('dragMove', { x, y, dt });
  } else if (gest && gest.kind === 'prop') {
    if (!gest.grabbed && Math.hypot(x - gest.x0, y - gest.y0) > 12) { gest.grabbed = true; w.input('grab', { kind: gest.prop, x, y }); }
    if (gest.grabbed) w.input('dragMove', { x, y, dt });
  }
  updateCursor(x, y);
  wake();
});
function endGesture(cancel) {
  const gq = gest; gest = null;
  if (!gq) return;
  clearTimeout(gq.timer);
  if (gq.kind === 'pet') { if (gq.mode === 'lift') w.input('dragEnd'); else if (gq.mode === 'stroke') w.input('strokeEnd'); else if (!cancel) w.input('tapPet', { pet: gq.pet }); }
  else if (gq.kind === 'prop') { if (gq.grabbed) w.input('dragEnd'); else if (!cancel) w.input('tapProp', { kind: gq.prop }); }
  else if (gq.kind === 'empty' && !cancel) w.input('tapGlass', { x: gq.x0, y: gq.y0 });
  cv.style.cursor = '';
  wake();
}
cv.addEventListener('pointerup', () => endGesture(false));
cv.addEventListener('pointercancel', () => endGesture(true));
cv.addEventListener('lostpointercapture', () => { if (gest) endGesture(true); });
cv.addEventListener('pointerleave', () => { if (w) { w.input('pointer', { x: w.pointer.x, y: w.pointer.y, inside: false }); wake(); } });
// 터치 길게 누르기도 contextmenu 를 낸다 — 우클릭(마우스)일 때만 낚싯대·간식을 내려놓는다
cv.addEventListener('contextmenu', e => { e.preventDefault(); if (ptrType === 'mouse') cancelModes(); });
addEventListener('keydown', e => { if (e.key === 'Escape') { if (document.body.classList.contains('ui')) closeMenu(); else cancelModes(); } });
function cancelModes() { if (!w) return; if (w.teaser.on) toggle('teaser'); if (w.treat && w.treat.state === 'hand') toggle('treat'); }
function updateCursor(x, y) {
  if (gest && gest.mode === 'lift') return;
  const hand = w.teaser.on || (w.treat && w.treat.state === 'hand') || (gest && gest.mode === 'stroke');
  cv.style.cursor = hand ? 'none' : w.petAt(x, y) || w.hitProp(x, y) ? 'grab' : '';
}

// ---------- 메뉴(오른쪽 위 발바닥 버튼 → 열림) ----------
const buttons = {};
function icon(atlas, id, size) {
  const at = data.shared[atlas], r = at.items[id].rect, k = size / Math.max(r[2], r[3]), im = imgs[at.file];
  const i = document.createElement('i');
  i.style.cssText = `display:block;margin:auto;width:${r[2] * k}px;height:${r[3] * k}px;background:url("${cfg.assetBase + at.file}") -${r[0] * k}px -${r[1] * k}px / ${im.width * k}px ${im.height * k}px no-repeat`;
  return i;
}
function openMenu() { document.body.classList.add('ui'); menuBtn.setAttribute('aria-expanded', 'true'); syncButtons(); }
function closeMenu() { document.body.classList.remove('ui'); menuBtn.setAttribute('aria-expanded', 'false'); }
function toggleMenu() { document.body.classList.contains('ui') ? closeMenu() : openMenu(); }
function buildBar() {
  menuBtn.append(icon('effects', 'paw_stamp', 22));
  menuBtn.onclick = () => { if (window.MP_AUDIO) MP_AUDIO.unlock(); toggleMenu(); };
  const add = (id, label, atlas, item, onClick, pressable) => {
    const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
    if (pressable) b.setAttribute('aria-pressed', 'false');
    b.append(icon(atlas, item, 26)); b.onclick = () => { onClick(); syncButtons(); wake(); };
    bar.append(b); buttons[id] = b;
  };
  add('ball', '공 던져 주기', 'ui_icons', 'toy', () => w.input('toy', { kind: 'ball' }));
  add('teaser', '낚싯대 (Esc 로 내려놓기)', 'toys_food', 'feather', () => { toggle('teaser'); if (w.teaser.on) closeMenu(); }, true);
  add('plush', '물고기 인형 꺼내기/치우기', 'toys_food', 'fish_plush', () => toggle('plush'), true);
  add('rope', '줄 장난감 꺼내기/치우기', 'toys_food', 'tug_rope', () => toggle('rope'), true);
  add('treat', '간식 주기 (손에 들고 빈 곳을 누르면 떨어뜨림)', 'ui_icons', 'food', () => { toggle('treat'); if (w.treat) closeMenu(); }, true);
  add('day', '낮·밤', 'ui_icons', 'sun', () => { dayMode = { auto: 'day', day: 'night', night: 'auto' }[dayMode]; updateNight(true); store(); });
  add('sound', '소리 (만질 때만 남)', 'ui_icons', 'sound', () => { soundOn = !soundOn; syncButtons(); store(); }, true);
  if (data.available.length > 1) {
    add('pet', '동물 바꾸기', 'ui_icons', 'select_pet', switchAnimal);
    add('friend', '친구 (둘이 모드)', 'ui_icons', 'home', switchFriend, true);
  }
  setPetTitle();
  syncButtons();
}
function toggle(id) {
  if (id === 'teaser') w.input('teaser', { on: !w.teaser.on });
  if (id === 'treat') w.input('treat', { on: !(w.treat && w.treat.state === 'hand') });
  if (id === 'plush' || id === 'rope') w.input('toy', { kind: id, on: !w[id] });
  if (id === 'teaser' && w.teaser.on && w.treat && w.treat.state === 'hand') w.input('treat', { on: false });
  if (id === 'treat' && w.treat && w.teaser.on) w.input('teaser', { on: false });
  syncButtons(); store(); wake();
}
function syncButtons() {
  const on = { teaser: w.teaser.on, plush: !!w.plush, rope: !!w.rope, treat: !!(w.treat && w.treat.state === 'hand'), sound: soundOn, friend: w.pets.length > 1 };
  for (const [k, v] of Object.entries(on)) if (buttons[k]) buttons[k].setAttribute('aria-pressed', String(v));
}
let switching = false;
async function switchAnimal() {
  if (switching) return;
  const a = data.available, next = a[(a.indexOf(w.pets[0].ch.id) + 1) % a.length];
  switching = true;
  try { await loadAnimal(next); w.setCharacter(next); } catch (e) { console.error('동물 시트 읽기 실패', e); }
  switching = false;
  setPetTitle(); store(); wake();
}
// 친구 버튼: 없음 → 고양이 → … → 토끼 → 없음 순환
async function switchFriend() {
  if (switching) return;
  const a = data.available, cur = w.pets[1] ? w.pets[1].ch.id : null;
  const next = cur == null ? a[0] : (a.indexOf(cur) + 1 < a.length ? a[a.indexOf(cur) + 1] : null);
  switching = true;
  try { if (next) await loadAnimal(next); w.setFriend(next); } catch (e) { console.error('동물 시트 읽기 실패', e); }
  switching = false;
  setPetTitle(); syncButtons(); store(); wake();
}
const petName = id => (cfg.pet.names && cfg.pet.names[id]) || id;
function setPetTitle() {
  if (buttons.pet) { const t = '동물 바꾸기 (지금: ' + petName(w.pets[0].ch.id) + ')'; buttons.pet.title = t; buttons.pet.setAttribute('aria-label', t); }
  if (buttons.friend) { const t = '친구 (지금: ' + (w.pets[1] ? petName(w.pets[1].ch.id) : '없음') + ')'; buttons.friend.title = t; buttons.friend.setAttribute('aria-label', t); }
}
function setDayIcon() {
  const b = buttons.day; if (!b) return;
  b.replaceChildren(icon('ui_icons', w.night ? 'moon' : 'sun', 26));
  const t = { auto: '낮·밤: 자동(시계)', day: '낮·밤: 낮 고정', night: '낮·밤: 밤 고정' }[dayMode];
  b.title = t; b.setAttribute('aria-label', t); b.dataset.mode = dayMode;
}
})();
