// 효과음: WebAudio 로 합성하는 짧은 동물 소리(녹음 파일 없음 — 외부 리소스 없이 끝).
// 인터랙션 때만 울린다(연결은 view.js 가 w.sfx 로). 소리 종류(kind):
//   react 짧은 대답 · happy 기분 좋음(두 음 올라감) · giggle 간지럼(트릴) · startle 놀람(빠르게 위로)
//   annoy 싫음(내려가는 소리) · grumble 부스스(낮게 웅얼) · eat 냠냠(둔탁한 똑딱)
(function (g) {
'use strict';
let ctx = null, master = null, lastAll = 0, napT = 0;
const lastPer = new Map();   // 동물별 마지막 발성(겹침 방지)
const ensure = () => {
  if (!ctx) {
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = .5; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

// 동물 목소리: 기본 음높이(f), 파형, 비브라토(빠르기/깊이), 필터, 길이 배율
const VOICE = {
  cat: { f: 540, w: 'sawtooth', vibF: 7, vibD: .04, lp: 1600, len: 1 },
  dog: { f: 190, w: 'square', vibF: 0, vibD: 0, lp: 900, len: .8 },
  chick: { f: 1350, w: 'triangle', vibF: 16, vibD: .09, lp: 4200, len: .65 },
  bear: { f: 120, w: 'sawtooth', vibF: 4, vibD: .05, lp: 520, len: 1.25 },
  rabbit: { f: 920, w: 'triangle', vibF: 10, vibD: .05, lp: 2600, len: .7 },
};
const DEF = VOICE.cat;

// 한 음: t0 에 시작해 dur 동안, 음높이 f0→f1 로 미끄러지며 vol 로 울린다
function tone(v, t0, dur, f0, f1, vol, bend = .5) {
  const o = ctx.createOscillator(), ga = ctx.createGain(), lp = ctx.createBiquadFilter();
  o.type = v.w; lp.type = 'lowpass'; lp.frequency.value = v.lp; lp.Q.value = 1.1;
  o.frequency.setValueAtTime(Math.max(40, f0), t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur * bend);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
  if (v.vibF) { const vo = ctx.createOscillator(), vg = ctx.createGain(); vo.frequency.value = v.vibF; vg.gain.value = v.f * v.vibD; vo.connect(vg); vg.connect(o.frequency); vo.start(t0); vo.stop(t0 + dur); }
  ga.gain.setValueAtTime(0, t0);
  ga.gain.linearRampToValueAtTime(vol, t0 + Math.min(.03, dur * .25));
  ga.gain.setTargetAtTime(0, t0 + dur * .72, dur * .14);
  o.connect(lp); lp.connect(ga); ga.connect(master);
  o.start(t0); o.stop(t0 + dur + .1);
}
// 둔탁한 똑딱(냠냠): 필터 통과한 노이즈 짧게
function thud(t0, vol, f = 420) {
  const n = ctx.createBufferSource(), buf = ctx.createBuffer(1, ctx.sampleRate * .07, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 2.5;
  const ga = ctx.createGain(); ga.gain.value = vol;
  n.connect(bp); bp.connect(ga); ga.connect(master); n.start(t0);
}

// kind 별 짧은 악보. j = 동물별 무작위 흔들림(같은 소리 반복 느낌 줄이기)
const KINDS = {
  react(v, t, j) { tone(v, t, .16 * v.len, v.f * .8 * j, v.f * 1.25 * j, .16, .7); },
  happy(v, t, j) { tone(v, t, .13 * v.len, v.f * .9 * j, v.f * 1.2 * j, .15, .8); tone(v, t + .14 * v.len, .18 * v.len, v.f * 1.1 * j, v.f * 1.5 * j, .15, .8); },
  giggle(v, t, j) { for (let i = 0; i < 4; i++) tone(v, t + i * .07 * v.len, .06 * v.len, v.f * (1.2 + (i % 2) * .25) * j, v.f * (1.35 + (i % 2) * .25) * j, .11, .5); },
  startle(v, t, j) { tone(v, t, .12 * v.len, v.f * .7 * j, v.f * 1.8 * j, .17, .85); },
  annoy(v, t, j) { tone(v, t, .3 * v.len, v.f * 1.15 * j, v.f * .55 * j, .16, .45); },
  grumble(v, t, j) { tone(v, t, .26 * v.len, v.f * .6 * j, v.f * .5 * j, .13, .3); tone(v, t + .22 * v.len, .14 * v.len, v.f * .55 * j, v.f * .62 * j, .09, .5); },
  eat(v, t) { thud(t, .5, 380); thud(t + .09, .4, 330); },
};

// play(동물 id, kind). 너무 잦은 호출은 거른다(전체 0.12초, 같은 동물 0.4초).
g.MP_AUDIO = {
  play(animal, kind) {
    if (!KINDS[kind] || !ensure()) return;
    const now = ctx.currentTime;
    if (now - lastAll < .12 || now - (lastPer.get(animal) || -9) < .4) return;
    lastAll = now; lastPer.set(animal, now);
    clearTimeout(napT); napT = setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend(); }, 15000);
    const v = VOICE[animal] || DEF, j = .92 + Math.random() * .16;
    try { KINDS[kind](v, now + .01, j); } catch (e) { /* 소리 실패는 게임에 영향 없음 */ }
  },
  unlock() { ensure(); },   // 첫 사용자 입력에서 호출(브라우저 자동재생 제한 해제)
};
})(typeof window !== 'undefined' ? window : globalThis);
