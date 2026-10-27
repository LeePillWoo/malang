// 노드 빨리 감기 점검: 게임 시뮬레이션을 그림 없이 몇 시간 분량 돌리며 상태·경계·예외를 검사한다.
//   node tools/sim_check.cjs [시간(시)=3] [시드=1] [idle] [동물=config 기본] [친구 동물(둘이 모드)]
// 1) 고정 시나리오(자는 중 클릭, 노는 중 들기, 상자·터널·유리·줄다리기 중 들기 …)
// 2) 무작위 사용자 입력 + 창 크기 변경을 섞은 장시간 실행 → 행동·장면 사용 분포
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, Math, Date, JSON, Uint8Array, Buffer, Object, Array, Number, String, Error, Set, Map, isFinite };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
const run = f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
run(path.join(root, 'js/config.js'));
run(path.join(root, 'data/assets.js')); run(path.join(root, 'data/metrics.js')); run(path.join(root, 'js/tuning.js'));
run(path.join(root, 'js/sim.js')); run(path.join(root, 'js/behaviors.js'));
const MP = ctx.MP, cfg = ctx.MP_CONFIG, room = cfg.room;
const data = MP.buildData(ctx.PET_ASSETS, ctx.PET_METRICS, ctx.MP_TUNING);
const hours = +(process.argv[2] || 3), seed = +(process.argv[3] || 1), withUser = process.argv[4] !== 'idle';
if (process.argv[5]) cfg.character = process.argv[5];
const FRIEND = process.argv[6] || null;
const DT = 1 / 30;
let fails = [];
const fail = (w, msg) => { if (fails.length < 40) fails.push(`[t=${w.t.toFixed(1)} ${w.pet.scene && w.pet.scene.name}/${w.pet.anim.id}] ${msg}`); };

function setView(w, Wpx, Hpx) {   // view.js layout() 과 같은 계산
  const s = Math.min(Wpx / room.w, Hpx / room.minVisibleH), ox = (Wpx - room.w * s) / 2, oy = Hpx - room.h * s;
  w.view = { left: Math.max(0, -ox / s), right: Math.min(room.w, (Wpx - ox) / s), top: -oy / s, bottom: room.h };
  const top = w.floorTopNow(), p = w.pet;
  if (!p.on && !p.hold && p.y < top) p.y = top;
  for (const o of [w.ball, w.plush, w.rope]) if (o && o.y < top - 40) o.y = top - 40;
}
// 고양이 그림 사각형(방 좌표)
function petBox(w, q) {
  const o = w.pose(q), fr = o.fr, [bx, by, bw, bh] = fr.bbox, sx = o.s * o.sx, sy = o.s * o.sy;
  let x0 = (bx - o.px) * sx, x1 = (bx + bw - o.px) * sx; if (o.flip) [x0, x1] = [-x1, -x0];
  const ext = Math.abs(Math.sin(o.rot)) * bh * sy;
  return [o.x + x0 - ext, o.y + (by - o.py) * sy, o.x + x1 + ext, o.y + (by + bh - o.py) * sy];
}
const seen = new Set();
// 전환 튐: 애니메이션이 바뀌는 순간 직전·직후 그림의 몸 중심(가로)·바닥 차이를 몸 폭 대비로 잰다
const jumps = {}; let prevBox = null, prevKey = '', prevW = null;
function trackJump(w) {
  const p = w.pets[0]; if (w !== prevW || p.hidden || p.hold || p.glassK > 0) { prevBox = null; prevW = w; return; }
  const [x0, y0, x1, y1] = petBox(w, p), key = p.anim.id + ':' + p.anim.list[p.anim.i];
  if (prevBox && key !== prevKey && prevKey.split(':')[0] !== p.anim.id) {
    const wd = (x1 - x0 + prevBox[2] - prevBox[0]) / 2, dx = Math.abs((x0 + x1) / 2 - (prevBox[0] + prevBox[2]) / 2) / wd, dy = Math.abs(y1 - prevBox[3]) / wd;
    const k = prevKey + ' → ' + key, j = jumps[k] || (jumps[k] = { n: 0, dx: 0, dy: 0 });
    j.n++; j.dx = Math.max(j.dx, dx); j.dy = Math.max(j.dy, dy);
  }
  prevBox = [x0, y0, x1, y1]; prevKey = key;
}
function check(w) {
  trackJump(w);
  if (process.env.DUMP) for (const q of w.pets) if (q.scene && q.scene.name === 'social_follow' && w.t - q.scene.t0 > 250 && !w._dumped) {
    w._dumped = 1;
    const s = q.step || {};
    console.log('STUCK', q.ch.id, '나이', (w.t - q.scene.t0) | 0, '| step', Object.keys(s).join(','), '| play', s.play, '| until', !!s.until, 'max', s.max, 'el', s.el && s.el.toFixed(1), '| move', JSON.stringify(s.move), 'path', s.path && s.path.length, 'turning', s.turning, 'ending', s.ending, 'maxTime', s.maxTime, 'started', s.started);
    console.log('  anim', q.anim.id, JSON.stringify(q.anim.list), 'i', q.anim.i, 'done', q.anim.done, 'loop', q.anim.loop, 'fps', q.anim.fps, 'loops', q.anim.loops);
    console.log('  pet x', q.x | 0, 'y', q.y | 0, 'on', q.on && q.on.id, 'hold', !!q.hold, 'asleep', q.asleep, 'glassK', q.glassK);
    const L = w.pets.find(x => x !== q);
    console.log('  리더', L.ch.id, L.scene && L.scene.name, '나이', L.scene ? (w.t - L.scene.t0) | 0 : '-');
  }
  if (w.errors.length) { fail(w, 'errors: ' + w.errors.join(' | ').slice(0, 600)); w.errors.length = 0; }
  const V = w.view;
  for (const p of w.pets) {
    const a = p.anim;
    seen.add(a.id);
    if (![p.x, p.y, p.z].every(Number.isFinite)) fail(w, `NaN 위치 ${p.x},${p.y},${p.z}`);
    if (!p.ch.anims[a.id] || a.list.some(i => i < 0 || i > 5)) fail(w, '잘못된 프레임');
    if (p.hold && (!p.scene || p.scene.name !== 'held')) fail(w, '들고 있는데 held 장면이 아님');
    if (p.asleep && !['nap', 'disturbed', 'plush'].includes(p.scene && p.scene.name)) fail(w, '잠든 상태가 다른 장면에 남음');
    if (p.on === 'glass' && (!p.scene || !['glass', 'tapwin', 'noticed'].includes(p.scene.name))) fail(w, '유리 상태가 남음');
    if (p.on && p.on !== 'glass' && !w.furnList.includes(p.on)) fail(w, 'p.on 이 이상함');
    const up = !p.hold && !(p.step && (p.step.jump || p.step.tick)) && p.z > (p.on && p.on !== 'glass' ? p.on.seatZ : 0) + 30 && p.anim.id !== 'teaser_follow';
    p._airT = up ? (p._airT || 0) + DT : 0; if (p._airT > .5) fail(w, `공중에 떠 있음 z=${p.z | 0}`);
    const standing = !(p.step && (p.step.jump || p.step.move || p.step.chase || p.step.tick));
    const inF = standing && !p.on && !p.hold && p.glassK === 0 && !p.hidden &&
      w.furnList.some(f => f.foot && !f.def.flat && ((p.x - f.foot.x) / f.foot.rx) ** 2 + ((p.y - f.foot.y) / f.foot.ry) ** 2 < .8);
    p._footT = inF ? (p._footT || 0) + DT : 0; if (p._footT > 2) { fail(w, `가구 발밑에 머묾 (${p.x | 0},${p.y | 0})`); p._footT = 0; }
    if (!p.on && !p.hold && p.glassK === 0 && (p.y < w.floorTopNow() - 3 || p.y > room.floorBottom + 1)) fail(w, `바닥 밖 y=${p.y.toFixed(0)} (위 한계 ${w.floorTopNow().toFixed(0)})`);
    if (!p.hidden) {
      const [x0, y0, x1, y1] = petBox(w, p);
      if (x0 < V.left - 4 || x1 > V.right + 4 || y0 < V.top - 4 || y1 > V.bottom + 4) fail(w, `동물이 창 밖 [${x0 | 0},${y0 | 0},${x1 | 0},${y1 | 0}] view top ${V.top | 0}`);
    }
  }
  // 둘이 한 자리에 겹쳐 서서 오래 머물지 않는지
  if (w.pets.length > 1) {
    const [a1, b1] = w.pets;
    const stand = q => !(q.step && (q.step.jump || q.step.move || q.step.chase || q.step.tick)) && !q.hold && q.glassK === 0 && !q.hidden;
    const over = stand(a1) && stand(b1) && a1.on === b1.on && Math.abs(a1.x - b1.x) < .3 * (w.bodyW(a1.y, a1) + w.bodyW(b1.y, b1)) / 2 && Math.abs(a1.y - b1.y) < 30;
    w._dupT = over ? (w._dupT || 0) + DT : 0; if (w._dupT > 3) { fail(w, `둘이 겹친 채 머묾 (${a1.x | 0} vs ${b1.x | 0})`); w._dupT = 0; }
  }
  for (const o of [w.ball, w.plush, w.rope]) {
    if (!o) continue;
    if (![o.x, o.y, o.z].every(Number.isFinite)) fail(w, o.kind + ' NaN');
    if (o.x < V.left - 5 || o.x > V.right + 5 || o.y - o.z - o.r * 2 < V.top - 5 || o.y > V.bottom + 1) fail(w, `${o.kind} 창 밖 (${o.x | 0},${o.y | 0},z${o.z | 0})`);
  }
  const bh = w.ball.heldBy, rh = w.rope && w.rope.heldBy, ph2 = w.plush && w.plush.heldBy;
  if (bh && bh !== 'user' && !(bh.scene && ['ball', 'startle'].includes(bh.scene.name))) fail(w, '공이 동물에게 붙은 채 남음');
  if (rh && rh !== 'user' && !(rh.scene && rh.scene.name === 'rope')) fail(w, '줄이 입에 붙은 채 남음');
  if (ph2 && ph2 !== 'user' && !(ph2.scene && ['plush', 'nap'].includes(ph2.scene.name))) fail(w, '인형이 붙은 채 남음');
}
function newWorld(s, scene, friend) { const w = MP.createWorld(data, cfg, { seed: s, scene, character: cfg.character, friend }); setView(w, 640, 420); w.placeToy('plush', true, true); return w; }
function steps(w, sec, each) { for (let i = 0, n = Math.round(sec / DT); i < n; i++) { if (each) each(i); w.update(DT); check(w); } }
const until = (w, fn, max = 600) => { for (let i = 0; i < max / DT; i++) { if (fn()) return true; w.update(DT); check(w); } return false; };
// 들기: 고양이 위 → 위로 끌기 → (높이 h 에서) 놓기
function lift(w, upTo, dx = 0) {
  const p = w.pet, [tx, ty] = w.topPoint();
  w.input('liftStart', { x: tx, y: ty + 20 });
  for (let i = 0; i < 20; i++) { w.input('dragMove', { x: tx + dx * i / 20, y: ty + 20 + (upTo - ty - 20) * i / 20, dt: DT }); w.update(DT); check(w); }
  steps(w, .5); w.input('dragEnd'); steps(w, 4);
}

// ---------- 1) 고정 시나리오 ----------
const S = [];
function scenario(name, fn) { const before = fails.length; let err = ''; try { fn(); } catch (e) { err = String(e.message || e); fails.push(name + ': ' + err); } S.push(`${fails.length === before ? 'OK ' : 'NG '} ${name}` + (fails.length > before ? '\n     → ' + (err || fails[before]).slice(0, 300) : '')); }
scenario('자는 중 클릭 → 깨기 → (다시 잠 또는 깨어 있음)', () => {
  const w = newWorld(11, 'nap'); w.pet.needs.energy = .2;
  if (!until(w, () => w.pet.asleep, 300)) throw Error('잠들지 않음');
  const bed = w.pet.on;
  w.input('tapPet'); steps(w, .1);
  if (w.pet.scene.name !== 'disturbed') throw Error('disturbed 아님: ' + w.pet.scene.name);
  steps(w, 30); if (bed && w.pet.on !== bed && w.pet.scene.name === 'disturbed') throw Error('깨는 중 침대에서 떨어짐');
});
scenario('자는 중 연속 클릭 → 화내고 피함, 상태 정상', () => {
  const w = newWorld(12, 'nap'); w.pet.needs.energy = .2; until(w, () => w.pet.asleep, 300);
  for (let i = 0; i < 4; i++) { w.input('tapPet'); steps(w, .4); }
  steps(w, 20); if (w.pet.asleep && w.pet.scene.name !== 'disturbed' && w.pet.scene.name !== 'nap') throw Error('잠 상태 꼬임');
});
scenario('자는 중 쓰다듬기 → 계속 잔다', () => {
  const w = newWorld(13, 'nap'); w.pet.needs.energy = .2; until(w, () => w.pet.asleep, 300);
  w.input('strokeStart'); steps(w, 3, i => { if (i % 5 === 0) w.input('stroke'); }); w.input('strokeEnd');
  if (!w.pet.asleep) throw Error('깨버림');
});
scenario('공 안는 중 들기 → 공 놓고 들림 → 떨어져 데굴', () => {
  const w = newWorld(14, 'calm'); w.ball.x = w.pet.x + 260; w.ball.y = w.pet.y;
  w.input('tapProp', { kind: 'ball' });
  if (!until(w, () => w.ball.heldBy === w.pet, 60)) { S.push('   (안기까지 못 감: ' + w.pet.scene.name + ')'); }
  lift(w, w.view.top + 60);
  if (w.ball.heldBy) throw Error('공이 붙어 있음');
  if (w.pet.hold) throw Error('hold 남음');
});
scenario('가구 자리에 떨어뜨리면 그 위에 앉는다(침대)', () => {
  const w = newWorld(28, 'calm'), bed = w.furn.bed, p = w.pet;
  const [tx, ty] = w.topPoint();
  w.input('liftStart', { x: tx, y: ty + 20 });
  for (let i = 0; i <= 40; i++) { const u = i / 40; w.input('dragMove', { x: tx + (bed.x - tx) * u, y: ty + 20 + (260 - ty - 20) * u, dt: DT }); w.update(DT); check(w); }
  for (let i = 0; i < 80; i++) {   // 발이 침대 발밑 타원 안에 올 때까지만 낮게 내린다
    const F = bed.foot, gx = p.hold.x, gy = p.hold.groundY;
    if (((gx - F.x) / F.rx) ** 2 + ((gy - F.y) / F.ry) ** 2 < .5) break;
    w.input('dragMove', { x: bed.x, y: 260 + i * 2, dt: DT }); w.update(DT); check(w);
  }
  w.input('dragEnd');
  if (!until(w, () => p.on === bed, 4)) throw Error('침대에 안 앉음: on=' + (p.on && p.on.id) + ' y=' + (p.y | 0));   // 앉은 뒤 스스로 내려오는 건 자유
  steps(w, 6);
});
scenario('가구 뒤 바닥에 억지로 세워도 앞으로 빠져나온다', () => {
  const w = newWorld(29, 'calm'), p = w.pet, f = w.furn.bed;
  p.x = f.foot.x; p.y = Math.max(w.floorTopNow(), f.foot.y - f.foot.ry * .5);   // 침대 뒤쪽 깊숙이
  steps(w, 4);
  const F = f.foot, nx = (p.x - F.x) / F.rx, ny = (p.y - F.y) / F.ry;
  if (!p.on && nx * nx + ny * ny < 1) throw Error('여전히 발밑 안: ' + (p.x | 0) + ',' + (p.y | 0));
});
scenario('둘이 모드: 교감(비비기·놀이·티격태격)이 나오고 상태 정상', () => {
  const w = newWorld(40, 'calm', 'dog');
  if (w.pets.length !== 2) throw Error('친구 추가 안 됨');
  w.pets[0].needs.fun = .4; w.pets[1].needs.fun = .4;
  steps(w, 1500);   // 25분 빨리 감기
  if (!w.used.social) throw Error('social 안 나옴: ' + JSON.stringify(w.used));
  if (!w.used.social_follow) throw Error('상대 역 장면 안 나옴');
});
scenario('둘이: 친구를 들어 옮기고 떨어뜨려도 둘 다 정상', () => {
  const w = newWorld(41, 'calm', 'bear'), q = w.pets[1];
  const [tx, ty] = w.topPoint(q);
  w.input('liftStart', { x: tx, y: ty + 20, pet: q });
  for (let i = 0; i < 25; i++) { w.input('dragMove', { x: tx - i * 12, y: ty + 20 - i * 8, dt: DT }); w.update(DT); check(w); }
  w.input('dragEnd'); steps(w, 5);
  if (q.hold) throw Error('hold 남음');
  if (q.scene && q.scene.name === 'held' && w.t > 90) throw Error('held 안 끝남');
});
scenario('둘이: 친구 빼기 → 남은 쪽 정상', () => {
  const w = newWorld(42, 'calm', 'chick');
  steps(w, 30);
  w.setFriend(null);
  if (w.pets.length !== 1) throw Error('안 빠짐');
  steps(w, 20);
});
scenario('쓰다듬기 길게 → 부비기/배 보여주기/간지럼 → 끝나면 정상', () => {
  const w = newWorld(15, 'calm'); w.pet.mood.affection = .8;
  w.input('strokeStart'); const seenA = new Set();
  steps(w, 12, i => { if (i % 4 === 0) w.input('stroke'); seenA.add(w.pet.anim.id); }); w.input('strokeEnd'); steps(w, 6);
  for (const a of ['pet_react', 'rub', 'belly_show', 'tickled']) if (!seenA.has(a)) throw Error(a + ' 안 나옴: ' + [...seenA]);
});
scenario('계속 클릭 → 놀람·화남·피하기', () => {
  const w = newWorld(16, 'calm'); const seenA = new Set();
  for (let i = 0; i < 8; i++) { w.input('tapPet'); steps(w, .5, () => seenA.add(w.pet.anim.id)); }
  steps(w, 8, () => seenA.add(w.pet.anim.id));
  if (!seenA.has('angry') || !seenA.has('startled')) throw Error('반응 부족: ' + [...seenA]);
});
scenario('상자 안에서 들기 → 상자 밖', () => {
  const w = newWorld(17, 'box'); until(w, () => w.pet.boxHide, 120) || (() => { throw Error('상자에 못 들어감'); })();
  lift(w, w.view.top + 200, 200);
  if (w.pet.boxHide || w.pet.hidden || w.pet.dim) throw Error('상자 상태 남음');
  if (w.pet.on === w.furn.box) throw Error('상자에 그대로 있음');   // 다른 가구 자리에 떨어지면 그 위에 앉는 건 정상
});
scenario('터널·숨숨집: 들어가 숨기 → 입구 밖은 클릭 안 됨 → 빼꼼 → 장면 끝', () => {
  const w = newWorld(18, 'tunnel'), t = w.furn.tunnel, inside = () => (t.kind === 'cave' ? w.pet.dim : w.pet.hidden);
  until(w, inside, 120) || (() => { throw Error('터널·숨숨집에 못 들어감'); })();
  const H = t.hole;
  if (w.hitPet(H.x + H.rx * 1.7, H.y) || (t.kind === 'tunnel' && w.hitPet(t.x, t.y - 80))) throw Error('가려진 곳인데 클릭됨');
  const seenA = new Set();
  until(w, () => (seenA.add(w.pet.anim.id), w.pet.scene.name !== 'tunnel'), 60) || (() => { throw Error('장면이 안 끝남'); })();
  if (!seenA.has('peek')) throw Error('빼꼼 안 나옴');
});
scenario('유리 찐빵 중 클릭(하트)·들기 → 유리 상태 해제', () => {
  const w = newWorld(19, 'glass'); until(w, () => w.pet.glassK >= 1, 60) || (() => { throw Error('유리까지 못 감'); })();
  w.input('tapPet'); steps(w, .5); if (w.pet.scene.name !== 'glass') throw Error('클릭에 유리 장면이 끊김');
  lift(w, w.view.top + 300); if (w.pet.glassK !== 0 || w.pet.on === 'glass') throw Error('유리 상태 남음 glassK=' + w.pet.glassK.toFixed(2) + ' on=' + (w.pet.on && w.pet.on.id) + ' scene=' + w.pet.scene.name + ' anim=' + w.pet.anim.id + ' xy=' + (w.pet.x | 0) + ',' + (w.pet.y | 0));
});
scenario('유리 찐빵 끝까지 → 바닥 복귀', () => {
  const w = newWorld(20, 'glass'); until(w, () => w.pet.scene.name !== 'glass', 60);
  if (w.pet.glassK !== 0 || w.pet.on) throw Error('복귀 안 됨');
});
scenario('줄다리기: 반대쪽 끌기 → 끌려옴 → 놓음', () => {
  const w = newWorld(21, 'calm'); w.placeToy('rope', true);
  until(w, () => w.rope.heldBy === w.pet, 40) || (() => { throw Error('줄을 안 묾: ' + w.pet.scene.name); })();
  const r = w.rope, x0 = w.pet.x, far = r.x + Math.cos(r.ang) * r.len;
  w.input('grab', { kind: 'rope', x: far, y: r.y });
  for (let i = 0; i < 60; i++) { w.input('dragMove', { x: far + Math.cos(r.ang) * i * 6, y: r.y, dt: DT }); w.update(DT); check(w); }
  if (Math.abs(w.pet.x - x0) < 10) throw Error('끌려오지 않음');
  w.input('dragEnd'); steps(w, 10);
});
scenario('줄 무는 중 들기', () => {
  const w = newWorld(22, 'calm'); w.placeToy('rope', true); until(w, () => w.rope.heldBy === w.pet, 40);
  lift(w, w.view.top + 150); if (w.rope.heldBy) throw Error('줄 붙음');
});
scenario('낚싯대: 깃털 따라가기·폴짝·덮치기', () => {
  const w = newWorld(23, 'calm'); const seenA = new Set();
  w.input('teaser', { on: true });
  steps(w, 25, i => { const t = i * DT; w.input('pointer', { x: 760 + Math.sin(t * .9) * 420, y: 560 + Math.sin(t * 2.3) * 220 }); seenA.add(w.pet.anim.id); });
  w.input('teaser', { on: false }); steps(w, 5);
  for (const a of ['teaser_follow']) if (!seenA.has(a)) throw Error(a + ' 안 나옴: ' + [...seenA]);
  S.push('   낚싯대 중 나온 행동: ' + [...seenA].join(','));
});
scenario('간식: 들고 있으면 조르기 → 떨어뜨리면 냄새·먹기·만족', () => {
  const w = newWorld(24, 'calm'); const seenA = new Set();
  w.input('pointer', { x: 700, y: 560 }); w.input('treat', { on: true });
  steps(w, 8, () => seenA.add(w.pet.anim.id));
  w.input('tapGlass', { x: 700, y: 560 }); steps(w, 15, () => seenA.add(w.pet.anim.id));
  for (const a of ['beg_treat', 'sniff', 'eat', 'satisfied']) if (!seenA.has(a)) throw Error(a + ' 안 나옴: ' + [...seenA]);
  if (w.treat) throw Error('간식이 남음');
});
scenario('간식 드는 중 들기 → 간식 모드 유지, 상태 정상', () => {
  const w = newWorld(25, 'calm'); w.input('treat', { on: true }); steps(w, 2); lift(w, w.view.top + 200); steps(w, 5);
});
scenario('창 크기 바꾸기(넓게·좁게·세로) 중에도 창 안', () => {
  const w = newWorld(26, 'stroll');
  for (const [W, H] of [[900, 300], [1000, 260], [360, 600], [480, 320], [1600, 900]]) { setView(w, W, H); steps(w, 20); }
});

// ---------- 2) 장시간 무작위 ----------
const w = newWorld(seed, 'calm', FRIEND);
const R = MP.rng(seed * 7 + 3);
const N = Math.round(hours * 3600 / DT);
let nextUser = 30, sizes = [[640, 420], [480, 320], [900, 340], [420, 560], [760, 480]];
const hourly = [], share = {};
for (let i = 0; i < N; i++) {
  const t = i * DT;
  if (withUser && t > nextUser) {
    nextUser = t + R.range(20, 240);
    const k = R.int(0, 11), p = w.pet;
    const [px, py] = w.topPoint();
    if (k === 0) w.input('tapPet');
    else if (k === 1) { w.input('strokeStart'); steps(w, R.range(1, 8), j => { if (j % 4 === 0) w.input('stroke'); }); w.input('strokeEnd'); }
    else if (k === 2) lift(w, R.range(w.view.top + 30, room.floorBottom - 100), R.range(-400, 400));
    else if (k === 3) w.input('tapProp', { kind: 'ball' });
    else if (k === 4) { w.input('grab', { kind: 'ball', x: w.ball.x, y: w.ball.y }); for (let j = 0; j < 10; j++) { w.input('dragMove', { x: w.ball.x + j * 25, y: w.ball.y - j * 30, dt: DT }); w.update(DT); check(w); } w.input('dragEnd'); }
    else if (k === 5) { w.input('teaser', { on: true }); steps(w, R.range(5, 30), j => w.input('pointer', { x: 760 + Math.sin(j * .05) * 500, y: 600 + Math.sin(j * .11) * 250 })); w.input('teaser', { on: false }); }
    else if (k === 6) { w.input('pointer', { x: R.range(200, 1300), y: R.range(500, 900) }); w.input('treat', { on: true }); steps(w, R.range(2, 10)); w.input('tapGlass', { x: w.pointer.x, y: w.pointer.y }); }
    else if (k === 7) w.input('toy', { kind: R.chance(.5) ? 'plush' : 'rope', on: R.chance(.6) });
    else if (k === 8) w.input('tapGlass', { x: R.range(100, 1400), y: R.range(500, 1010) });
    else if (k === 9) setView(w, ...R.pick(sizes));
    else if (k === 10) w.input('toy', { kind: 'ball' });
    else { for (let j = 0; j < 90; j++) { w.input('pointer', { x: px + Math.sin(j * .2) * 200, y: py - 100 + j }); w.update(DT); check(w); } }
    void p;
  }
  w.update(DT); check(w);
  { const k = w.pet.asleep ? '(잠)' : w.pet.scene ? w.pet.scene.name : '-'; share[k] = (share[k] || 0) + DT; }
  if (i % Math.round(3600 / DT) === 0 && i) hourly.push(JSON.stringify(Object.fromEntries(Object.entries(w.pet.needs).map(([k, v]) => [k, +v.toFixed(2)]))));
}
const actions = Object.keys(data.actions), unused = actions.filter(a => !seen.has(a));
console.log('전환 튐 상위(몸 폭 대비, dx=가로 중심 이동 dy=바닥 이동):');
console.log(Object.entries(jumps).map(([k, j]) => [k, j, Math.max(j.dx, j.dy * 2)]).sort((a, b) => b[2] - a[2]).slice(0, 18).map(([k, j]) => `  ${k}  ×${j.n}  dx ${(j.dx * 100).toFixed(0)}% dy ${(j.dy * 100).toFixed(0)}%`).join('\n'));
console.log(S.join('\n'));
console.log(`\n[${w.pets.map(q => q.ch.id).join('+')}] ${withUser ? '무작위 입력' : '입력 없이'} ${hours}시간: 장면 ${w.log.length}개 · 쓰인 행동 ${seen.size}/${actions.length}` + (unused.length ? ' · 안 쓰인 행동: ' + unused.join(', ') : ''));
console.log('장면 횟수: ' + Object.entries(w.used).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('시간별 욕구: ' + hourly.join(' '));
console.log('시간 비율: ' + Object.entries(share).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / (hours * 36)).toFixed(1)}%`).join(', '));
const seq = w.log.slice(-25).map(([t, n]) => n).join(' → ');
console.log('마지막 장면 흐름: ' + seq);
console.log(fails.length ? '\n문제 ' + fails.length + '건:\n' + fails.slice(0, 25).join('\n') + (fails.length > 25 ? '\n…\n' + fails.slice(-5).join('\n') : '') : '\n문제 없음');
process.exitCode = fails.length ? 1 : 0;
