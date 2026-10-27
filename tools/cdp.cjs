// 헤드리스 크롬을 CDP 로 조종하는 작은 도구(노드 24 내장 WebSocket, 추가 모듈 없음).
//   const b = await require('./cdp.cjs').launch(640, 420); await b.open(url); await b.eval('1+1'); await b.shot('a.png'); b.close();
// 명령줄: node tools/cdp.cjs <url> <폭> <높이> <대기ms> <저장.png> [식]
'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function launch(w, h, extra = []) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const dir = path.join(os.tmpdir(), 'minipet_cdp', String(port));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--window-size=${w},${h}`, '--hide-scrollbars', '--no-first-run', '--mute-audio', `--user-data-dir=${dir}`, ...extra, 'about:blank']);
  const get = p => new Promise((ok, no) => http.get({ host: '127.0.0.1', port, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => ok(JSON.parse(d))); }).on('error', no));
  let tabs; for (let i = 0; i < 60; i++) { try { tabs = await get('/json'); break; } catch { await sleep(150); } }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pend = {}; const logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 800));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 400));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text.slice(0, 300));
  };
  await new Promise(r => ws.onopen = r);
  const send = (method, params = {}) => new Promise(ok => { pend[++id] = ok; ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const b = {
    logs, send, w, h,
    async resize(W, H, dsf = 1) { b.w = W; b.h = H; await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dsf, mobile: false }); },
    async open(url, wait = 1500) { await send('Page.navigate', { url }); await sleep(wait); },
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; },
    async shot(file, clip) { const r = await send('Page.captureScreenshot', clip ? { format: 'png', clip: Object.assign({ scale: 1 }, clip) } : { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    async mouse(type, x, y, buttons = 0) { await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' }); },
    async drag(pts, stepMs = 16) { await b.mouse('mouseMoved', pts[0][0], pts[0][1]); await b.mouse('mousePressed', pts[0][0], pts[0][1], 1); for (const [x, y] of pts.slice(1)) { await sleep(stepMs); await b.mouse('mouseMoved', x, y, 1); } const [x, y] = pts[pts.length - 1]; await b.mouse('mouseReleased', x, y, 0); },
    async click(x, y) { await b.mouse('mouseMoved', x, y); await b.mouse('mousePressed', x, y, 1); await sleep(40); await b.mouse('mouseReleased', x, y, 0); },
    close() { try { ws.close(); } catch {} proc.kill(); },
  };
  await b.resize(w, h);
  return b;
}
module.exports = { launch, sleep };
if (require.main === module) (async () => {
  const [url, w, h, wait, out, expr] = process.argv.slice(2);
  const b = await launch(+w, +h); await b.open(url, +wait);
  if (expr) console.log(JSON.stringify(await b.eval(expr)));
  await b.shot(out); console.log(b.logs.join('\n')); b.close();
})();
