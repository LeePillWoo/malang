// 실제 앱 창(Chrome --app, 별도 프로필)을 띄워 가만히 둘 때 CPU 사용량을 프로세스 종류별로 잰다. 끝나면 창을 닫는다.
//   node tools/cpu_check.cjs [측정 초=90] [폭=560] [높이=380] [먼저 기다릴 초=60]
// 새 프로필 Chrome 은 처음 1분쯤 브라우저 프로세스가 혼자 바쁘다(빈 페이지도 7% 안팎) — 그래서 먼저 기다린다.
'use strict';
const { spawn, execFileSync } = require('child_process'), http = require('http'), path = require('path'), os = require('os');
const [sec, W, H, settle] = [90, 560, 380, 60].map((d, i) => +(process.argv[2 + i] || d));
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe', TAG = 'minipet_cpu_profile';
const prof = path.join(os.tmpdir(), TAG), port = 9555;
const URL = 'file:///' + path.join(__dirname, '..', 'index.html').split(path.sep).join('/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = p => new Promise((ok, no) => http.get({ host: '127.0.0.1', port, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => ok(JSON.parse(d))); }).on('error', no));
function snap() {   // 프로세스 종류 → 누적 CPU 초
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ?{ $_.CommandLine -like '*${TAG}*' } | %{ $g=Get-Process -Id $_.ProcessId -EA SilentlyContinue; $t=if($_.CommandLine -match '--type=([a-z-]+)'){$matches[1]}else{'browser'}; if($g){"$t;$($g.TotalProcessorTime.TotalSeconds)"} }`;
  const m = {}; for (const l of execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().trim().split(/\r?\n/)) { const [t, s] = l.split(';'); m[t] = (m[t] || 0) + +s; } return m;
}
(async () => {
  spawn(EXE, [`--app=${URL}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`, '--window-position=40,40', '--no-first-run', '--no-default-browser-check', ...(process.env.LEAN === '0' ? [] : ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps']), `--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' }).unref();
  let tabs; for (let i = 0; i < 60; i++) { try { tabs = await get('/json'); break; } catch { await sleep(250); } }
  await sleep(settle * 1000);
  tabs = await get('/json');
  const page = tabs.find(t => t.type === 'page' && t.url.includes('mini_pet_game'));
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; ws.onmessage = m => { const d = JSON.parse(m.data); if (pend[d.id]) pend[d.id](d); };
  const ev = expr => new Promise(ok => { pend[++id] = d => ok(d.result && d.result.result && d.result.result.value); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
  console.log('열린 페이지:', tabs.filter(t => t.type === 'page').length, '개 / 창 안쪽', await ev('innerWidth+"x"+innerHeight'));
  const r0 = await ev('pet.renders'), a = snap(), t0 = Date.now();
  await sleep(sec * 1000);
  const b = snap(), dt = (Date.now() - t0) / 1000, frames = (await ev('pet.renders')) - r0;
  const part = Object.keys(b).map(k => [k, (b[k] - (a[k] || 0)) / dt * 100]);
  const tot = part.reduce((s, [, v]) => s + v, 0);
  console.log(`CPU 합계 ${tot.toFixed(1)}% (코어 1개 기준, ${dt.toFixed(0)}초) — ` + part.map(([k, v]) => `${k} ${v.toFixed(1)}%`).join(', '));
  console.log(`전체 코어 기준 ${(tot / os.cpus().length).toFixed(2)}% (논리 코어 ${os.cpus().length}개) · 게임 그리기 초당 ${(frames / dt).toFixed(1)}번`);
  console.log('그동안 장면:', await ev(`JSON.stringify(pet.log.slice(-10).map(x=>x[1]))`));
  ws.send(JSON.stringify({ id: ++id, method: 'Browser.close' }));
  await sleep(1500); process.exit(0);
})();
