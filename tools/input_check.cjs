// 실제 마우스 이벤트로 입력 경로 점검(헤드리스 크롬). 창 크기를 바꿔 가며 클릭 위치가 맞는지도 본다.
//   node tools/input_check.cjs
'use strict';
const { launch, sleep } = require('./cdp.cjs');
const path = require('path'), fs = require('fs');
const out = path.join(process.env.TEMP || '/tmp', 'minipet_shots'); fs.mkdirSync(out, { recursive: true });
const URL = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const res = [];
const ok = (name, cond, info = '') => res.push(`${cond ? 'OK' : 'NG'}  ${name}${info ? '  ' + info : ''}`);
(async () => {
  const b = await launch(640, 420);
  await b.open(URL, 300); await b.eval(`localStorage.setItem('miniPet.v1', JSON.stringify({hint:1,lastSeen:Date.now(),plush:false}))`);
  await b.open(URL, 2000);
  const E = s => b.eval(s);
  // 고양이 몸 위 한 점(화면 좌표): 마스크로 맞는 점을 찾는다
  const body = () => E(`(()=>{const o=pet.pose(),fr=o.fr,[bx,by,bw,bh]=fr.bbox;for(const [u,v] of [[.5,.6],[.4,.55],[.6,.65],[.5,.4]]){const lx=bx+bw*u,ly=by+bh*v,x=o.x+(lx-o.px)*o.s*(o.flip?-1:1),y=o.y+(ly-o.py)*o.s;if(pet.hitPet(x,y))return pet.toScreen(x,y)}return null})()`);
  const calm = () => E(`(()=>{pet.input('strokeEnd');const p=pet.pet;p.on=null;p.z=0;p.hidden=false;p.dim=false;p.glassK=0;p.x=900;p.y=850;p.mood.annoy=0;pet.startScene('calm',10);for(let i=0;i<20;i++)pet.update(1/30);return true})()`);
  const scene = () => E('pet.pet.scene&&pet.pet.scene.name');

  for (const [W, H] of [[640, 420], [900, 320], [380, 560], [1280, 760]]) {
    await b.resize(W, H); await sleep(300); await calm();
    const p = await body();
    if (!p) { ok(`${W}x${H} 고양이 위치 찾기`, false); continue; }
    await b.click(p[0], p[1]); await sleep(150);
    const sc1 = await scene();
    ok(`${W}x${H} 고양이 클릭 → 반응`, ['tapped', 'disturbed'].includes(sc1), `(${p.map(Math.round)}) → ${sc1}`);
    await calm(); const q = await body();
    await b.mouse('mouseMoved', q[0], q[1]); await b.mouse('mousePressed', q[0], q[1], 1);
    for (let i = 0; i < 24; i++) { await sleep(30); await b.mouse('mouseMoved', q[0] + Math.sin(i / 2) * 28, q[1] + 3, 1); }
    const st = await E(`({sc:pet.pet.scene.name, stroke:pet.stroke.active})`);
    await b.mouse('mouseReleased', q[0], q[1], 0); await sleep(100);
    ok(`${W}x${H} 문지르기 → 쓰다듬기`, st.sc === 'petting' && st.stroke, JSON.stringify(st));
    ok(`${W}x${H} 손 떼면 쓰다듬기 끝`, !(await E('pet.stroke.active')));
    await b.shot(path.join(out, `input_${W}x${H}.png`));
  }
  // 들어 올려 오른쪽 끝·위쪽 끝까지 끌기 → 창 안에 있어야 함 → 높이서 놓으면 데굴
  await b.resize(640, 420); await sleep(300); await calm();
  const p = await body();
  await b.mouse('mouseMoved', p[0], p[1]); await b.mouse('mousePressed', p[0], p[1], 1);
  for (let i = 1; i <= 30; i++) { await sleep(20); await b.mouse('mouseMoved', p[0] + (700 - p[0]) * i / 30, p[1] - (p[1] + 40) * i / 30, 1); }
  await sleep(200);
  const held = await E(`(()=>{const o=pet.pose(),fr=o.fr,[bx,by,bw,bh]=fr.bbox,sx=o.s*o.sx,sy=o.s*o.sy;let x0=(bx-o.px)*sx,x1=(bx+bw-o.px)*sx;if(o.flip)[x0,x1]=[-x1,-x0];return {sc:pet.pet.scene.name,a:pet.pet.anim.id,x0:o.x+x0,x1:o.x+x1,y0:o.y+(by-o.py)*sy,view:pet.view}})()`);
  await b.shot(path.join(out, 'input_held_edge.png'));
  ok('들기(위로 끌기) → held', held.sc === 'held', held.a);
  ok('들고 창 밖으로 끌어도 고양이는 창 안', held.x1 <= held.view.right + 2 && held.y0 >= held.view.top - 2, `x ${held.x0 | 0}~${held.x1 | 0} / view ${held.view.right | 0}, top ${held.y0 | 0}`);
  await b.mouse('mouseReleased', 700, 0, 0);
  const seenA = new Set(); for (let i = 0; i < 40; i++) { await sleep(60); seenA.add(await E('pet.pet.anim.id')); }
  ok('높이서 놓으면 떨어져 데굴 → 일어남', seenA.has('tumble_recover'), [...seenA].join(','));
  // 꾹 누르기(0.35초)로 들기
  await calm(); const lp = await body();
  await b.mouse('mouseMoved', lp[0], lp[1]); await b.mouse('mousePressed', lp[0], lp[1], 1); await sleep(600);
  ok('꾹 누르기 → 들기', (await scene()) === 'held', await scene());
  await b.mouse('mouseReleased', lp[0], lp[1], 0);
  const seenB = new Set(); for (let i = 0; i < 25; i++) { await sleep(60); seenB.add(await E('pet.pet.anim.id')); }
  ok('제자리에서 놓으면 내려놓기', seenB.has('put_down') && !seenB.has('tumble_recover'), [...seenB].join(','));
  // 공 끌어서 던지기
  await calm();
  await E(`(()=>{pet.ball.x=500;pet.ball.y=880;pet.ball.vx=pet.ball.vy=pet.ball.vz=0;pet.ball.z=0;pet.pet.x=1100;for(let i=0;i<5;i++)pet.update(1/30)})()`);
  const bp = await E(`pet.toScreen(pet.ball.x, pet.ball.y - pet.ball.r)`);
  await b.drag([[bp[0], bp[1]], [bp[0] + 10, bp[1] - 10], [bp[0] + 40, bp[1] - 40], [bp[0] + 90, bp[1] - 90], [bp[0] + 150, bp[1] - 140]], 16);
  await sleep(60);
  const ball1 = await E(`({vx:pet.ball.vx, z:pet.ball.z, sc:pet.pet.scene.name})`);
  ok('공 끌어 던지기 → 날아감', Math.abs(ball1.vx) > 100 || ball1.z > 20, JSON.stringify(ball1));
  ok('던진 공 → 고양이 공놀이', ball1.sc === 'ball');
  await sleep(2500);
  const ball2 = await E(`({x:pet.ball.x,y:pet.ball.y,z:pet.ball.z,view:pet.view})`);
  ok('공이 창 안', ball2.x > ball2.view.left && ball2.x < ball2.view.right && ball2.y - ball2.z > ball2.view.top, JSON.stringify(ball2).slice(0, 90));
  // 빈 곳 클릭 → 물결 + 고양이가 알아챔
  await calm();
  const ep = await E(`pet.toScreen(250, 990)`);
  await b.click(ep[0], ep[1]); await sleep(120);
  const nsc = await scene();
  ok('빈 곳 클릭 → 유리 톡톡 물결·알아챔', (await E(`pet.fx.some(f=>f.name==='tap_ripple')`)) && nsc === 'noticed', nsc);
  // 메뉴: 마우스만 움직여선 안 뜨고, 오른쪽 위 버튼으로 연다
  await b.mouse('mouseMoved', 320, 200); await sleep(350);
  ok('마우스만 움직여선 메뉴 안 뜸', +(await E(`getComputedStyle(document.getElementById('bar')).opacity`)) < .1);
  const menu = async () => { const r = await E(`(()=>{const e=document.getElementById('menuBtn');const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); await b.mouse('mouseMoved', r[0], r[1]); await sleep(40); await b.click(r[0], r[1]); await sleep(200); };
  await menu();
  ok('메뉴 버튼 → 메뉴 열림', +(await E(`getComputedStyle(document.getElementById('bar')).opacity`)) > .9);
  await b.click(320, 240); await sleep(200);
  ok('빈 곳 누르면 메뉴 닫힘', +(await E(`getComputedStyle(document.getElementById('bar')).opacity`)) < .1);
  const btn = async label => { if (+(await E(`getComputedStyle(document.getElementById('bar')).opacity`)) < .9) await menu(); const r = await E(`(()=>{const e=[...document.querySelectorAll('#bar button')].find(x=>x.title.startsWith(${JSON.stringify(label)}));const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); await b.mouse('mouseMoved', r[0], r[1]); await sleep(50); await b.click(r[0], r[1]); await sleep(150); };
  await calm(); await btn('낚싯대'); ok('낚싯대 버튼 → 낚싯대 모드', await E('pet.teaser.on'));
  for (let i = 0; i < 20; i++) { await sleep(40); await b.mouse('mouseMoved', 200 + i * 15, 150 + Math.sin(i) * 40); }
  ok('낚싯대 → 고양이가 따라감', (await scene()) === 'teaser', await scene());
  await b.shot(path.join(out, 'input_teaser.png'));
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(100);
  ok('Esc → 낚싯대 내려놓기', !(await E('pet.teaser.on')));
  await btn('간식'); ok('간식 버튼 → 손에 간식', await E(`!!pet.treat&&pet.treat.state==='hand'`));
  await b.mouse('mouseMoved', 300, 260); await sleep(1500); await b.click(300, 260); await sleep(200);
  ok('간식 든 채 클릭 → 떨어뜨림', await E(`!!pet.treat&&pet.treat.state!=='hand'`));
  await btn('줄 장난감'); ok('줄 장난감 버튼 → 줄 나옴', await E('!!pet.rope'));
  await btn('줄 장난감'); ok('다시 누르면 치움', await E('!pet.rope'));
  await btn('낮·밤'); await sleep(200); const dm = await E(`document.querySelector('#bar button[data-mode]').dataset.mode`);
  ok('낮·밤 버튼 → 모드 바뀜', dm !== 'auto', dm);
  // 친구(둘이 모드) 버튼: 한 번 누르면 첫 동물이 들어온다 → 다시 끝까지 돌리면 없음
  await btn('친구'); await sleep(600);
  ok('친구 버튼 → 둘이 모드', await E('pet.pets.length') === 2, '마리 수 ' + await E('pet.pets.length'));
  ok('소리 울림 수 기록됨', await E('pet.sfxN') >= 0, 'sfxN=' + await E('pet.sfxN'));
  await b.shot(path.join(out, 'input_daymode.png'));
  // 친구가 있는 상태에서 각각 클릭·쓰다듬기
  await calm();
  const q2 = await E(`(()=>{const q=pet.pets[1];q.x=1100;q.y=850;q.on=null;q.z=0;pet.startScene('calm',10,undefined,q);for(let i=0;i<10;i++)pet.update(1/30);const o=pet.pose(q),fr=o.fr,[bx,by,bw,bh]=fr.bbox;const x=o.x,y=o.y+(by+bh*.55-o.py)*o.s;return pet.hitPet(x,y,q)?pet.toScreen(x,y):null})()`);
  if (q2) {
    await b.click(q2[0], q2[1]); await sleep(200);
    ok('친구 클릭 → 친구가 반응', ['tapped', 'disturbed'].includes(await E('pet.pets[1].scene.name')), await E('pet.pets[1].scene.name'));
  } else ok('친구 클릭 → 친구가 반응', false, '친구 위치 못 찾음');
  await btn('친구'); await btn('친구'); await btn('친구'); await btn('친구'); await btn('친구'); await sleep(300);
  ok('친구 버튼 끝까지 → 혼자 모드', await E('pet.pets.length') === 1, '마리 수 ' + await E('pet.pets.length'));
  ok('페이지 오류 없음', !b.logs.some(l => l.startsWith('EXC')) && !(await E('pet.errors.length')), b.logs.join(' | ').slice(0, 300));
  console.log(res.join('\n'));
  b.close();
})();
