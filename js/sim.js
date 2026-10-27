// 미니 펫 시뮬레이션 — 데이터 준비, 애니메이션, 이동·점프, 소품 물리, 장면 실행.
// DOM 을 쓰지 않는다(tools/sim_check.cjs 가 노드에서 그대로 돌린다). 그리기는 view.js.
// 동물은 w.pets 배열(1~2마리). 장면·이동 헬퍼들은 "지금 처리 중인 동물" p 를 참조하고,
// w.update 가 동물마다 p 를 바꿔 가며 돌린다. w.pet 은 p(처리 중) 또는 첫 동물.
(function (g) {
'use strict';
const MP = g.MP = g.MP || {};
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
MP.util = { clamp, lerp, ease };

MP.rng = function (seed) {
  let s = (seed >>> 0) || ((Math.random() * 4294967296) >>> 0);
  const f = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(a + f() * (b - a + 1));
  f.chance = q => f() < q;
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  return f;
};

// ---------- 데이터: data/assets.js(PET_ASSETS) + 측정값(PET_METRICS) → 게임이 쓰는 형태 ----------
// 행동 56개가 모두 6프레임으로 있는 동물만 "준비됨"으로 친다.
MP.buildData = function (assets, metrics, tuning) {
  const actions = {};
  for (const a of assets.actions) actions[a.id] = a;
  const bytes = b64 => typeof atob === 'function' ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(b64, 'base64'));
  const assetSet = String(assets.base || '').replace(/\/+$/, '').split('/').pop();
  const characters = {}, missing = {};
  for (const [cid, ch] of Object.entries(assets.characters)) {
    const met = metrics && metrics.characters && metrics.characters[cid], tun = (tuning && tuning[assetSet] && tuning[assetSet][cid]) || {};
    const lack = Object.keys(actions).filter(id => !ch.animations[id] || ch.animations[id].frames.length !== 6);
    if (lack.length) { missing[cid] = lack; continue; }
    const anims = {};
    for (const id of Object.keys(actions)) {
      anims[id] = ch.animations[id].frames.map((f, i) => {
        const m = met && met[id] && met[id][i], [, , rw, rh] = f.rect, t = (tun[id] && tun[id][i]) || {};
        const fr = {
          sheet: ch.animations[id].sheet, rect: f.rect, clip: f.clipPolygon || null,
          pivot: m && assets.pivotMode !== 'manifest' ? m.ground : f.origin, top: m ? [m.ground[0], m.top[1]] : [f.origin[0], 4],
          bbox: m ? m.bbox : [0, 0, rw, rh], center: m ? m.center : [rw / 2, rh / 2],
          mouth: m ? m.mouth : [rw - 8, rh * .45], reach: m ? m.reachR : [rw - 4, rh * .7],
          mask: m ? bytes(m.mask) : null, maskN: metrics ? metrics.mask : 0,
        };
        Object.assign(fr, t);   // 손으로 맞춘 접촉점(tuning.js)이 있으면 덮어쓴다
        return fr;
      });
    }
    characters[cid] = { id: cid, sheets: Object.fromEntries(Object.entries(ch.sheets).map(([k, v]) => [k, v.file])), anims };
  }
  const shared = {};
  for (const [aid, at] of Object.entries(assets.shared)) {
    shared[aid] = { file: at.file, items: {} };
    for (const [iid, it] of Object.entries(at.items)) {
      const m = metrics && metrics.shared && metrics.shared[aid] && metrics.shared[aid][iid];
      const bb = m ? m.bbox : [0, 0, it.rect[2], it.rect[3]];
      shared[aid].items[iid] = { rect: it.rect, bbox: bb, pivot: [bb[0] + bb[2] / 2, bb[1] + bb[3]] };
    }
  }
  return { actions, characters, shared, backgrounds: assets.backgrounds, available: Object.keys(characters), missing, assetSet };
};

// ---------- 월드 ----------
MP.createWorld = function (data, cfg, opt = {}) {
  const R = MP.rng(opt.seed), room = cfg.room, PC = cfg.pet;
  const item = (atlas, id) => data.shared[atlas].items[id];
  const w = {
    t: 0, R, data, cfg, room,
    view: { left: 0, right: room.w, top: room.h - room.minVisibleH, bottom: room.h },
    pets: [], fx: [], log: [], used: {}, errors: [],
    night: false, pointer: { x: room.w / 2, y: 820, inside: false, moveT: -99 },
    stroke: { active: false, lastT: -99, pet: null }, drag: null,
    teaser: { on: false, x: 0, y: 0, vx: 0, vy: 0 },
    treat: null, plush: null, rope: null, userT: 0, lastTap: null, active: true, sfx: null,
  };
  let p = null;   // 지금 처리 중인 동물 — 장면·이동 헬퍼들이 참조한다
  Object.defineProperty(w, 'pet', { get: () => p || w.pets[0] });

  // 리소스 폴더별 가구 배치·소품 기준점(config.sets)
  const set = (cfg.sets && (cfg.sets[data.assetSet] || Object.values(cfg.sets)[0])) || {};
  const P = w.props = {};
  for (const k of Object.keys(cfg.props)) P[k] = Object.assign({}, cfg.props[k], set.props && set.props[k]);
  // 가구. 앞 파츠(front)는 뒤 그림과 같은 배율·같은 바닥 가운데로 겹친다(같은 축척으로 그려졌다는 전제)
  w.furn = {}; w.furnList = [];
  for (const d of set.furniture || []) {
    const it = item('furniture', d.item), s = d.w / it.bbox[2];
    const f = { id: d.id, kind: d.kind || null, def: d, item: d.item, it, x: d.x, y: d.y, s, wpx: it.bbox[2] * s, hpx: it.bbox[3] * s, seatZ: (d.seat || 0) * it.bbox[3] * s };
    if (d.foot) f.foot = { x: d.x, y: d.y - d.foot[1] * d.w, rx: d.foot[0] * d.w, ry: d.foot[1] * d.w };
    if (d.hole) { const [u, v, ru, rv] = d.hole; f.hole = { x: d.x + (u - .5) * f.wpx, y: d.y - (1 - v) * f.hpx, rx: ru * f.wpx, ry: rv * f.hpx }; }
    w.furn[d.id] = f; w.furnList.push(f);
  }
  const bowlIt = item('toys_food', P.bowl.item);
  w.bowl = { x: P.bowl.x, y: P.bowl.y, s: P.bowl.w / bowlIt.bbox[2], it: bowlIt, r: P.bowl.w * .42 };
  w.ball = newProp('ball', 1010, 820);

  function newProp(kind, x, y) {
    const d = P[kind], it = item('toys_food', d.item), size = d.d || d.w;
    return { kind, it, s: size / it.bbox[2], x, y, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, r: size / 2, heldBy: null, squash: 0 };
  }

  // ---- 좌표 도우미 ----
  w.depth = y => lerp(PC.depthScale[0], PC.depthScale[1], clamp((y - room.floorTop) / (room.floorBottom - room.floorTop), 0, 1));
  // 시트 픽셀 → 방 픽셀. 기본 자세 몸 폭이 config pet.width 가 되게(동물·시트 버전이 달라도 같은 크기)
  const base = ch => { const b = ch.anims.idle_breathe[0].bbox; return PC.width * ((PC.size && PC.size[ch.id]) || 1) / b[2]; };
  w.petScale = (y, q = w.pet) => base(q.ch) * w.depth(y == null ? q.y : y) / PC.depthScale[0];
  w.bodyW = (y, q = w.pet) => q.ch.anims.idle_breathe[0].bbox[2] * w.petScale(y, q);
  // 서 있는 자세 중 기준점 위로 가장 높은 그림(들기·유리 제외) — 창 위쪽이 잘릴 때 다닐 수 있는 깊이를 정한다
  const tallest = ch => { if (ch._tall == null) { let m = 0; for (const [id, fs] of Object.entries(ch.anims)) if (!/^(picked_up|held|glass_)/.test(id)) for (const f of fs) m = Math.max(m, f.pivot[1] - f.bbox[1]); ch._tall = m; } return ch._tall; };
  w.floorTopNow = () => Math.max(room.floorTop, w.view.top + Math.max(...w.pets.map(q => tallest(q.ch) * base(q.ch)), 0) + 12);
  w.clampFloor = (x, y, margin = 165) => [clamp(x, margin, room.w - margin), clamp(y, w.floorTopNow(), room.floorBottom)];
  w.inFoot = (x, y, pad = 0, skip) => w.furnList.find(f => f.foot && f !== skip && ((x - f.foot.x) / (f.foot.rx + pad)) ** 2 + ((y - f.foot.y) / (f.foot.ry + pad * .5)) ** 2 < 1);
  w.spot = (q, dmin = 150, dmax = 800) => {     // 가구를 피한 빈 바닥 한 점
    for (let i = 0; i < 40; i++) {
      const [x, y] = w.clampFloor(q.x + R.range(-dmax, dmax), R.range(room.floorTop, room.floorBottom));
      const d = Math.abs(x - q.x);
      if (d >= dmin && !w.inFoot(x, y, 60)) return [x, y];
    }
    return w.clampFloor(room.w / 2, (room.floorTop + room.floorBottom) / 2);
  };
  w.frame = (q = w.pet, a = q.anim) => q.ch.anims[a.id][a.list[a.i]];
  w.frameOf = (id, i, q = w.pet) => q.ch.anims[id][i];
  // 프레임 안 좌표(lx,ly) → 방 좌표 (기본 자세 기준, 들기·유리 변형 제외)
  w.local = (q, fr, lx, ly) => { const s = w.petScale(q.y, q); return [q.x + q.face * (lx - fr.pivot[0]) * s, q.y - q.z + (ly - fr.pivot[1]) * s]; };
  w.anchor = (q, name, fr = w.frame(q)) => w.local(q, fr, fr[name][0], fr[name][1]);
  w.petH = (q = w.pet) => q.ch.anims.idle_breathe[0].bbox[3] * w.petScale(q.y, q) * 1.1;
  // 프레임 그림(bbox)이 창 가로 안에 들도록 기준점 x 를 조정
  w.fitX = (x, fr, px, sc, flip, pad = 8) => {
    let l = (fr.bbox[0] - px) * sc, r = (fr.bbox[0] + fr.bbox[2] - px) * sc; if (flip) [l, r] = [-r, -l];
    return clamp(x, w.view.left + pad - l, Math.max(w.view.left + pad - l, w.view.right - pad - r));
  };
  // 유리에 붙을 때 배율: 유리 행동 4개 전 프레임이 창 안에 들어가는 크기
  w.glassScale = (q = w.pet) => {
    let mw = 1, mh = 1;
    for (const id of ['glass_press', 'glass_hold', 'glass_slide', 'glass_release']) for (const f of q.ch.anims[id]) { mw = Math.max(mw, f.bbox[2]); mh = Math.max(mh, f.pivot[1] - f.bbox[1]); }
    const V = w.view;
    return Math.min((V.bottom - Math.max(V.top, 0)) * .8 / mh, (V.w || V.right - V.left) * .64 / mw);   // V.w = 화면에 보이는 폭(카메라가 움직일 때 view 는 방 전체)
  };
  w.reachOf = (id, i, q = w.pet) => { const fr = w.frameOf(id, i, q); return (fr.reach[0] - fr.pivot[0]) * w.petScale(q.y, q); };

  // ---- 효과 ----
  const FX = {
    hearts: { life: 1.6, vy: -55, size: 84 }, sparkles: { life: 1.3, vy: -30, size: 86 },
    sleep_bubbles: { life: 3.4, vy: -24, vx: 10, size: 64 }, anger: { life: 1.5, vy: 0, size: 68, pulse: 1 },
    sweat: { life: 1.3, vy: 18, size: 50 }, bored_dots: { life: 2.6, vy: -6, size: 90 },
    surprise: { life: .9, vy: 0, size: 94, pulse: 1 }, question: { life: 1.6, vy: -10, size: 64 },
    dust: { life: .7, vy: -16, size: 78, grow: 1 }, tap_ripple: { life: .7, vy: 0, size: 70, grow: 1, front: 1 },
    glass_shine: { life: 3.5, vy: 0, size: 120, front: 1 }, paw_stamp: { life: 6, vy: 0, size: 64, front: 1 },
  };
  w.addFx = (name, x, y, o = {}) => { const d = FX[name]; w.fx.push(Object.assign({ name, x, y, t: 0, life: d.life, vx: d.vx || 0, vy: d.vy, size: d.size, pulse: d.pulse, grow: d.grow, front: d.front, alpha: 1 }, o)); };
  w.topPoint = (q = w.pet) => { const o = w.pose(q), fr = o.fr; return [o.x + (fr.top[0] - o.px) * o.s * (o.flip ? -1 : 1), o.y + (fr.top[1] - o.py) * o.s * o.sy]; };
  // 머리 위 말풍선: 동물 몸 크기에 맞춰 키운다(작아서 안 보인다는 피드백 — 기본 약 1.7배)
  w.headFx = (name, o = {}) => {
    const q = w.pet, [x, y] = w.topPoint(q);
    const k = clamp(w.bodyW(q.y, q) / 165, 1.25, 2.2);
    o.size = (o.size || FX[name].size) * k;
    w.addFx(name, x + q.face * 18 * k, y - 8 * k, o);
  };
  // 효과음(인터랙션 때만): view 가 w.sfx 를 연결한다. 장면·입력에서 w.say(kind) 로 부른다.
  w.say = (kind, q = w.pet) => { if (w.sfx) w.sfx(kind, q); };

  // ---- 소품 ----
  w.placeToy = (kind, on, quiet) => {
    if (kind === 'ball') { const b = w.ball; if (b.heldBy && b.heldBy !== 'user') b.heldBy = null; const q0 = w.nearestFree(b.x, b.y) || w.pets[0]; b.x = clamp(q0.x + R.range(-500, 500), 150, room.w - 150); b.y = R.range(room.floorTop + 60, room.floorBottom - 40); b.z = 380; b.vx = R.range(-240, 240); b.vy = 0; b.vz = 0; touch(); react(q0, 'ball'); return; }
    if (!on) { if (kind === 'rope' && w.rope) w.rope.heldBy = null; w[kind] = null; return; }
    let x, y;
    for (let i = 0; i < 30; i++) { [x, y] = w.spot(w.pets[0], 180, 650); if (Math.hypot(x - w.ball.x, y - w.ball.y) > 120) break; }
    const t = w[kind] = newProp(kind, x, y);
    t.z = quiet ? 0 : 260; if (kind === 'rope') { t.ang = R.chance(.5) ? 0 : Math.PI; t.len = P.rope.w * .78; }
    if (!quiet) { touch(); const q0 = w.nearestFree(x, y); if (q0) react(q0, 'toy', { kind }); }
  };
  const touch = () => { w.userT = w.t; };
  // 반응을 받을 수 있는 동물(들려 있거나 유리에 붙어 있거나 숨은 동물 제외)
  w.freePets = () => w.pets.filter(q => !q.hold && q.glassK === 0 && !q.hidden);
  w.nearestFree = (x, y) => { let best = null, bd = 1e9; for (const q of w.freePets()) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } } return best; };
  // MP.react 를 "그 동물"이 현재 동물인 상태로 부른다(머리 효과·장면 시작이 그 동물에게 가게)
  const react = (q, ev, d) => { const old = p; p = q; try { MP.react(w, q, ev, d); } finally { p = old; } };

  // ---- 입력 (view.js 가 방 좌표로 바꿔서 부른다. 동물 대상 입력은 d.pet) ----
  w.input = (type, d = {}) => {
    const ptr = w.pointer, pt = d.pet || w.pets[0];
    switch (type) {
      case 'pointer':
        if (Math.hypot(d.x - ptr.x, d.y - ptr.y) > 3) ptr.moveT = w.t;
        ptr.x = d.x; ptr.y = d.y; ptr.inside = d.inside !== false; break;
      case 'tapPet':
        touch(); pt.mood.annoy = clamp(pt.mood.annoy + (pt.asleep ? .25 : .17), 0, 1); react(pt, 'tapPet'); break;
      case 'strokeStart': touch(); w.stroke.active = true; w.stroke.lastT = w.t; w.stroke.pet = pt; react(pt, 'strokeStart'); break;
      case 'stroke': w.stroke.lastT = w.t; break;
      case 'strokeEnd': w.stroke.active = false; break;
      case 'liftStart':
        touch(); w.drag = { kind: 'pet', pet: pt, x: d.x, y: d.y, vx: 0, vy: 0 };
        pt.mood.annoy = clamp(pt.mood.annoy + .2, 0, 1); pt.wasAsleep = pt.asleep;
        w.say('startle', pt);
        react(pt, 'liftStart'); pt.hold = { x: d.x, y: d.y, swing: 0, sv: 0, stretch: 0, groundY: pt.y }; break;
      case 'grab': {   // 소품 잡기
        touch(); const t = d.kind === 'ball' ? w.ball : w[d.kind]; if (!t) break;
        if (t.heldBy && t.heldBy !== 'user' && d.kind !== 'rope') t.heldBy = null;
        w.drag = { kind: d.kind, x: d.x, y: d.y, vx: 0, vy: 0, groundY: t.y };
        if (d.kind !== 'rope') t.heldBy = 'user';
        break;
      }
      case 'dragMove': if (w.drag) { const k = Math.min(1, (d.dt || .016) * 14); w.drag.vx = lerp(w.drag.vx, (d.x - w.drag.x) / Math.max(d.dt || .016, .008), k); w.drag.vy = lerp(w.drag.vy, (d.y - w.drag.y) / Math.max(d.dt || .016, .008), k); w.drag.x = d.x; w.drag.y = d.y; } break;
      case 'dragEnd': {
        const dr = w.drag; if (!dr) break; w.drag = null;
        if (dr.kind === 'pet') break;   // 떨어뜨리기는 held 장면이 처리
        const t = dr.kind === 'ball' ? w.ball : w[dr.kind]; if (!t) break;
        if (dr.kind === 'rope') break;
        t.heldBy = null; t.vx = clamp(dr.vx, -1400, 1400); t.vz = clamp(-dr.vy, -300, 1300); t.vy = 0;
        if (dr.kind === 'ball') { const q0 = w.nearestFree(t.x, t.y); if (q0) react(q0, 'ball'); }
        break;
      }
      case 'tapProp': {   // 공 톡 치기
        touch(); const b = w.ball; if (d.kind !== 'ball' || b.heldBy) break;
        const q0 = w.nearestFree(b.x, b.y) || w.pets[0];
        const dir = Math.sign(b.x - q0.x) || 1; b.vx = dir * R.range(300, 520); b.vz = R.range(150, 320); react(q0, 'ball'); break;
      }
      case 'tapGlass':   // 빈 곳 클릭 = 유리 톡톡
        touch(); w.lastTap = { x: d.x, y: d.y, t: w.t }; w.addFx('tap_ripple', d.x, d.y + 30, { size: 60 });
        if (w.treat && w.treat.state === 'hand') { w.treat.state = 'fall'; w.treat.vz = 0; break; }
        { const q0 = w.nearestFree(d.x, d.y); if (q0) react(q0, 'glassTap'); }
        break;
      case 'teaser':
        touch(); w.teaser.on = !!d.on;
        if (d.on) { w.teaser.x = ptr.x; w.teaser.y = ptr.y; for (const q0 of w.freePets()) react(q0, 'teaserOn'); }   // 둘 다 깃털에 반응
        break;
      case 'treat':
        touch();
        if (d.on) { w.treat = Object.assign(newProp('treat', ptr.x, ptr.y), { state: 'hand', bites: 0 }); const q0 = w.nearestFree(ptr.x, ptr.y); if (q0) react(q0, 'treatHand'); }
        else if (w.treat && w.treat.state === 'hand') w.treat = null;
        break;
      case 'toy': w.placeToy(d.kind, d.on); break;
    }
  };

  // ---- 동물 ----
  function makePet(chId, x) {
    return {
      ch: data.characters[chId] || data.characters[data.available[0]],
      x, y: 840, z: 0, face: 1, on: null, anim: null, scene: null, step: null, res: undefined,
      needs: { energy: R.range(.7, .9), hunger: R.range(.15, .3), fun: R.range(.5, .7) }, mood: { affection: .35, annoy: 0 },
      asleep: false, glassK: 0, glassX: 0, hold: null, vz: 0, overT: 0, lastAt: {}, recent: [],
    };
  }
  w.addPet = (chId, scene) => {
    const q = makePet(chId, w.pets.length ? clamp(w.pets[0].x + 320, 200, room.w - 200) : 760);
    w.pets.push(q);
    const old = p; p = q;
    try { w.setAnim('idle_breathe'); w.startScene(scene || 'calm', 10); } finally { p = old; }
    return q;
  };
  w.removePet = q => {
    const i = w.pets.indexOf(q); if (i < 0) return;
    for (const t of [w.ball, w.plush, w.rope]) if (t && t.heldBy === q) t.heldBy = null;
    if (w.drag && w.drag.pet === q) w.drag = null;
    if (w.stroke.pet === q) { w.stroke.active = false; w.stroke.pet = null; }
    w.pets.splice(i, 1);
  };
  w.setCharacter = id => { const q = w.pets[0]; if (data.characters[id] && q) { q.ch = data.characters[id]; w.startScene('calm', 10, undefined, q); } };
  // 친구(둘째 동물) 넣기·바꾸기·빼기. id 가 null 이면 혼자 모드.
  w.setFriend = id => {
    const q = w.pets[1];
    if (!id) { if (q) w.removePet(q); return; }
    if (!data.characters[id]) return;
    if (q) { q.ch = data.characters[id]; w.startScene('calm', 10, undefined, q); }
    else w.addPet(id);
  };

  // ---- 애니메이션 ----
  const range = (a, b) => { const r = []; if (a <= b) for (let i = a; i <= b; i++) r.push(i); else for (let i = a; i >= b; i--) r.push(i); return r; };
  w.setAnim = (id, o = {}) => {
    const A = data.actions[id];
    let list = o.frames ? o.frames.slice() : range(o.from == null ? 0 : o.from, o.to == null ? 5 : o.to);
    if (o.pingpong && list.length > 2) list = list.concat(list.slice(1, -1).reverse());
    const loop = o.loop != null ? o.loop : (o.dur != null || (o.loops || 0) > 1 || (A.loop && o.loops == null && list.length > 1));
    p.anim = { id, list, i: 0, t: 0, fps: (o.fps || A.fps) * (o.speed || 1), loop, loops: 0, wrapped: false, done: false, on: o.on || null, changed: true };
    if (p.anim.on && p.anim.on[list[0]]) p.anim.on[list[0]](w, p);
  };
  function tickAnim(dt) {
    const a = p.anim; a.wrapped = false;
    if (a.done) return;
    a.t += dt;
    const spf = 1 / a.fps;
    while (a.t >= spf) {
      a.t -= spf;
      if (a.i < a.list.length - 1) a.i++;
      else { a.loops++; a.wrapped = true; if (a.loop) a.i = 0; else { a.done = true; a.t = 0; break; } }
      a.changed = true;
      if (a.on && a.on[a.list[a.i]]) a.on[a.list[a.i]](w, p);
    }
  }
  const isSide = id => PC.side.includes(id);
  w.animProgress = (q = w.pet) => { const a = q.anim; return clamp((a.i + a.t * a.fps) / a.list.length, 0, 1); };

  // ---- 길 찾기: 직선이 가구 발밑을 지나면 앞쪽으로 한 번 돌아간다 ----
  function plan(x0, y0, x1, y1, skip) {
    for (const f of w.furnList) {
      if (!f.foot || f === skip || f === p.on) continue;
      const F = f.foot;
      let hit = false;
      for (let k = 1; k < 12 && !hit; k++) { const u = k / 12, x = lerp(x0, x1, u), y = lerp(y0, y1, u); if (((x - F.x) / (F.rx + 40)) ** 2 + ((y - F.y) / (F.ry + 25)) ** 2 < 1) hit = true; }
      if (!hit) continue;
      const fy = Math.min(room.floorBottom, F.y + F.ry + 45);
      const side = x1 >= F.x ? 1 : -1;
      const via = [[clamp(F.x - side * (F.rx * .6), 100, room.w - 100), fy], [clamp(F.x + side * (F.rx * .6), 100, room.w - 100), fy]];
      return [...via.filter(v => Math.abs(v[0] - x0) > 30 || Math.abs(v[1] - y0) > 30), [x1, y1]];
    }
    return [[x1, y1]];
  }

  // ---- 장면 단계(step) 실행 ----
  // 장면(behaviors.js)은 제너레이터이고 아래 단계 객체를 yield 한다.
  //  {play:id, loops, dur, from, to, frames, pingpong, speed, fps, on:{프레임:fn}, glide:{from,to,dx,dy}, each:fn}
  //  {move:[x,y], gait, stop, maxTime, skip}   {chase:fn→[x,y]|null, gait, near:fn(dx,dy), max}
  //  {jump:[x,y], z1, h, enter, exit}   {wait:초}   {until:fn, max, ...play 옵션}   {tick:fn(dt,s)}
  function step(s, dt) {
    s.el = (s.el || 0) + dt;
    if (s.play) {
      if (!s.started) { s.started = true; w.setAnim(s.play, s); return false; }
      const a = p.anim;
      if (s.glide) { const G = s.glide, f = a.list[a.i]; if (f >= G.from && f <= G.to) { const T = (G.to - G.from + 1) / a.fps; moveBy(p.face * (G.dx || 0) * dt / T, (G.dy || 0) * dt / T); } }
      if (s.each) s.each(dt, s);
      if (s.dur != null) return s.el >= s.dur && (a.wrapped || a.list.length === 1 || a.done);
      if (s.loops) return a.loops >= s.loops || a.done;
      return a.done || (a.loop && a.loops >= 1);
    }
    if (s.move) return moveStep(s, dt);
    if (s.chase) return chaseStep(s, dt);
    if (s.jump) return jumpStep(s, dt);
    if (s.wait != null) return s.el >= s.wait;
    if (s.until) {
      if (!s.started) { s.started = true; if (s.play2) w.setAnim(s.play2, s); }
      if (s.until(w, p)) { s.result = true; return true; }
      if (s.el >= s.max) { s.result = false; return true; }
      return false;
    }
    if (s.tick) return s.tick(dt, s);
    return true;
  }
  function moveBy(dx, dy) { const [x, y] = w.clampFloor(p.x + dx, p.y + dy, 155); p.x = x; if (!p.on) p.y = y; }
  function startTurn(s, dir) {
    if (!isSide(p.anim.id)) { p.face = dir; w.setAnim('turn', { frames: [0, 1], fps: 14 }); }
    else if (dir !== p.face) { w.setAnim('turn', { frames: [2, 3, 4], fps: 14 }); s.flipTo = dir; }
    else return false;
    s.turning = true; return true;
  }
  function endTurn(s) { if (s.flipTo) { p.face = s.flipTo; s.flipTo = 0; } s.turning = false; }
  function gaitSpeed(g) { return (PC.gait[g] || 120) * w.depth(p.y); }
  function moveStep(s, dt) {
    if (!s.path) {
      const [tx, ty] = w.clampFloor(s.move[0], s.move[1]);
      s.path = Math.hypot(tx - p.x, ty - p.y) < 6 ? [] : plan(p.x, p.y, tx, ty, s.skip);
      s.gait = s.gait || 'walk';
      if (s.path.length) { const dir = Math.sign(s.path[0][0] - p.x) || p.face; if (!startTurn(s, dir)) w.setAnim(s.gait, { loop: true }); }
    }
    if (s.turning) { if (!p.anim.done) return false; endTurn(s); w.setAnim(s.gait, { loop: true }); }
    if (s.ending) return p.anim.done;
    let left = gaitSpeed(s.gait) * dt;
    while (left > 0 && s.path.length) {
      const [tx, ty] = s.path[0], dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      if (d <= left) {
        p.x = tx; p.y = ty; left -= d; s.path.shift();
        if (s.path.length) { const nd = Math.sign(s.path[0][0] - p.x); if (nd && nd !== p.face && Math.abs(s.path[0][0] - p.x) > 25 && startTurn(s, nd)) return false; }
      } else { p.x += dx / d * left; p.y += dy / d * left; left = 0; }
    }
    if (s.path.length && !(s.maxTime && s.el > s.maxTime)) {
      // 제자리걸음 감지: 0.4초 넘게 거의 안 움직였으면 그 지점을 도착으로 친다(가장자리에서 fitX 가 되미는 경우 등)
      if (dt > 0) {
        const moved = Math.hypot(p.x - (s._lx == null ? p.x : s._lx), p.y - (s._ly == null ? p.y : s._ly));
        s._stall = moved < 1 ? (s._stall || 0) + dt : 0;
        s._lx = p.x; s._ly = p.y;
        if (s._stall > .4) s.path.length = 0;
      }
      if (s.path.length) return false;
    }
    if (s.stop !== false && isSide(p.anim.id)) { w.setAnim('turn', { frames: [1, 0], fps: 14 }); s.ending = true; return false; }
    return true;
  }
  function chaseStep(s, dt) {
    if (s.turning) { if (!p.anim.done) return false; endTurn(s); w.setAnim(s.gaitNow, { loop: true }); }
    const tg = s.chase(w, p);
    if (!tg) { s.result = false; return true; }
    const dx = tg[0] - p.x, dy = tg[1] - p.y;
    if (s.near(dx, dy)) { s.result = true; return true; }
    if (s.el > (s.max || 8)) { s.result = false; return true; }
    const g = typeof s.gait === 'function' ? s.gait(dx, dy) : s.gait;
    const dir = Math.sign(dx);
    if (dir && dir !== p.face && Math.abs(dx) > 30 || !isSide(p.anim.id)) { s.gaitNow = g; if (startTurn(s, dir || p.face)) return false; }
    if (p.anim.id !== g) { w.setAnim(g, { loop: true }); s.gaitNow = g; }
    const d = Math.hypot(dx, dy), v = Math.min(d, gaitSpeed(g) * dt);
    if (d > 0) moveBy(dx / d * v, dy / d * v);
    return false;
  }
  // 점프: 0~1 웅크림(제자리) → 2~4 공중(위치 보간 + 포물선) → 5 착지
  function jumpStep(s, dt) {
    if (!s.started) {
      s.started = true; s.x0 = p.x; s.y0 = p.y; s.z0 = p.z; s.z1 = s.z1 || 0;
      s.x1 = s.jump[0]; s.y1 = s.jump[1];
      const dist = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      s.h = Math.min(s.h || 70 + dist * .25, Math.max(20, s.y0 - s.z0 - w.petH(p) - w.view.top - 20));
      s.air = clamp(.32 + dist / 900, .32, .7);
      if (Math.abs(s.x1 - s.x0) > 10) p.face = Math.sign(s.x1 - s.x0);
      w.setAnim('jump', { frames: [0, 1], fps: 10 }); s.phase = 0; return false;
    }
    if (s.phase === 0) { if (!p.anim.done) return false; s.phase = 1; s.u = 0; w.setAnim('jump', { frames: [2, 3, 4], fps: 3 / s.air }); }
    if (s.phase === 1) {
      s.u = Math.min(1, s.u + dt / s.air);
      p.x = lerp(s.x0, s.x1, s.u); p.y = lerp(s.y0, s.y1, s.u);
      p.z = lerp(s.z0, s.z1, s.u) + 4 * s.h * s.u * (1 - s.u);
      if (s.enter && p.on !== s.enter && p.y <= s.enter.y + 2) p.on = s.enter;
      if (s.exit && p.on && p.y > p.on.y + 2) p.on = null;
      if (s.u < 1) return false;
      p.z = s.z1; s.phase = 2; w.setAnim('jump', { frames: [5], fps: 8, loop: false });
      if (s.z1 === 0) w.addFx('dust', p.x, p.y, { size: 60, alpha: .7 });
      return false;
    }
    return p.anim.done;
  }

  // ---- 장면 관리 ----
  w.startScene = (name, prio = 10, arg, q = p || w.pets[0]) => {
    const old = q.scene;
    q.scene = null; q.step = null; q.res = undefined;
    if (old) { try { old.gen.return(); } catch (e) { w.fail(e, 'return ' + old.name); } }
    if (q.anim) q.anim.on = null;   // 죽은 장면의 프레임 콜백이 다음 장면에서 발화하지 않게(공·인형이 붙어 버리던 원인)
    if (!MP.scenes[name]) name = 'calm';
    q.scene = { name, prio, t0: w.t, gen: MP.scenes[name](w, q, arg) };
    w.log.push([Math.round(w.t), name]); if (w.log.length > 4000) w.log.splice(0, 1000);
    w.used[name] = (w.used[name] || 0) + 1; q.lastAt[name] = w.t;
    q.recent.unshift(name); q.recent.length = Math.min(q.recent.length, 4);
  };
  w.fail = (e, where) => { if (w.errors.length < 20) w.errors.push(`${where}: ${e && e.stack || e}`); if (g.console) console.error('[mini_pet]', where, e); };
  function runScene(dt) {
    for (let guard = 0; guard < 25; guard++) {
      if (!p.scene) { const n = MP.choose(w, p); w.startScene(n, 10); }
      const sc = p.scene;
      if (w.t - sc.t0 > 900) { w.fail('장면 시간 초과', sc.name); w.startScene('calm', 10); continue; }
      if (!p.step) {
        let r;
        try { r = sc.gen.next(p.res); } catch (e) { w.fail(e, sc.name); p.scene = null; continue; }
        if (p.scene !== sc) continue;       // 장면 안에서 다른 장면을 시작함
        if (r.done) { p.scene = null; continue; }
        p.step = r.value; p.res = undefined;
      }
      let done;
      try { done = step(p.step, guard ? 0 : dt); } catch (e) { w.fail(e, sc.name + ' step'); w.startScene('calm', 10); continue; }   // startScene 이 이전 gen.return() → finally 가 돈다
      if (!done) return;
      p.res = p.step.result; p.step = null;
    }
    w.fail('한 프레임에 단계가 너무 많음', p.scene && p.scene.name); w.startScene('calm', 10);
  }

  // ---- 물리 ----
  function bounceFurniture(o) {
    for (const f of w.furnList) {
      if (!f.foot || f.def.flat) continue;
      const F = f.foot, nx = (o.x - F.x) / (F.rx + o.r * .6), ny = (o.y - F.y) / (F.ry + o.r * .3), d = Math.hypot(nx, ny);
      if (d >= 1 || o.z > f.hpx * .5) continue;
      const ux = nx / (d || 1), uy = ny / (d || 1);
      o.x = F.x + ux * (F.rx + o.r * .6) * 1.01; o.y = F.y + uy * (F.ry + o.r * .3) * 1.01;
      const vn = o.vx * ux + o.vy * uy; if (vn < 0) { o.vx -= 1.6 * vn * ux; o.vy -= 1.6 * vn * uy; }
    }
  }
  function propPhysics(o, dt, roll) {
    if (o.heldBy) return;
    const top = w.floorTopNow() - 40;
    if (o.z > 0 || o.vz > 0) {   // 바닥에 멈춰 있으면 중력을 더하지 않는다(쉬는 프레임 간격이 길 때 미세하게 튀는 것 방지)
      o.vz -= PC.gravity * dt; o.z += o.vz * dt;
      if (o.z <= 0) { o.z = 0; if (o.vz < -220) { o.vz = -o.vz * .45; o.squash = .25; } else o.vz = 0; }
    }
    o.x += o.vx * dt; o.y += o.vy * dt;
    const fr = o.z > 0 ? .25 : (roll ? .9 : 4.5);
    o.vx *= Math.exp(-fr * dt); o.vy *= Math.exp(-fr * dt);
    if (Math.abs(o.vx) < 4) o.vx = 0; if (Math.abs(o.vy) < 4) o.vy = 0;
    if (o.x < o.r + 20) { o.x = o.r + 20; o.vx = Math.abs(o.vx) * .6; }
    if (o.x > room.w - o.r - 20) { o.x = room.w - o.r - 20; o.vx = -Math.abs(o.vx) * .6; }
    if (o.y < top) { o.y = top; o.vy = Math.abs(o.vy) * .6; }
    if (o.y > room.floorBottom) { o.y = room.floorBottom; o.vy = -Math.abs(o.vy) * .6; }
    // 공중에 있을 때 창 위쪽 밖으로 사라지지 않게
    const zmax = o.y - w.view.top - o.r * 2 - 6; if (o.z > zmax) { o.z = zmax; if (o.vz > 0) o.vz = 0; }
    bounceFurniture(o);
    // 큰 가구 바로 뒤(화면상 가구에 가려지는 곳)에서 거의 멈추면 앞쪽으로 살짝 굴려 낸다 — 동물이 가구 뒤에 숨어 놀지 않게
    if (o.z === 0 && Math.hypot(o.vx, o.vy) < 40) for (const f of w.furnList) {
      if (!f.foot || f.def.flat || o.y >= f.y || o.y < f.y - f.hpx * .9 || Math.abs(o.x - f.x) > f.wpx * .55) continue;
      o.vy = Math.max(o.vy, 260); o.vx += Math.sign(o.x - f.x || 1) * 60;
    }
    if (roll) o.rot += o.vx * dt / o.r;
    o.squash = Math.max(0, o.squash - dt * 2);
  }
  function updateProps(dt) {
    const b = w.ball, dr = w.drag;
    // 사용자가 잡고 있는 소품
    if (dr && dr.kind !== 'pet') {
      const t = dr.kind === 'ball' ? b : w[dr.kind];
      if (t && dr.kind !== 'rope') {
        const top = w.floorTopNow() - 40;
        if (dr.y >= top) { t.y = clamp(dr.y, top, room.floorBottom); t.z = 0; dr.groundY = t.y; }
        else { t.y = clamp(dr.groundY, top, room.floorBottom); t.z = t.y - dr.y; }
        t.x = clamp(dr.x, t.r + 20, room.w - t.r - 20); t.z = Math.min(t.z, t.y - w.view.top - t.r * 2 - 4); t.vx = t.vy = t.vz = 0;
      }
    }
    // 공: 동물이 안고 있으면 앞발 사이, 아니면 굴러간다
    const bh = b.heldBy && b.heldBy !== 'user' ? b.heldBy : null;
    if (bh) {
      const fr = w.frame(bh), hp = fr.hug || [fr.center[0], fr.center[1] - 6], [hx, hy] = w.local(bh, fr, hp[0], hp[1]);
      b.x = hx; b.y = bh.y + 2; b.z = Math.max(0, bh.y - hy - b.r); b.vx = b.vy = b.vz = 0;
    } else propPhysics(b, dt, true);
    // 동물과 부딪힘(굴러오는 공)
    if (!b.heldBy && Math.hypot(b.vx, b.vy) > 260 && b.z < 60) for (const q of w.pets) {
      if (q.hold || q.glassK > 0 || q.on || (q.scene && q.scene.name === 'ball')) continue;
      const dx = b.x - q.x, dy = (b.y - q.y) * 2.2;
      if (Math.hypot(dx, dy) < .4 * w.bodyW(q.y, q)) { const d = Math.hypot(dx, dy) || 1; b.vx = dx / d * Math.abs(b.vx) * .5 + q.face * 40; b.vy *= .5; b.x = q.x + dx / d * .43 * w.bodyW(q.y, q); react(q, 'bump'); break; }
    }
    if (w.plush) {
      const t = w.plush, th = t.heldBy && t.heldBy !== 'user' ? t.heldBy : null;
      if (th) { const fr = w.frame(th), hp = fr.hug || [fr.reach[0] - 30, fr.reach[1] - 10], [hx, hy] = w.local(th, fr, hp[0], hp[1]); t.x = hx; t.y = th.y + 3; t.z = Math.max(0, th.y - hy - 10); }
      else propPhysics(t, dt, false);
    }
    if (w.rope) updateRope(dt);
    const tr = w.treat;
    if (tr) {
      if (tr.state === 'hand') { tr.x = clamp(w.pointer.x, 40, room.w - 40); tr.y = clamp(w.pointer.y + 30, w.view.top + 60, room.floorBottom); tr.z = 0; }
      else if (tr.state === 'fall') { tr.groundY = tr.groundY || clamp(tr.y + 90, w.floorTopNow(), room.floorBottom); tr.vz = (tr.vz || 0) + PC.gravity * dt; tr.y += tr.vz * dt; if (tr.y >= tr.groundY) { tr.y = tr.groundY; tr.state = 'floor'; while (w.inFoot(tr.x, tr.y - 18, 10) && tr.y < room.floorBottom - 4) tr.y += 12; w.addFx('dust', tr.x, tr.y, { size: 34, alpha: .5 }); } }
    }
    // 낚싯대 깃털: 포인터를 스프링으로 따라간다(흔들림)
    const T = w.teaser;
    if (T.on) {
      const tx = clamp(w.pointer.x, 30, room.w - 30), ty = clamp(w.pointer.y + 120, w.view.top + 60, room.floorBottom - 10);
      T.vx += ((tx - T.x) * 60 - T.vx * 9) * dt; T.vy += ((ty - T.y) * 60 - T.vy * 9) * dt;
      T.x += T.vx * dt; T.y += T.vy * dt;
    }
  }
  // 줄 장난감: 끝 a(동물 입 쪽) - 끝 b. 길이 고정. 사용자가 b 를 끌면 줄다리기.
  function updateRope(dt) {
    const r = w.rope, dr = w.drag, L = r.len, userB = dr && dr.kind === 'rope';
    const q = r.heldBy && r.heldBy !== 'user' ? r.heldBy : null;
    if (q) {
      const [mx, my] = w.anchor(q, 'mouth');
      let bx, by;
      if (userB) {   // 줄다리기: 팽팽해지면 동물이 끌려온다
        bx = clamp(dr.x, 30, room.w - 30); by = clamp(dr.y, w.view.top + 20, room.floorBottom);
        const d = Math.hypot(bx - mx, by - my) || 1;
        if (d > L) { const pull = d - L; q.x = clamp(q.x + clamp((bx - mx) / d * pull * 2.2 * dt, -90 * dt, 90 * dt), 155, room.w - 155); r.pulled = (r.pulled || 0) + pull * dt; bx = mx + (bx - mx) / d * L; by = my + (by - my) / d * L; }
      } else {       // 입에서 바닥으로 늘어진다
        const dy = clamp(q.y + 6 - my, 0, L); bx = clamp(mx + q.face * Math.sqrt(L * L - dy * dy), 24, room.w - 24); by = my + dy;
      }
      r.A = [mx, my]; r.B = [bx, by]; r.x = (mx + bx) / 2; r.y = q.y + 4; r.z = 0; r.vx = r.vy = r.vz = 0; r.ang = bx >= mx ? 0 : Math.PI;
      return;
    }
    propPhysics(r, dt, false);
    const dir = Math.cos(r.ang) >= 0 ? 1 : -1;
    let ax = r.x - dir * L / 2, ay = r.y - r.z, bx = r.x + dir * L / 2, by = r.y - r.z;
    if (userB) {   // 한쪽 끝을 끌면 반대쪽이 바닥에서 따라온다
      bx = clamp(dr.x, 30, room.w - 30); by = clamp(dr.y, w.view.top + 20, r.y);
      const d = Math.hypot(bx - ax, by - ay) || 1;
      if (d > L) { ax = bx - (bx - ax) / d * L; ay = Math.min(r.y, by - (by - ay) / d * L); }
      ay = r.y; r.x = (ax + bx) / 2; r.ang = bx >= ax ? 0 : Math.PI; r.vx = r.vy = r.vz = 0; r.z = 0;
    }
    r.A = [ax, ay]; r.B = [bx, by];
  }

  // ---- 들고 있을 때(목덜미 기준 매달림, 흔들림·늘어짐) — 처리 중 동물(p) 기준 ----
  function updateHold(dt) {
    const h = p.hold, dr = w.drag;
    if (!h) return;
    if (dr && dr.kind === 'pet' && dr.pet === p) {
      const fr = w.frame(p), sc = w.petScale(h.groundY, p), hang = (fr.pivot[1] - fr.top[1]) * sc;
      h.x = w.fitX(dr.x, fr, fr.top[0], sc * 1.06, p.face < 0, 20 + Math.abs(Math.sin(h.swing)) * hang * 1.1);
      h.y = clamp(dr.y, w.view.top + 12, Math.max(w.view.top + 12, w.view.bottom - 4 - hang * 1.22));
      const feet = h.y + hang; if (feet >= w.floorTopNow()) h.groundY = clamp(feet, w.floorTopNow(), room.floorBottom);
      h.vx = dr.vx; h.vy = dr.vy;
    }
    const target = clamp(-(h.vx || 0) * .00045, -.5, .5);
    h.sv += ((target - h.swing) * 40 - h.sv * 5) * dt; h.swing += h.sv * dt;
    const st = clamp(-(h.vy || 0) * .00022, -.06, .2) + Math.sin(w.t * 3.2) * .025;
    h.stretch = lerp(h.stretch, st, Math.min(1, dt * 8));
    h.vx = lerp(h.vx || 0, 0, Math.min(1, dt * 4)); h.vy = lerp(h.vy || 0, 0, Math.min(1, dt * 4));
    p.x = h.x; p.y = h.groundY;
  }

  // ---- 그리기·판정에 쓰는 동물 배치 ----
  // 반환: 프레임, 기준점 방 좌표(x,y), 배율 s, 좌우 반전, 기준점(px,py: 프레임 안), 회전, 늘어짐(sx,sy)
  w.pose = (q = w.pet) => {
    const fr = w.frame(q), s = w.petScale(q.y, q);
    const o = { fr, x: q.x, y: q.y - q.z, s, flip: q.face < 0, px: fr.pivot[0], py: fr.pivot[1], rot: 0, sx: 1, sy: 1 };
    if (!q.hold && q.glassK === 0) {   // 가구 위·점프 중에도 창 밖으로 안 나가게(아주 넓은 창에서 침대 위 키 큰 자세 등)
      o.x = w.fitX(o.x, fr, o.px, s, o.flip, 4);
      const top = o.y + (fr.bbox[1] - o.py) * s; if (top < w.view.top + 4) o.y += w.view.top + 4 - top;
    }
    if (q.hold) { const h = q.hold; o.px = fr.top[0]; o.py = fr.top[1]; o.x = h.x; o.y = h.y; o.rot = h.swing; o.sy = 1 + h.stretch; o.sx = 1 / Math.sqrt(o.sy); o.s = w.petScale(h.groundY, q); }
    if (q.glassK > 0) {   // 화면 앞 유리로 다가온 상태: 창 아래쪽에 크게
      const V = w.view, k = ease(q.glassK), sG = w.glassScale(q);
      const gx = w.fitX(q.glassX, fr, o.px, sG, o.flip, 12);
      o.s = lerp(s, sG, k); o.x = w.fitX(lerp(q.x, gx, k), fr, o.px, o.s, o.flip, 6); o.y = lerp(q.y - q.z, V.bottom - 6, k);
    }
    return o;
  };
  // 방 좌표 한 점이 그 동물 그림 위인가 (마스크 기준)
  w.hitPet = (x, y, q = w.pet) => {
    if (!q || q.hidden) return false;
    const o = w.pose(q), fr = o.fr;
    if (q.on && q.on.hole && (q.on.kind === 'tunnel' || q.on.kind === 'cave')) { const H = q.on.hole; if (((x - H.x) / H.rx) ** 2 + ((y - H.y) / H.ry) ** 2 > 1) return false; }
    let dx = x - o.x, dy = y - o.y;
    const c = Math.cos(-o.rot), sn = Math.sin(-o.rot); [dx, dy] = [dx * c - dy * sn, dx * sn + dy * c];
    const lx = (o.flip ? -dx : dx) / (o.s * o.sx) + o.px, ly = dy / (o.s * o.sy) + o.py;
    const [, , rw, rh] = fr.rect;
    if (lx < 0 || ly < 0 || lx >= rw || ly >= rh) return false;
    if (!fr.mask) { const [bx, by, bw, bh] = fr.bbox; return ((lx - bx - bw / 2) / (bw / 2)) ** 2 + ((ly - by - bh / 2) / (bh / 2)) ** 2 < 1; }
    const N = fr.maskN, cx = Math.floor(lx * N / rw), cy = Math.floor(ly * N / rh), k = cy * N + cx;
    // 가장자리는 한 칸 넉넉하게
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const xx = cx + ox, yy = cy + oy; if (xx >= 0 && yy >= 0 && xx < N && yy < N) { const q2 = yy * N + xx; if (fr.mask[q2 >> 3] >> (q2 & 7) & 1) return true; } }
    return !!(fr.mask[k >> 3] >> (k & 7) & 1);
  };
  // 그 자리의 동물(앞에 그려지는 쪽 우선: 들림 > 유리 > 깊이 y 큰 쪽)
  w.petAt = (x, y) => {
    const order = [...w.pets].sort((a, b2) => (b2.hold ? 2 : b2.glassK > 0 ? 1 : 0) - (a.hold ? 2 : a.glassK > 0 ? 1 : 0) || b2.y - a.y);
    return order.find(q => w.hitPet(x, y, q)) || null;
  };
  w.hitProp = (x, y) => {
    const near = (o, rx, ry) => o && !o.heldBy && Math.abs(x - o.x) < rx && y < o.y - o.z + 10 && y > o.y - o.z - ry;
    if (near(w.ball, w.ball.r + 12, w.ball.r * 2 + 16)) return 'ball';
    if (w.rope && w.rope.A) {   // 줄: 선분까지 거리
      const [ax, ay] = w.rope.A, [bx, by] = w.rope.B, vx = bx - ax, vy = by - ay, u = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
      if (Math.hypot(x - ax - vx * u, y - ay - vy * u) < 40) return 'rope';
    }
    if (near(w.plush, w.plush && w.plush.r + 10, 90)) return 'plush';
    return null;
  };

  // ---- 한 틱 ----
  let fxT = 0;
  w.update = dt => {
    dt = Math.min(dt, .1); w.t += dt;
    const N = cfg.needs, m = dt / 60;
    w._repel = false;
    for (const q of w.pets) {
      p = q;
      const n = q.needs, md = q.mood;
      n.energy = clamp(n.energy + m * (q.asleep ? N.energySleep : N.energyAwake + (w.night ? N.energyNightExtra : 0)), 0, 1);
      n.hunger = clamp(n.hunger + m * N.hungerUp, 0, 1);
      n.fun = clamp(n.fun - m * N.funDown, 0, 1);
      md.affection = clamp(md.affection - m * N.affectionDecay * Math.sign(md.affection - .3), 0, 1);
      md.annoy *= Math.pow(.5, dt / N.annoyHalfLife);
      if (w.stroke.active && w.stroke.pet === q && w.t - w.stroke.lastT < .6 && !q.hold) { md.affection = clamp(md.affection + dt * .012, 0, 1); n.fun = clamp(n.fun + dt * .01, 0, 1); }
      if (!w.drag || w.drag.kind !== 'pet' || w.drag.pet !== q) { if (q.hold && q.scene && q.scene.name !== 'held') q.hold = null; }

      tickAnim(dt);
      runScene(dt);
      updateHold(dt);
      // 점프·낙하가 중간에 끊겨도 공중에 남지 않게: 바닥(또는 올라가 있는 가구 높이)으로 내려온다
      const ground = q.on && q.on !== 'glass' ? q.on.seatZ : 0;
      if (!q.hold && !(q.step && (q.step.jump || q.step.tick)) && q.z !== ground && !(q.scene && q.scene.name === 'teaser' && q.anim.id === 'teaser_follow')) {
        if (q.z > ground) { q.vz -= PC.gravity * dt; q.z = Math.max(ground, q.z + q.vz * dt); } else q.z = Math.min(ground, q.z + 600 * dt);
        if (q.z === ground) q.vz = 0;
      }
      // 가구 발밑(바닥 점유 타원)에 "서 있으면" 앞쪽으로 밀어낸다 — 가구 뒤에 들어가 가려지는 것 방지.
      // 이동·추격·점프 스텝 중에는 끼어들지 않는다(지나가는 건 정상이고, 이동 목표와 싸우면 교착한다).
      const standing = !(q.step && (q.step.jump || q.step.move || q.step.chase || q.step.tick));
      if (standing && !q.on && !q.hold && q.glassK === 0 && !q.hidden) {
        for (const f of w.furnList) {
          if (!f.foot || f.def.flat) continue;
          const F = f.foot;
          let nx = (q.x - F.x) / F.rx, ny = (q.y - F.y) / F.ry;
          if (nx * nx + ny * ny >= 1) continue;
          if (ny < .2) { nx = Math.sign(nx || q.face) * .9; ny = .65; }   // 뒤·옆이면 앞쪽 모서리로 돌아 나온다
          const [bx, by] = w.clampFloor(F.x + nx * (F.rx + 10), F.y + ny * (F.ry + 10), 90);
          const d = Math.hypot(bx - q.x, by - q.y) || 1, mv = Math.min(d, 170 * w.depth(q.y) * dt);
          q.x += (bx - q.x) / d * mv; q.y += (by - q.y) / d * mv; w._repel = true;
        }
      }
      if (!q.on && !q.hold && q.glassK === 0) { const fr = w.frame(q); q.x = w.fitX(q.x, fr, fr.pivot[0], w.petScale(q.y, q), q.face < 0, 6); }
      // 포인터가 이 동물 위에 오래 머무는 시간(부끄러워하기)
      q.overT = w.pointer.inside && !w.drag && w.hitPet(w.pointer.x, w.pointer.y, q) ? q.overT + dt : 0;
    }
    p = null;

    // 둘이 겹쳐 서 있으면 살짝 벌린다(서 있는 쪽만, 이동 중인 쪽 경로는 건드리지 않음)
    if (w.pets.length > 1) {
      const [a, b2] = w.pets;
      const stand = q => !(q.step && (q.step.jump || q.step.move || q.step.chase || q.step.tick)) && !q.hold && q.glassK === 0 && !q.hidden;
      if (!a.hold && !b2.hold && a.glassK === 0 && b2.glassK === 0 && a.on === b2.on) {
        const minD = .6 * (w.bodyW(a.y, a) + w.bodyW(b2.y, b2)) / 2;
        const dx = b2.x - a.x;
        if (Math.abs(dx) < minD && Math.abs(b2.y - a.y) < 40) {
          const push = Math.min(110 * dt, (minD - Math.abs(dx)) / 2 + 2), dir = Math.sign(dx) || 1;
          const lim = q2 => q2.on ? [q2.on.x - q2.on.wpx * .3, q2.on.x + q2.on.wpx * .3] : [120, room.w - 120];
          if (stand(a)) { const [lo, hi] = lim(a); a.x = clamp(a.x - dir * push, lo, hi); }
          if (stand(b2)) { const [lo, hi] = lim(b2); b2.x = clamp(b2.x + dir * push, lo, hi); }
          if (stand(a) || stand(b2)) w._repel = true;
        }
      }
    }

    updateProps(dt);

    // 주기 효과: 잠(zzz), 쓰다듬기(하트), 달리기 먼지
    fxT += dt;
    if (fxT > .25) {
      fxT = 0;
      for (const q of w.pets) {
        p = q;
        if (q.asleep && R.chance(.12)) w.headFx('sleep_bubbles');
        if (w.stroke.active && w.stroke.pet === q && w.t - w.stroke.lastT < .6 && q.scene && q.scene.name === 'petting' && R.chance(.35)) w.headFx('hearts', { size: 46 });
        if (['zoomies', 'run', 'ball_chase'].includes(q.anim.id) && !q.on && R.chance(.5)) w.addFx('dust', q.x - q.face * .3 * w.bodyW(q.y, q), q.y, { size: 44, alpha: .55 });
      }
      p = null;
    }

    for (const f of w.fx) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; }
    w.fx = w.fx.filter(f => f.t < f.life);
    if (w.fx.length > 60) w.fx.splice(0, w.fx.length - 60);

    // 움직임 두 단계: heavy = 위치가 매 프레임 바뀜(화면 주사율로), light = 천천히 흐르는 것만(말풍선·안긴 소품, 20fps 면 충분).
    // 아무것도 없으면 다음 애니메이션 프레임(6~10fps)까지 쉰다. 유리 찐빵 "유지"는 6fps 루프라 heavy 가 아니다(붙기·떨어지기는 each 스텝이 heavy).
    const b = w.ball;
    const petHeavy = w.pets.some(q => q.hold || (q.step && (q.step.move || q.step.chase || q.step.jump || q.step.glide || q.step.each || q.step.tick)));
    w.activeHeavy = !!(w._repel || w.drag || petHeavy || w.teaser.on || (w.treat && w.treat.state !== 'floor') ||
      b.z > 0 || b.vx || b.vy ||
      (w.plush && (w.plush.z > 0 || w.plush.vx || w.plush.heldBy === 'user')) || (w.rope && w.rope.z > 0));
    w.activeLight = !!(w.fx.length || b.squash > 0 || (b.heldBy && b.heldBy !== 'user') ||
      (w.plush && w.plush.heldBy && w.plush.heldBy !== 'user') || (w.rope && w.rope.heldBy));
    w.active = w.activeHeavy || w.activeLight;
  };
  w.nextFrameIn = () => Math.min(...w.pets.map(q => q.anim.done ? 1 : Math.max(0, 1 / q.anim.fps - q.anim.t)), 1);

  w.addPet(opt.character, opt.scene);
  if (opt.friend) w.addPet(opt.friend);
  return w;
};
})(typeof window !== 'undefined' ? window : globalThis);
