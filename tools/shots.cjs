// 상황별 게임 화면 찍기(헤드리스 크롬). 장면을 강제로 시작하고 조건까지 빨리 감은 뒤 찍는다.
//   node tools/shots.cjs [폭=640] [높이=420] [이름 거르기]
// 결과: %TEMP%/minipet_shots/<이름>.png
'use strict';
const { launch, sleep } = require('./cdp.cjs');
const path = require('path'), fs = require('fs');
const out = path.join(process.env.TEMP || '/tmp', 'minipet_shots'); fs.mkdirSync(out, { recursive: true });
const URL = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const W = +(process.argv[2] || 640), H = +(process.argv[3] || 420), only = process.argv[4];
// 빨리 감기: 조건이 참이 될 때까지 sim 을 돌린다(최대 sec 초)
const ff = (cond, sec = 120) => `(()=>{for(let i=0;i<${sec}*30;i++){if(${cond})return true;pet.update(1/30)}return false})()`;
const PIN = `(()=>{const f=()=>.01;f.range=(a,b)=>(a+b)/2;f.int=a=>a;f.chance=()=>true;f.pick=a=>a[0];return f})()`;
const CASES = [
  ['calm', `pet.startScene('calm',10)`, `true`],
  // 낮잠 장면은 잠자리를 무작위로 고르므로, 난수를 고정해 첫 잠자리(침대)를 고르게 한다
  ['bed_sleep', `pet.placeToy('plush',false);pet.pet.needs.energy=.1;pet.R=${PIN};pet.startScene('nap',10)`, `pet.pet.asleep&&pet.pet.on&&pet.pet.on.id==='bed'`],
  ['bed_sit', `pet.placeToy('plush',false);pet.pet.needs.energy=.1;pet.R=${PIN};pet.startScene('nap',10)`, `pet.pet.on&&pet.pet.on.id==='bed'&&pet.pet.anim.id==='yawn'`],
  ['box_in', `pet.startScene('box',10)`, `pet.pet.on&&pet.pet.on.id==='box'&&pet.pet.anim.id==='box_enter'&&pet.pet.anim.i===1`],
  ['box_peek', `pet.startScene('box',10)`, `pet.pet.anim.id==='peek'&&pet.pet.anim.list[pet.pet.anim.i]===3`],
  ['tunnel_enter', `pet.startScene('tunnel',10)`, `pet.pet.on&&pet.pet.on.id==='tunnel'&&(pet.furn.tunnel.kind==='cave'?pet.pet.anim.id==='lie_down':pet.pet.x<pet.furn.tunnel.hole.x+40)&&!pet.pet.hidden`],
  ['tunnel_peek', `pet.startScene('tunnel',10)`, `pet.pet.anim.id==='peek'&&pet.pet.anim.list[pet.pet.anim.i]===3`],
  ['glass_hold', `pet.startScene('glass',10)`, `pet.pet.anim.id==='glass_hold'&&pet.pet.anim.i===2`],
  ['glass_slide', `pet.startScene('glass',10)`, `pet.pet.anim.id==='glass_slide'&&pet.pet.anim.i===4`],
  ['ball_push', `pet.ball.x=pet.pet.x+300;pet.ball.y=pet.pet.y;pet.startScene('ball',50)`, `pet.pet.anim.id==='ball_push'&&pet.pet.anim.list[pet.pet.anim.i]===2`],
  ['ball_hug', `pet.ball.x=pet.pet.x+300;pet.ball.y=pet.pet.y;pet.startScene('ball',50)`, `pet.ball.heldBy===pet.pet&&pet.pet.anim.list[pet.pet.anim.i]===4`],
  ['plush_bite', `if(!pet.plush)pet.placeToy('plush',true,true);pet.plush.x=pet.pet.x+300;pet.plush.y=pet.pet.y;pet.startScene('plush',40)`, `pet.pet.anim.id==='toy_bite'&&pet.pet.anim.list[pet.pet.anim.i]===2`],
  ['toy_nap', `if(!pet.plush)pet.placeToy('plush',true,true);pet.plush.x=pet.pet.x+300;pet.plush.y=pet.pet.y;pet.startScene('plush',40,true)`, `pet.pet.anim.id==='toy_nap'&&pet.pet.anim.list[pet.pet.anim.i]===5`],
  ['rope_tug', `pet.placeToy('rope',true,true);pet.rope.x=pet.pet.x+330;pet.rope.y=pet.pet.y;pet.startScene('rope',40)`, `pet.pet.anim.id==='tug'&&pet.pet.anim.i===2`],
  ['eat_bowl', `pet.startScene('eat',10)`, `pet.pet.anim.id==='eat'&&pet.pet.anim.i===2`],
  ['treat_beg', `pet.input('pointer',{x:pet.pet.x+40,y:520});pet.input('treat',{on:true})`, `pet.pet.anim.id==='beg_treat'`],
  ['teaser', `pet.input('teaser',{on:true});pet.input('pointer',{x:pet.pet.x+120,y:pet.pet.y-260})`, `pet.pet.anim.id==='teaser_follow'`],
  ['tapwin', `pet.startScene('tapwin',10)`, `pet.pet.anim.id==='tap_window'&&pet.pet.anim.i===3`],
  ['zoomies', `pet.startScene('zoomies',10)`, `pet.pet.anim.id==='zoomies'&&pet.pet.anim.i===2`],
  ['attention', `pet.startScene('attention',10)`, `pet.pet.anim.id==='ask_play'`],
];
(async () => {
  const b = await launch(W, H);
  for (const [name, setup, cond] of CASES) {
    if (only && !name.includes(only)) continue;
    await b.open(URL + '?shot', 1800);
    await b.eval(`localStorage.setItem('miniPet.v1', JSON.stringify({hint:1,lastSeen:Date.now()}))`);
    await b.open(URL + '?shot', 1800);
    await b.eval(setup);
    const ok = await b.eval(ff(cond));
    await sleep(120);
    await b.shot(path.join(out, name + '.png'));
    const st = await b.eval(`JSON.stringify({sc:pet.pet.scene&&pet.pet.scene.name,a:pet.pet.anim.id,f:pet.pet.anim.list[pet.pet.anim.i],on:pet.pet.on&&(pet.pet.on.id||pet.pet.on),err:pet.errors.length})`);
    console.log(`${ok ? 'OK' : '--'} ${name} ${st}`);
  }
  if (b.logs.length) console.log(b.logs.join('\n'));
  b.close();
})();
