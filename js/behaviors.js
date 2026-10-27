// 행동 시스템: 짧은 생활 장면(제너레이터) + 다음 장면 고르기 + 사용자 반응.
// 동물 종류와 무관하게 공통 행동 ID 만 쓴다. 장면은 기준 자세(정면 식빵)로 끝나게 짠다.
(function (g) {
'use strict';
const MP = g.MP;
const { clamp } = MP.util;
const S = MP.scenes = {};
const play = (id, o) => Object.assign({ play: id }, o);
const wait = s => ({ wait: s });
const until = (fn, max, id, o) => Object.assign({ until: fn, max, play2: id, loop: true }, o);

const side = (w, p) => w.cfg.pet.side.includes(p.anim.id);
// 놀고 나서 재미 채우기: 사용자가 시작한 장면이면 크게, 혼자 논 거면 조금
const fun = (w, p, user, self) => { p.needs.fun = clamp(p.needs.fun + (p.scene && p.scene.prio > 10 ? user : self), 0, 1); };
const strokeOn = w => w.stroke.active && w.t - w.stroke.lastT < .6;
const watching = w => w.pointer.inside && w.t - w.pointer.moveT < 2.5 && !w.drag;

function* faceFront(w, p) { if (side(w, p)) yield play('turn', { frames: [1, 0], fps: 14 }); }
function* faceToward(w, p, x) {
  const dir = Math.sign(x - p.x) || p.face;
  if (dir === p.face) return;
  if (side(w, p)) yield play('turn', { frames: [2, 3, 4], fps: 14 });
  p.face = dir;
}
// 올라가 있거나 들어가 있는 곳에서 먼저 나온다
function* leave(w, p, tx) {
  const f = p.on;
  if (!f) return;
  if (f === 'glass') { p.on = null; p.glassK = 0; return; }
  if (f.kind === 'tunnel') {
    p.hidden = false; p.face = 1;
    yield { move: [f.hole.x + f.hole.rx + 110, f.y + 6], gait: 'walk', stop: false, skip: f };
    p.on = null; return;
  }
  const dir = Math.sign((tx == null ? p.x : tx) - f.x) || 1;
  const [x, y] = w.clampFloor(f.x + dir * f.wpx * .22, f.y + 55);
  p.dim = false;
  yield { jump: [x, y], z1: 0, h: f.kind === 'box' || f.kind === 'cave' ? 95 : 55, exit: true };
  p.on = null; p.z = 0;
}
function* goTo(w, p, x, y, gait = 'walk', o) {
  if (p.on) yield* leave(w, p, x);
  yield Object.assign({ move: [x, y], gait }, o);
}
function* goOnto(w, p, f) {
  if (p.on === f) return;
  const x = f.x + w.R.range(-.1, .1) * f.wpx;
  yield* goTo(w, p, x, f.y + 55, 'walk', { skip: f });
  yield { jump: [x, f.y - 3], z1: f.seatZ, h: f.kind === 'box' || f.kind === 'cave' ? 110 : 60, enter: f };
  p.on = f;
}
function* sleepFor(w, p, dur) {
  p.asleep = true;
  try {
    const end = w.t + dur;
    while (w.t < end) {
      yield play('sleep', { dur: Math.min(8, Math.max(.5, end - w.t)) });
      if (p.needs.energy > .98 && !w.night && w.R.chance(.3)) break;
    }
  } finally { p.asleep = false; }
}
// 포인터를 눈으로 따라간다(두리번 프레임을 방향에 맞춰 고름)
function lookFrame(w, p) {
  const L = w.cfg.pet.look, [hx, hy] = w.anchor(p, 'top');
  const dx = (w.pointer.x - hx) * p.face, dy = hy - w.pointer.y;
  if (Math.hypot(dx, dy) < 90 || (dy < -60 && Math.abs(dx) < 240)) return L.front;
  const a = Math.atan2(dy, dx);
  if (a > 2.5 || a < -1.9) return L.left;
  if (a > 1.95) return L.upLeft;
  if (a > 1.2) return L.up;
  if (a > .5) return L.upRight;
  return L.right;
}
function* watch(w, p, dur) {
  const end = w.t + dur;
  while (w.t < end && watching(w) && !p.on) {
    if (p.overT > 2.5) { yield play('shy'); w.headFx('hearts', { size: 40 }); p.overT = -6; return; }
    yield play('look_around', { frames: [lookFrame(w, p)], dur: .35 });
  }
}
function* avoid(w, p) {
  const dir = Math.sign(p.x - w.pointer.x) || 1;
  const [x, y] = w.clampFloor(p.x + dir * w.R.range(300, 520), p.y + w.R.range(-60, 60));
  yield* goTo(w, p, x, y, 'run', { maxTime: 5 });
  yield play('sulk');
}
function* calmBit(w, p, dur) {
  const end = w.t + dur;
  while (w.t < end) {
    if (watching(w) && !p.on) { yield* watch(w, p, 4); continue; }
    yield play('idle_breathe', { dur: w.R.range(2, 4.5) });
    if (w.R.chance(.5)) yield play('blink');
  }
}

// ================= 자율 장면 =================
S.calm = function* (w, p) {
  yield* faceFront(w, p);
  yield* calmBit(w, p, w.R.range(12, 35));
  if (w.R.chance(.3)) yield play('look_around');
};
// 두리번 → 걷기 → 앉기 → (세수)
S.stroll = function* (w, p) {
  yield* faceFront(w, p);
  if (w.R.chance(.5)) yield play('look_around');
  const [x, y] = w.spot(p, 220, 700);
  yield* goTo(w, p, x, y, w.R.chance(.15) ? 'run' : 'walk');
  yield play('sit_down');
  if (w.R.chance(.45)) yield play('wash_face');
  yield* calmBit(w, p, w.R.range(2, 5));
};
S.groom = function* (w, p) {
  yield* faceFront(w, p);
  yield play('wash_face', { loops: w.R.int(1, 2) });
  if (w.R.chance(.6)) yield play('scratch', { loops: 2 });
  if (w.R.chance(.5)) yield play('shake');
  if (w.R.chance(.5)) yield play('stretch');
  yield play('idle_breathe', { dur: 2 });
};
// 두리번 → 걷기 → (침대·쿠션으로 폴짝) → 앉기 → 세수 → 하품 → 눕기 → 수면 → 깨기 → 기지개
S.nap = function* (w, p) {
  if (w.plush && !w.plush.heldBy && w.R.chance(.3)) { yield* S.plush(w, p, true); return; }
  yield* faceFront(w, p);
  const beds = w.furnList.filter(f => f.def.rest);
  const f = w.R.chance(.85) && beds.length ? (p.on && p.on.def && p.on.def.rest ? p.on : w.R.pick(beds)) : null;
  if (w.R.chance(.5)) yield play('look_around');
  if (f) yield* goOnto(w, p, f);
  else { const [x, y] = w.spot(p, 100, 500); yield* goTo(w, p, x, y); }
  yield* faceFront(w, p);
  yield play('sit_down', { from: 2 });
  if (w.R.chance(.5)) yield play('wash_face');
  yield play('yawn');
  yield play('lie_down');
  yield* sleepFor(w, p, w.night ? w.R.range(400, 1000) : w.R.range(200, 480));
  yield play('wake');
  if (w.R.chance(.6)) yield play('stretch');
  if (w.R.chance(.3)) yield play('shake');
};
// 꼬리 잡기 → 뒹굴기 → 일어나기 → 아무 일 없던 듯 대기
S.tail = function* (w, p) {
  yield* faceFront(w, p);
  yield play('chase_tail', { loops: w.R.int(2, 3), speed: 1.15 });
  yield play('roll_play');
  yield play('idle_breathe', { dur: 1.2 });
  yield play('blink');
  if (w.R.chance(.5)) yield play('wash_face');
  fun(w, p, .1, .1 * .3);
};
S.pawplay = function* (w, p) {
  yield* faceFront(w, p);
  yield play('paw_play', { loops: w.R.int(2, 4) });
  if (w.R.chance(.6)) yield play('shadow_pounce', { glide: { from: 2, to: 3, dx: 70 } });
  if (w.R.chance(.4)) yield play('happy');
  fun(w, p, .1, .1 * .3);
};
// 갑자기 우다다 → 방 끝까지 왕복 → 멈춰서 세수(아무 일 없던 듯)
S.zoomies = function* (w, p) {
  yield* faceFront(w, p);
  yield play('startled', { speed: 1.5 });
  w.headFx('surprise', { size: 60 });
  const R = w.R, room = w.room;
  for (let i = R.int(2, 4); i > 0; i--) {
    const x = p.x < room.w / 2 ? R.range(1050, 1380) : R.range(160, 480);
    yield* goTo(w, p, x, R.range(w.floorTopNow() + 30, room.floorBottom - 20), 'zoomies', { stop: false });
  }
  yield* faceFront(w, p);
  yield play('sit_down', { from: 2 });
  yield play('wash_face');
  fun(w, p, .2, .2 * .3); p.needs.energy = clamp(p.needs.energy - .04, 0, 1);
};
// 무언가 발견 → 살금살금 → 덮치기 → 발 장난
S.hunt = function* (w, p) {
  const [x, y] = w.spot(p, 260, 520);
  yield* faceToward(w, p, x);
  w.headFx('question', { size: 44 });
  yield play('ball_notice');
  yield* goTo(w, p, x - Math.sign(x - p.x) * 120, y, 'sneak', { stop: false });
  yield play('shadow_pounce', { glide: { from: 2, to: 3, dx: 90 } });
  yield play('paw_play');
  yield* faceFront(w, p);
  yield play('idle_breathe', { dur: 1.5 });
  fun(w, p, .1, .1 * .3);
};
// 심심해 → 놀아줘 → 기다리기 → (반응 있으면 기쁨, 없으면 삐지고 혼자 놀기)
S.attention = function* (w, p) {
  yield* faceFront(w, p);
  w.headFx('bored_dots', { size: 66 });
  yield play('bored', { loops: 2 });
  const t0 = w.t;
  const ok = yield until(() => w.userT > t0, w.R.range(7, 11), 'ask_play');
  if (ok) { yield play('happy'); fun(w, p, .15, .15); return; }
  yield play('sulk');
  yield* (w.R.chance(.5) ? S.tail(w, p) : S.pawplay(w, p));
  p.needs.fun = clamp(p.needs.fun + .15, 0, 1);
};
// 화면 앞 유리를 톡톡 → 반응 없으면 찐빵 또는 삐짐
S.tapwin = function* (w, p) {
  yield* goTo(w, p, clamp(p.x + w.R.range(-150, 150), 220, w.room.w - 220), w.room.floorBottom - 10);
  yield* tapGlass(w, p, w.R.int(2, 3));
  const t0 = w.t;
  const ok = yield until(() => w.userT > t0, 6, 'idle_breathe');
  if (ok) { yield play('happy'); return; }
  if (w.R.chance(.55)) yield* S.glass(w, p); else yield play('sulk');
};
function* tapGlass(w, p, n) {
  yield* faceFront(w, p);
  const ripple = () => { const [x, y] = w.anchor(p, 'top'), q = w.bodyW(); w.addFx('tap_ripple', x + p.face * .23 * q, y + .3 * q, { size: 48 }); };
  for (let i = 0; i < n; i++) yield play('tap_window', { on: { 3: ripple } });
}
// 창문 찐빵: 유리에 붙기 → 눌린 채 유지 → 미끄러지기 → 떨어지기
S.glass = function* (w, p) {
  if (w.pets.some(q => q !== p && (q.glassK > 0 || q.on === 'glass'))) return;
  if (p.y < w.room.floorBottom - 45 || p.on) yield* goTo(w, p, p.x, w.room.floorBottom - 10);
  yield* faceFront(w, p);
  p.on = 'glass'; p.glassX = p.x;
  try {
    yield play('glass_press', { fps: 7, each: () => { p.glassK = w.animProgress(); } });
    p.glassK = 1;
    // 유리 반짝임: 얼굴 위가 아니라 오른쪽 위(귀 언저리) 유리면에
    const o = w.pose(), fb = o.fr.bbox, bw = fb[2] * o.s, bx = o.x + (fb[0] - o.px) * o.s, by = o.y + (fb[1] - o.py) * o.s;
    w.addFx('glass_shine', bx + bw * .9, by + bw * .22, { size: bw * .15 });
    yield play('glass_hold', { dur: w.R.range(3, 6) });
    yield play('glass_slide');
    const o2 = w.pose(), q = o2.fr.bbox[2] * o2.s;
    for (const k of [-.28, .28]) w.addFx('paw_stamp', o2.x + k * q, o2.y - o2.fr.bbox[3] * o2.s * .6, { size: q * .16, alpha: .45 });
    yield play('glass_release', { each: () => { p.glassK = 1 - w.animProgress(); } });
  } finally { p.on = null; p.glassK = 0; }
  if (w.R.chance(.6)) yield play('shake'); else yield play('wash_face');
};
// 밥그릇: 냄새 → 먹기 → 만족 → 세수
S.eat = function* (w, p) {
  const b = w.bowl;
  yield* goTo(w, p, b.x, b.y - 20);
  yield* faceFront(w, p);
  yield play('sniff');
  yield play('eat', { loops: w.R.int(3, 5) });
  p.needs.hunger = .05;
  yield play('satisfied');
  w.headFx('sparkles', { size: 56 });
  if (w.R.chance(.6)) yield play('wash_face');
};
// 공: 발견 → 접근 → 앞발로 밀기(접촉 프레임에 공에 힘) → 추격 → 안기
function* approachBall(w, p, maxT = 7) {
  const b = w.ball;
  const reach = () => Math.max(40, w.reachOf('ball_push', 2, p)) + b.r * .3;
  return yield {
    chase: () => (b.heldBy ? null : [b.x - (Math.sign(b.x - p.x) || p.face) * reach(), b.y]),
    gait: dx => (Math.abs(dx) > 420 || Math.hypot(b.vx, b.vy) > 220 ? 'ball_chase' : Math.abs(dx) > 170 ? 'walk' : 'sneak'),
    near: (dx, dy) => Math.abs(dx) < 28 && Math.abs(dy) < 30 && b.z < 30, max: maxT,
  };
}
function kick(w, p) {
  const b = w.ball, reach = w.reachOf('ball_push', 2, p) + b.r * .3;
  if (b.heldBy || Math.abs(b.x - (p.x + p.face * reach)) > b.r + 50 || Math.abs(b.y - p.y) > 55) return;
  b.vx = p.face * w.R.range(380, 650); b.vy = w.R.range(-90, 90); b.vz = w.R.range(90, 240); b.squash = .3;
  fun(w, p, .05, .05 * .3);
}
S.ball = function* (w, p) {
  const b = w.ball;
  try {
    yield* faceToward(w, p, b.x);
    w.headFx('question', { size: 44 });
    yield play('ball_notice');
    for (let n = w.R.int(1, 3), tries = 0; n > 0 && tries < 6; tries++) {
      if (!(yield* approachBall(w, p))) break;
      yield* faceToward(w, p, b.x);
      yield play('ball_push', { on: { 2: () => kick(w, p) } });
      n--;
    }
    if (yield* approachBall(w, p)) {
      yield* faceToward(w, p, b.x);
      yield play('ball_hug', { to: 3, glide: { from: 1, to: 2, dx: 30 }, on: { 3: () => { if (!b.heldBy && Math.abs(b.x - p.x) < 170 && Math.abs(b.y - p.y) < 60) b.heldBy = p; } } });
      if (b.heldBy === p) { if (p.scene && p.scene.prio > 10) w.say('happy'); yield play('ball_hug', { frames: [4, 5], pingpong: false, dur: w.R.range(2, 4) }); }
    }
  } finally { if (b.heldBy === p) { b.heldBy = null; b.vx = p.face * 90; b.vz = 60; } }
  yield* faceFront(w, p);
  yield play('idle_breathe', { dur: 1.5 });
  fun(w, p, .15, .15 * .3);
};
// 물고기 인형: 물기 → (졸리면) 안고 졸기 / (아니면) 발 장난
S.plush = function* (w, p, sleepy) {
  const t = w.plush; if (!t) return;
  try {
    const bite = () => Math.max(30, (w.frameOf('toy_bite', 2).mouth[0] - w.frameOf('toy_bite', 2).pivot[0]) * w.petScale()) + t.r * .25;
    const ok = yield { chase: () => (w.plush === t ? [t.x - (Math.sign(t.x - p.x) || 1) * bite(), t.y] : null), gait: dx => Math.abs(dx) > 400 ? 'run' : 'walk', near: (dx, dy) => Math.abs(dx) < 25 && Math.abs(dy) < 30, max: 10 };
    if (!ok) return;
    yield* faceToward(w, p, t.x);
    yield play('toy_bite', { on: { 2: () => { t.squash = .35; } } });
    if (sleepy || ((p.needs.energy < .65 || w.night) && w.R.chance(.75))) {
      yield* faceFront(w, p);
      yield play('toy_nap', { to: 2, on: { 2: () => { t.heldBy = p; } } });
      t.heldBy = p;
      yield play('toy_nap', { from: 3 });
      p.asleep = true;
      try { yield play('toy_nap', { frames: [5], dur: sleepy ? w.R.range(120, 300) : w.R.range(25, 70) }); } finally { p.asleep = false; }
      yield play('wake');
    } else {
      yield* faceFront(w, p);
      yield play('paw_play', { on: { 3: () => { t.vx = p.face * 140; t.squash = .3; } } });
      yield play('happy');
    }
  } finally { if (t.heldBy === p) t.heldBy = null; }
  fun(w, p, .12, .12 * .3);
};
// 줄 장난감: 물기 → 줄 당기기(사용자가 반대쪽을 끌면 줄다리기) → 놓기
S.rope = function* (w, p) {
  const r = w.rope; if (!r) return;
  try {
    const endX = () => r.x - Math.cos(r.ang) * r.len / 2;
    const bite = () => Math.max(30, (w.frameOf('toy_bite', 2).mouth[0] - w.frameOf('toy_bite', 2).pivot[0]) * w.petScale());
    const ok = yield { chase: () => (w.rope === r ? [endX() - (Math.sign(endX() - p.x) || 1) * bite(), r.y] : null), gait: 'walk', near: (dx, dy) => Math.abs(dx) < 25 && Math.abs(dy) < 30, max: 10 };
    if (!ok) return;
    yield* faceToward(w, p, r.x);
    yield play('toy_bite', { to: 2, on: { 2: () => { r.heldBy = p; r.pulled = 0; } } });
    r.heldBy = p;
    yield play('tug', { dur: w.R.range(3, 6), each: () => { if (w.drag && w.drag.kind === 'rope') p.anim.fps = 10; } });
    while (w.drag && w.drag.kind === 'rope') yield play('tug', { dur: 1 });   // 줄다리기 중이면 계속
    r.heldBy = null;
    if (r.pulled > 60) { yield play('tumble_recover'); w.headFx('sweat', { size: 36 }); }
    else yield play('toy_bite', { from: 3 });
    yield* faceFront(w, p);
    yield play('happy');
  } finally { if (r.heldBy === p) r.heldBy = null; }
  fun(w, p, .12, .12 * .3);
};
// 상자: 폴짝 들어가기 → 웅크려 숨기 → 빼꼼 (나갈 때는 다음 장면이 뛰어나온다)
S.box = function* (w, p) {
  const b = w.furn.box; if (!b) return;
  yield* goOnto(w, p, b);
  p.face = 1;
  yield play('box_enter', { to: 4 });
  p.boxHide = true;
  try {
    yield play('box_enter', { frames: [4], dur: w.R.range(4, 9) });
    yield play('peek');
    if (w.R.chance(.5)) { yield play('box_enter', { frames: [4], dur: w.R.range(2, 5) }); yield play('peek'); }
  } finally { p.boxHide = false; }
  yield play('idle_breathe', { dur: w.R.range(2, 4) });
};
// 터널: 입구로 들어가 사라짐 → 입구에서 빼꼼 → 나오기(가끔 우다다)
S.tunnel = function* (w, p) {
  const t = w.furn.tunnel; if (!t) return;
  if (t.kind === 'cave') { yield* cave(w, p, t); return; }
  const H = t.hole, y = t.y + 6;
  yield* goTo(w, p, H.x + H.rx + 120, y, 'walk', { stop: false, skip: t });
  yield* faceToward(w, p, t.x);
  p.on = t;
  try {
    yield { move: [H.x + t.def.deep * t.wpx, y], gait: 'walk', stop: false, skip: t };
    p.hidden = true;
    yield play('idle_breathe', { dur: w.R.range(3, 8) });
    p.hidden = false; p.x = H.x - 4; p.face = 1;
    yield play('peek');
    if (w.R.chance(.5)) yield play('peek');
  } finally { p.hidden = false; }
  const run = w.R.chance(.35);
  yield { move: [H.x + H.rx + 150, y], gait: run ? 'zoomies' : 'walk', stop: !run, skip: t };
  p.on = null;
  if (run) yield* S.zoomies(w, p);
};

// 정면 숨숨집: 폴짝 들어가 → 안쪽 그늘에 웅크려 숨기 → 입구로 빼꼼 (나갈 때는 다음 장면이 뛰어나온다)
function* cave(w, p, t) {
  yield* goOnto(w, p, t);
  p.face = 1;
  yield play('lie_down');
  p.dim = true;
  try {
    yield play('sleep', { dur: w.R.range(4, 9) });
    p.dim = false;
    yield play('wake', { speed: 1.3 });
    yield play('peek');
    if (w.R.chance(.5)) yield play('peek');
  } finally { p.dim = false; }
  yield play('idle_breathe', { dur: w.R.range(2, 4) });
}

// ================= 둘이 장면 (친구 모드) =================
const buddyOf = (w, p) => w.pets.length > 1 ? w.pets.find(q => q !== p) : null;
const buddyFree = q => !!q && !q.hold && q.glassK === 0 && !q.hidden && !q.asleep && q.on !== 'glass' && (!q.scene || q.scene.prio <= 10 || q.scene.name === 'social_follow');
S.social = function* (w, p) {
  const q = buddyOf(w, p);
  if (!buddyFree(q) || p.hold || p.glassK > 0) return;
  const R = w.R;
  // 짜증나 있을수록 티격태격, 아니면 비비기/같이 뛰기
  const mode = R() < clamp(.14 + p.mood.annoy * .5 + q.mood.annoy * .3, .1, .55) ? 'squabble' : R.chance(.5) ? 'play' : 'nuzzle';
  const duet = { leader: p, mode, phase: 'meet', done: false, partnerDone: false };
  if (p.on) yield* leave(w, p, q.x);
  const near = () => [q.x - (Math.sign(q.x - p.x) || 1) * w.bodyW(q.y, q) * .85, clamp(q.y, w.floorTopNow(), w.room.floorBottom)];
  const ok = yield { chase: () => (buddyFree(q) && !q.on ? near() : null), gait: 'walk', near: (dx, dy) => Math.abs(dx) < 55 && Math.abs(dy) < 50, max: 9 };
  if (!ok || !buddyFree(q) || q.on) return;
  w.startScene('social_follow', 45, duet, q);
  duet.lead = p.scene;   // 상대가 리더 생존 확인용
  try {
    yield* faceToward(w, p, q.x);
    if (mode === 'nuzzle') {
      duet.phase = 'rub';
      yield play('rub', { loops: 2 });
      w.headFx('hearts', { size: 58 });
      p.mood.affection = clamp(p.mood.affection + .05, 0, 1); q.mood.affection = clamp(q.mood.affection + .05, 0, 1);
      p.needs.fun = clamp(p.needs.fun + .08, 0, 1); q.needs.fun = clamp(q.needs.fun + .08, 0, 1);
      duet.phase = 'end';
      yield play('happy');
    } else if (mode === 'play') {
      duet.phase = 'invite';
      yield play('ask_play');
      duet.phase = 'flee';
      yield { chase: () => (duet.done || q.hold ? null : [q.x - (Math.sign(q.x - p.x) || 1) * 130, q.y]), gait: 'run', near: (dx, dy) => Math.abs(dx) < 100 && Math.abs(dy) < 55, max: 7 };
      duet.phase = 'end';
      w.headFx('sparkles', { size: 60 });
      p.needs.fun = clamp(p.needs.fun + .12, 0, 1); q.needs.fun = clamp(q.needs.fun + .12, 0, 1);
      p.needs.energy = clamp(p.needs.energy - .03, 0, 1);
      yield play('happy');
    } else {   // squabble: 마주 보고 으르렁 → 덮치기 → 상대는 데굴 → 도망, 둘 다 뾰로통
      duet.phase = 'face';
      w.headFx('anger', { size: 56 });
      yield play('angry', { loops: 2 });
      yield play('shadow_pounce', { glide: { from: 2, to: 3, dx: Math.min(Math.abs(q.x - p.x) * .5, 120) } });
      w.addFx('dust', (p.x + q.x) / 2, Math.max(p.y, q.y) + 2, { size: 120, alpha: .8 });
      duet.phase = 'hit';
      p.mood.annoy = clamp(p.mood.annoy + .1, 0, 1); q.mood.annoy = clamp(q.mood.annoy + .2, 0, 1);
      yield play('shake');
      yield play('sulk');
    }
    yield { until: () => duet.partnerDone || duet.done, max: 8 };
  } finally { duet.done = true; }
  yield* faceFront(w, p);
};
// 상대 역: 단계(duet.phase)를 보고 맞춰 준다. 중간에 사용자가 끼어들면 그대로 끝난다.
S.social_follow = function* (w, p, duet) {
  if (!duet || duet.leader === p) return;
  const L = duet.leader, t0 = w.t;
  const live = () => !duet.done && (!duet.lead || L.scene === duet.lead) && w.t - t0 < 60;
  try {
    while (live()) {
      const ph = duet.phase;
      if (ph === 'meet') { yield* faceToward(w, p, L.x); yield { until: () => !live() || duet.phase !== 'meet', max: 6 }; }
      else if (ph === 'rub') { yield* faceToward(w, p, L.x); yield play('rub', { loops: 2 }); w.headFx('hearts', { size: 50 }); yield { until: () => !live() || duet.phase !== 'rub', max: 6 }; }
      else if (ph === 'invite') { yield* faceToward(w, p, L.x); yield play('happy'); yield { until: () => !live() || duet.phase !== 'invite', max: 5 }; }
      else if (ph === 'flee') { if (!live()) break; const [x, y] = w.spot(p, 280, 650); yield { move: [x, y], gait: 'zoomies', stop: false, maxTime: 2.2 }; }
      else if (ph === 'face') { yield* faceToward(w, p, L.x); w.headFx('anger', { size: 52 }); yield play('angry', { loops: 2 }); yield { until: () => !live() || duet.phase !== 'face', max: 6 }; }
      else if (ph === 'hit') {
        w.headFx('sweat', { size: 42 });
        yield play('tumble_recover');
        const dir = Math.sign(p.x - L.x) || 1;
        const [x, y] = w.clampFloor(p.x + dir * w.R.range(280, 460), p.y + w.R.range(-40, 40));
        yield { move: [x, y], gait: 'run', maxTime: 4 };
        yield play('sulk');
        break;
      }
      else if (ph === 'end') { yield play('happy'); break; }
      else yield { wait: .2 };
    }
  } finally { duet.partnerDone = true; }
  yield* faceFront(w, p);
};

// ================= 사용자 반응 장면 =================
// 집어 들기: 들어 올림 → 매달림(흔들·늘어짐) → 놓으면 내려놓기 또는 떨어져 데굴 → 일어나기
S.held = function* (w, p) {
  p.on = null; p.glassK = 0; p.hidden = false; p.z = 0;
  yield play('picked_up', { speed: 1.8 });
  yield until(() => !w.drag || w.drag.kind !== 'pet', 1e9, 'held');
  const h = p.hold; p.hold = null;
  if (!h) return;
  const fr = w.frame(p), hang = (fr.pivot[1] - fr.top[1]) * w.petScale(h.groundY), feet = h.y + hang;
  p.x = h.x; p.y = h.groundY;
  // 발이 닿는 자리가 가구 발밑이면 그 가구 위(상자·숨숨집이면 안)로 내려앉는다 — 가구 뒤 바닥에 서서 가려지던 문제
  const land = w.inFoot(p.x, p.y, 0);
  let g = 0;
  if (land) { p.on = land; g = land.seatZ; p.x = clamp(p.x, land.x - land.wpx * .22, land.x + land.wpx * .22); p.y = land.y - 3; }
  p.z = Math.max(0, p.y - feet);   // 화면상 발 위치는 그대로(연속). 좌석보다 낮으면 복귀 규칙이 좌석 높이까지 올려 준다
  let v = 0;
  if (p.z > g + 6) {
    yield { tick: dt => { p.vz -= w.cfg.pet.gravity * dt; p.z += p.vz * dt; v = -p.vz; if (p.z > g) return false; p.z = g; p.vz = 0; return true; } };
    p.anim.fps = 6;
  }
  if (p.z > g) p.z = g;
  p.vz = 0;
  if (v > 950) { w.addFx('dust', p.x, p.y, { size: 70 }); w.say('annoy'); yield play('tumble_recover'); }
  else yield play('put_down', { from: v > 300 ? 3 : 2 });
  if (p.mood.annoy > .75) { w.headFx('anger', { size: 46 }); w.say('annoy'); yield play('angry'); yield* avoid(w, p); }
  else if (p.wasAsleep) { w.headFx('sweat', { size: 34 }); w.say('grumble'); yield play('startled'); }
  else if (w.R.chance(.5)) yield play('shake');
  else { yield play('happy'); }
};
// 쓰다듬기: 쓰다듬는 동안 반응 → 기분 좋으면 부비기 → 더 좋으면 배 보여주기 → 배를 만지면 간지러움
S.petting = function* (w, p) {
  yield* faceFront(w, p);
  const t0 = w.t;
  yield play('pet_react', { to: 2 });
  let rub = false;
  while (strokeOn(w)) {
    const el = w.t - t0, a = p.mood.affection;
    if (el > 5 && a > .5 && p.mood.annoy < .35 && !p.on) {
      w.say('happy');
      yield play('belly_show', { to: 3 });
      const bt = w.t;
      yield until(() => !strokeOn(w) || w.t - bt > 2.5, 30, 'belly_show', { frames: [2, 3], fps: 4 });
      if (strokeOn(w)) {
        w.say('giggle');
        yield until(() => !strokeOn(w), 20, 'tickled', { frames: [1, 2, 3, 4], fps: 7 });
        yield play('tickled', { frames: [4, 5] });
      } else yield play('belly_show', { from: 4 });
      break;
    }
    if (el > 2 && a > .3) rub = true;
    yield until(() => !strokeOn(w), 1.2, rub ? 'rub' : 'pet_react');
  }
  if (w.t - t0 > 1.5) { w.headFx('hearts', { size: 56 }); w.say('happy'); yield play('happy'); }
  else yield play('idle_breathe', { dur: 1 });
};
// 클릭: 가볍게 반응 → 자꾸 귀찮게 하면 놀라거나 화내고 피한다
S.tapped = function* (w, p) {
  yield* faceFront(w, p);
  const a = p.mood.annoy;
  if (a > .8) { w.headFx('anger', { size: 46 }); w.say('annoy'); yield play('angry', { loops: 2 }); yield* avoid(w, p); return; }
  if (a > .5) { w.headFx('sweat', { size: 34 }); w.say('startle'); yield play('startled'); yield play('sulk'); return; }
  w.headFx('hearts', { size: 42 }); w.say('react');
  yield play('pet_react', { loops: 1 });
  if (w.R.chance(.3)) yield play('shy');
};
// 자는 중 클릭: 깨기 → 두리번 → (졸리면 다시 잠) / 너무 자주 깨우면 화냄
S.disturbed = function* (w, p) {
  w.say('grumble');
  yield play('wake', { speed: 1.4 });
  if (p.mood.annoy > .7) { w.headFx('anger', { size: 46 }); yield play('angry'); yield play('sulk'); if (!p.on) yield* avoid(w, p); return; }
  w.headFx('question', { size: 40 });
  yield play('look_around');
  if (p.needs.energy < .45 && w.R.chance(.7)) { yield play('yawn'); yield play('lie_down'); yield* sleepFor(w, p, w.R.range(30, 90)); yield play('wake'); }
};
S.boxpop = function* (w, p) { w.headFx('question', { size: 40 }); w.say('startle'); yield play('peek', { speed: 1.3 }); yield play('shy'); };
S.startle = function* (w, p) { yield* faceFront(w, p); w.headFx('surprise', { size: 54 }); yield play('startled'); if (w.R.chance(.6)) yield* S.ball(w, p); };
// 간식: (손에 들고 있으면) 아래로 와서 조르기 → 떨어뜨리면 냄새 → 먹기 → 만족
S.treat = function* (w, p) {
  const t0 = w.t;
  while (w.treat && w.treat.state === 'hand' && w.t - t0 < 60) {
    const T = w.treat, ty = clamp(T.y + w.petH() * .9, w.floorTopNow(), w.room.floorBottom);
    if (Math.abs(T.x - p.x) > 120 || Math.abs(ty - p.y) > 70) yield* goTo(w, p, T.x, ty, Math.abs(T.x - p.x) > 450 ? 'run' : 'walk', { maxTime: 1.2, stop: false });
    else { yield* faceFront(w, p); if (!w.treat.begged) { w.treat.begged = 1; w.say('react'); } yield play('beg_treat', { frames: [1, 2, 3, 4], pingpong: true, dur: .8 }); }
  }
  if (!w.treat || w.treat.state === 'hand') { if (w.treat) { w.headFx('bored_dots', { size: 50 }); yield play('sulk'); } return; }
  yield until(() => !w.treat || w.treat.state === 'floor', 3, 'idle_breathe');
  const T = w.treat; if (!T) return;
  yield* goTo(w, p, T.x, T.y - 18);
  yield* faceFront(w, p);
  yield play('sniff');
  yield play('beg_treat', { from: 3 });
  yield play('eat', { loops: 2, on: { 3: () => { T.bites++; T.s *= .78; w.say('eat'); } } });
  w.treat = null;
  p.needs.hunger = clamp(p.needs.hunger - .3, 0, 1); p.mood.affection = clamp(p.mood.affection + .08, 0, 1);
  w.say('happy');
  yield play('satisfied');
  w.headFx('sparkles', { size: 56 });
  yield play('happy');
};
// 낚싯대: 멀면 다가가고(빠르면 달리기, 느리면 살금살금), 높으면 눈으로 따라가다 폴짝, 바닥이면 덮치기
S.teaser = function* (w, p) {
  const T = w.teaser;
  let cool = 0;
  while (T.on) {
    const Hh = w.petH(), dx = T.x - p.x, adx = Math.abs(dx), above = (p.y - p.z) - T.y;
    const gy = clamp(T.y + Hh * .45, w.floorTopNow(), w.room.floorBottom);
    if (adx > 240 || Math.abs(gy - p.y) > 110) {
      const fast = Math.hypot(T.vx, T.vy) > 380;
      yield { chase: () => (T.on ? [T.x - (Math.sign(T.x - p.x) || 1) * 140, gy] : null), gait: fast ? 'run' : 'sneak', near: (x, y) => Math.abs(x) < 40 && Math.abs(y) < 50, max: 1.2 };
      continue;
    }
    yield* faceToward(w, p, T.x);
    if (above > Hh * .25 && above < Hh * 1.3 && adx < 170 && w.t > cool) {
      cool = w.t + 1.3;
      yield play('teaser_follow', { from: 3, to: 5, each: () => { const a = p.anim; p.z = a.list[a.i] === 4 ? 46 * Math.sin(Math.PI * Math.min(1, a.t * a.fps)) : 0; } });
      p.z = 0;
      if (Math.abs(T.x - p.x) < 140) { w.headFx('sparkles', { size: 44 }); w.say('react'); fun(w, p, .05, .05 * .3); }
    } else if (above >= Hh * 1.3 && above < Hh * 2.6 && adx < 200 && w.t > cool && w.R.chance(.25)) {
      cool = w.t + 2;
      yield { jump: [p.x + Math.sign(dx) * Math.min(adx, 110), p.y], z1: 0, h: Math.min(above - Hh * .7, 230) };
    } else if (above < Hh * .25 && w.t > cool) {
      cool = w.t + 1.6;
      yield play('shadow_pounce', { glide: { from: 2, to: 3, dx: Math.min(adx, 110) } });
    } else {
      const k = dx * p.face < -50 ? 1 : dx * p.face > 50 ? 2 : 0;
      yield play('teaser_follow', { frames: [k], dur: .25 });
    }
  }
  p.z = 0;
  yield* faceFront(w, p);
  yield play('happy');
};
// 빈 곳(유리)을 톡톡 치면: 쳐다보고 → 앞쪽이면 다가와서 맞받아 톡톡(가끔 찐빵), 바닥이면 가서 냄새
S.noticed = function* (w, p) {
  const tap = w.lastTap; if (!tap) return;
  if (!side(w, p) && !p.on) { yield play('look_around', { frames: [lookFrame(w, p)], dur: .6 }); }
  w.headFx('question', { size: 40 });
  if (p.on) return;
  const front = tap.y > w.room.floorBottom - 160 || tap.y < w.floorTopNow() - 120;
  if (front && w.R.chance(.75)) {
    yield* goTo(w, p, clamp(tap.x, 220, w.room.w - 220), w.room.floorBottom - 10, 'walk');
    yield* tapGlass(w, p, w.R.int(1, 2));
    if (w.R.chance(.35)) yield* S.glass(w, p);
  } else if (tap.y >= w.floorTopNow()) {
    yield* goTo(w, p, tap.x, tap.y, 'sneak');
    yield play('sniff');
    yield play('paw_play');
  }
};
// 오랜만에 켰을 때: 앞으로 와서 반김
S.greet = function* (w, p) {
  yield* goTo(w, p, w.room.w / 2 + w.R.range(-150, 150), w.room.floorBottom - 60, 'run');
  w.headFx('hearts', { size: 52 });
  w.say('happy');
  yield play('happy', { loops: 2 });
  yield play('ask_play');
};

// ================= 다음 장면 고르기 =================
MP.choose = function (w, p) {
  const n = p.needs, m = p.mood, R = w.R, c = [];
  const add = (name, wt, gap = 0) => {
    if (!(wt > 0) || w.t - (p.lastAt[name] == null ? -1e9 : p.lastAt[name]) < gap) return;
    c.push([name, wt * (p.recent[0] === name ? .15 : p.recent.includes(name) ? .5 : 1)]);
  };
  const bored = 1 - n.fun;
  add('calm', 5); add('stroll', 2); add('groom', 1.5, 45);
  if (n.energy < .66 || w.night) add('nap', (1 - n.energy) * 12 + (w.night ? 5 : 0), 60);
  if (n.hunger > .55) add('eat', n.hunger * 6, 120);
  if (n.energy > .3) {
    add('tail', bored + .1, 150); add('pawplay', bored + .1, 120); add('hunt', bored + .1, 150);
    add('zoomies', (bored * .6 + .08) * (w.night ? 1.5 : 1), 300); add('ball', bored + .1, 150);
    if (w.plush) add('plush', bored * .8 + .1, 150);
    if (w.rope) add('rope', bored * .8 + .1, 150);
    add('box', .3 + bored * .3, 300); add('tunnel', .3 + bored * .3, 300);
    // 관심 요청: 마지막 교감 뒤 15분에 걸쳐 외로워진다(놀아 주는 동안엔 보채지 않음)
    const lonely = clamp((w.t - w.userT) / 900, 0, 1);
    add('glass', .1 + lonely * .3 + bored * .2, 900);
    add('attention', lonely * (.9 + m.affection * .6) + bored * .3, 900);
    add('tapwin', lonely * .6 + bored * .2, 1500);
    // 친구가 있으면: 다가가서 비비기·같이 뛰기·티격태격
    const q = w.pets.length > 1 ? w.pets.find(x => x !== p) : null;
    if (q && !q.hold && q.glassK === 0 && !q.hidden && !q.asleep && q.on !== 'glass' && (!q.scene || q.scene.prio <= 10))
      add('social', .6 + bored * .5 + m.annoy * .4, 240);
  }
  if (!c.length) return 'calm';
  let sum = 0; for (const [, x] of c) sum += x;
  let r = R() * sum;
  for (const [name, x] of c) { r -= x; if (r <= 0) return name; }
  return c[c.length - 1][0];
};

// ================= 사용자 입력 → 장면 끼어들기 =================
// 우선순위: 들기 100 > 쓰다듬기 80 > 클릭 70 > 간식 60 > 낚싯대 55 > 공 50 > 장난감 40 > 유리 톡톡 30 > 자율 10
MP.react = function (w, p, ev, d) {
  const cur = p.scene && p.scene.name, prio = p.scene ? p.scene.prio : 0;
  const start = (name, pr) => { if (pr >= prio && (cur !== name || name === 'tapped')) w.startScene(name, pr, undefined, p); };
  switch (ev) {
    case 'liftStart': w.startScene('held', 100, undefined, p); return;
    case 'tapPet':
      if (cur === 'held') return;
      if (p.on === 'glass') { w.headFx('hearts', { size: 50 }); return; }
      if (p.boxHide) return start('boxpop', 70);
      if (p.asleep) return start('disturbed', 70);
      return start('tapped', 70);
    case 'strokeStart':
      if (cur === 'held' || p.on === 'glass') return;
      if (p.asleep) { w.headFx('hearts', { size: 36 }); return; }   // 자는 채로 쓰다듬기: 깨지 않는다
      return start('petting', 80);
    case 'ball': if (p.asleep || p.on === 'glass') return; return start('ball', 50);
    case 'bump': if (p.asleep) return start('disturbed', 70); return start('startle', 45);
    case 'teaserOn': if (p.asleep || p.on === 'glass') return; return start('teaser', 55);
    case 'treatHand': if (p.asleep && p.needs.energy < .25) return; return start('treat', 60);
    case 'toy': if (p.asleep || p.on === 'glass' || !w[d.kind]) return; return start(d.kind, 40);
    case 'glassTap': if (p.asleep || p.on === 'glass') return; return start('noticed', 30);
  }
};
})(typeof window !== 'undefined' ? window : globalThis);
