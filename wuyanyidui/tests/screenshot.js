/* 截图工具：抓取各页面 PNG 以便人工视觉验收 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { spawn } = require('child_process');
const CDP_PORT = 9335;
const BROWSER = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}

const SHOTS = [
  { key: 'workbench', name: '01-工作台', prep: async (ev) => {
      await ev('var b=document.getElementById("btnLoadPreset"); if(b) b.click();');
      await sleep(700);
      await ev('App.runPipeline({})', true);
      await sleep(600);
      await ev('App.go("workbench")');
      await sleep(600);
    } },
  { key: 'risk', name: '02-风险信号识别', prep: async (ev) => { await ev('App.go("risk")'); await sleep(900); } },
  { key: 'clue', name: '03-线索台账', prep: async (ev) => { await ev('App.go("clue")'); await sleep(800); } },
  { key: 'linkage', name: '04-关联方核查', prep: async (ev) => { await ev('App.go("linkage")'); await sleep(800); } },
  { key: 'aggregate', name: '05-数据汇总', prep: async (ev) => { await ev('App.go("aggregate")'); await sleep(800); } },
  { key: 'score', name: '06-评分评估', prep: async (ev) => { await ev('App.go("score")'); await sleep(800); } },
  { key: 'report', name: '07-报告草稿', prep: async (ev) => {
      await ev('App.go("report")'); await sleep(500);
      await ev('document.getElementById("btnGenReport").click()');
      await sleep(1200);
    } },
  { key: 'examples', name: '08-测试示例', prep: async (ev) => {
      await ev('App.go("examples")'); await sleep(500);
      await ev('document.getElementById("btnRunCasesOnly").click()');
      await sleep(1500);
    } },
  { key: 'settings', name: '09-设置', prep: async (ev) => { await ev('App.go("settings")'); await sleep(700); } },
  { key: 'modal', name: '10-大模型API设置弹窗', prep: async (ev) => {
      await ev('App.go("workbench")'); await sleep(500);
      await ev('document.getElementById("btnApiSettings").click()');
      await sleep(900);
    } }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = path.join(os.tmpdir(), 'fraud-shot-' + Date.now());
  const proc = spawn(BROWSER, ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + dir,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0; const pending = new Map();
  try {
    let ver;
    for (let i = 0; i < 60; i++) { try { ver = await httpJSON('http://127.0.0.1:' + CDP_PORT + '/json/version'); break; } catch (e) { await sleep(250); } }
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    });
    const send = (method, params, sid) => new Promise((res, rej) => {
      const i = ++id; pending.set(i, { resolve: res, reject: rej });
      const p = { id: i, method, params: params || {} }; if (sid) p.sessionId = sid;
      ws.send(JSON.stringify(p));
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('timeout ' + method)); } }, 40000);
    });
    const t = await send('Target.createTarget', { url: 'about:blank' });
    const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    const sid = a.sessionId;
    const ev = async (expr, ap) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!ap, userGesture: true }, sid);
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
      return r.result.value;
    };

    /* 视口设为 1440×900（需求最低 1280×720） */
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sid);
    await send('Page.navigate', { url: 'http://127.0.0.1:5178/web/index.html' }, sid);
    await sleep(2600);

    for (const s of SHOTS) {
      try {
        await s.prep(ev);
        const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sid);
        const file = path.join(OUT, s.name + '.png');
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log('✓ ' + s.name + '.png');
      } catch (e) {
        console.log('✗ ' + s.name + ' — ' + e.message);
      }
    }
    /* 整页长截图（风险信号页） */
    try {
      await ev('App.go("risk")'); await sleep(900);
      const metrics = await send('Page.getLayoutMetrics', {}, sid);
      const h = Math.min(6000, Math.ceil(metrics.cssContentSize.height));
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: h, deviceScaleFactor: 1, mobile: false }, sid);
      await sleep(500);
      const full = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
      fs.writeFileSync(path.join(OUT, '11-风险信号识别-整页.png'), Buffer.from(full.data, 'base64'));
      console.log('✓ 11-风险信号识别-整页.png (' + h + 'px)');
    } catch (e) { console.log('✗ 整页截图 — ' + e.message); }
  } catch (e) {
    console.log('截图失败：', e.message);
  } finally {
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }
})();
