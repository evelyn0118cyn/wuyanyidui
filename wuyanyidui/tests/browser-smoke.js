/* =============================================================
 * 浏览器端冒烟测试（通过 Chrome DevTools Protocol 驱动本机 Edge/Chrome）
 *  校验：所有页面无 JS 异常、关键 DOM 渲染、一键流水线、报告生成与导出
 * 用法：node tests/browser-smoke.js  （需本地服务已在 5178 运行）
 * ============================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.FRAUD111_PORT || 5178);
const APP_URL = process.env.FRAUD111_OFFLINE === "1" ? "file:///" + path.resolve(__dirname, "..", "web", "index.html").replace(/\\/g, "/") : "http://127.0.0.1:" + PORT + "/web/index.html";
const CDP_PORT = 9333;

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];

function findBrowser() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

function httpJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForCDP() {
  for (let i = 0; i < 60; i++) {
    try { return await httpJSON('http://127.0.0.1:' + CDP_PORT + '/json/version'); }
    catch (e) { await sleep(250); }
  }
  throw new Error('浏览器 CDP 未就绪');
}

/* 极简 CDP 客户端（支持 flattened session） */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }
      }, 30000);
    });
  }
}

async function connect() {
  const ver = await waitForCDP();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return new CDP(ws);
}

(async () => {
  const browserPath = findBrowser();
  if (!browserPath) { console.log('SKIP: 未找到 Edge/Chrome'); process.exit(0); }

  const userDataDir = path.join(os.tmpdir(), 'fraud111-smoke-' + Date.now());
  console.log('启动浏览器：' + browserPath);
  const proc = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + userDataDir,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp, failures = [], pageErrors = [], passes = 0;

  try {
    cdp = await connect();

    /* 收集页面异常（Runtime/Log 在 session 上开启后，事件会带 sessionId） */
    cdp.ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.method === 'Runtime.exceptionThrown') {
        pageErrors.push(m.params.exceptionDetails.text + ' ' +
          ((m.params.exceptionDetails.exception || {}).description || ''));
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        const t = m.params.entry.text || '';
        if (!/favicon|SheetJS|net::ERR|Failed to load resource|ERR_/i.test(t)) pageErrors.push('console: ' + t);
      }
    });

    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attach = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attach.sessionId;

    const ssend = (method, params) => cdp.send(method, params, sessionId);
    const seval = async (expr, awaitPromise) => {
      const r = await ssend('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise, userGesture: true });
      if (r.exceptionDetails) throw new Error('页面异常: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
      return r.result.value;
    };

    await ssend('Runtime.enable');
    await ssend('Page.enable');
    await ssend('Log.enable');

    function check(name, cond, detail) {
      if (cond) { passes++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
      else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  ' + detail : '')); }
    }

    console.log('\n[1] 加载页面 ' + APP_URL);
    await ssend('Page.navigate', { url: APP_URL });
    await sleep(2500);
    const title = await seval('document.title');
    check('页面标题正确', /财务舞弊111/.test(title), title);
    check('左侧导航 9 项', await seval('document.querySelectorAll(".nav-item").length') === 9);
    check('顶部大模型API设置按钮存在', await seval('!!document.getElementById("btnApiSettings")'));
    check('工作台已渲染', await seval('!!document.getElementById("btnPipeline")'));

    console.log('\n[2] 一键全流程分析');
    await seval('document.getElementById("btnLoadPreset").click()');
    await sleep(600);
    check('预置数据已加载', await seval('!!(App.state.dataset && App.state.dataset.data.bank_transactions.length)'),
      '流水 ' + (await seval('App.state.dataset ? App.state.dataset.data.bank_transactions.length : 0')) + ' 笔');

    await seval('App.runPipeline({})', true);
    await sleep(500);
    const pipe = await seval(`JSON.stringify({
      sig: App.state.riskAlert && App.state.riskAlert.totals.signalCount,
      high: App.state.riskAlert && App.state.riskAlert.totals.byLevel.high,
      clues: App.state.clueSort && App.state.clueSort.totals.clueCount,
      susp: App.state.linkage && App.state.linkage.totals.suspectCount,
      rows: App.state.aggregation && App.state.aggregation.rows.length,
      bal: App.state.aggregation && App.state.aggregation.balance.balanced,
      score: App.state.scorecard && App.state.scorecard.overall
    })`);
    const P = JSON.parse(pipe);
    console.log('    结果：' + pipe);
    check('风险信号已生成', P.sig > 0, P.sig + ' 条（参考高 ' + P.high + '）');
    check('线索台账已生成', P.clues > 0, P.clues + ' 条');
    check('关联方核查已生成', P.susp > 0, P.susp + ' 个');
    check('全科目汇总已生成', P.rows > 0, P.rows + ' 个科目，借贷' + (P.bal ? '平衡' : '不平'));
    check('评分已生成', P.score >= 0 && P.score <= 100, P.score + ' 分');

    console.log('\n[3] 逐页渲染检查');
    const pages = [
      ['workbench', 'btnPipeline', '工作台'],
      ['risk', 'btnRun', '风险信号识别'],
      ['clue', 'btnRunClue', '线索台账'],
      ['linkage', 'btnRunLink', '关联方核查'],
      ['aggregate', 'btnAgg', '数据汇总'],
      ['score', 'btnRunScore', '评分评估'],
      ['report', 'btnGenReport', '报告草稿'],
      ['examples', 'btnRunAll', '测试示例'],
      ['settings', 'swMem2', '设置']
    ];
    for (const [key, sel, name] of pages) {
      await seval('App.go("' + key + '")');
      await sleep(500);
      const ok = await seval('!!document.getElementById("' + sel + '")');
      const div = await seval('!!document.querySelector(".division-bar")');
      check(name + ' 页渲染（含分工提示条）', ok && div);
    }

    console.log('\n[4] 各页结果渲染');
    await seval('App.go("risk")'); await sleep(400);
    check('风险信号表格已渲染', await seval('!!document.querySelector("#sigTable table.grid")'));
    check('信号表行数 > 0', await seval('document.querySelectorAll("#sigTable tbody tr[data-row]").length') > 0);
    /* 需求：信号分布（散点）、箱线图为 SVG；柱状图为 CSS 条形 */
    check('散点图与箱线图已渲染(SVG)',
      await seval('document.querySelectorAll("svg circle, svg rect, svg polygon").length') > 5,
      await seval('String(document.querySelectorAll("svg").length)') + ' 个 SVG');
    check('规则柱状图已渲染', (await seval('document.querySelectorAll(".chart-box > div").length')) > 5);
    check('图表右上角标注数据口径与生成时间',
      await seval('Array.prototype.some.call(document.querySelectorAll(".chart-meta"), function(e){return /数据口径/.test(e.innerText) && /生成时间/.test(e.innerText);})'));

    await seval('App.go("clue")'); await sleep(400);
    check('线索台账表格已渲染', await seval('!!document.querySelector("#clueTable table.grid")'));
    await seval('App.go("linkage")'); await sleep(400);
    check('关联方清单已渲染', await seval('!!document.querySelector("#linkTable table.grid")'));
    await seval('App.go("aggregate")'); await sleep(500);
    check('全科目汇总表已渲染', await seval('!!document.querySelector("#aggTable table.grid")'));
    await seval('App.go("score")'); await sleep(400);
    check('评分明细已渲染', await seval('!!document.querySelector("#scoreTable table.grid")'));
    check('参考区间结论文案含"需人工复核后定级"',
      await seval('/需人工复核后定级/.test(document.querySelector(".band-strip") ? document.querySelector(".band-strip").innerText : "")'));

    console.log('\n[5] 报告生成与导出');
    await seval('App.go("report")'); await sleep(400);
    await seval('document.getElementById("btnGenReport").click()');
    await sleep(900);
    const repInfo = await seval(`(function(){
      if(!App.state.report) return "NO_REPORT";
      var html = App.report.toHTML(App.state.report);
      var md = App.report.toMarkdown(App.state.report);
      return JSON.stringify({
        no: App.state.report.reportNo,
        findings: App.state.report.sections.s3.findings.length,
        htmlLen: html.length, mdLen: md.length,
        disclaimer: html.indexOf("不替代调查结论")>=0,
        conclusionBlank: html.indexOf("由调查人员填写")>=0,
        sections: ["一、调查背景与范围","二、分析方法","三、主要发现","四、线索台账摘要","五、关联方核查摘要","六、舞弊可能性参考评估","七、证据缺口与待核实事项清单","八、进一步核查建议","九、数据质量与局限性说明","十、声明"].every(function(t){return html.indexOf(t)>=0;}),
        safe: App.util.assertSafeText(html).ok
      });
    })()`);
    const R = repInfo === 'NO_REPORT' ? null : JSON.parse(repInfo);
    check('报告已生成', !!R, R ? R.no + '，发现 ' + R.findings + ' 条' : '未生成');
    if (R) {
      check('十节结构齐全', R.sections);
      check('强制声明存在', R.disclaimer);
      check('结论段留空', R.conclusionBlank);
      check('越界表述检查通过', R.safe);
      check('HTML/Markdown 可导出', R.htmlLen > 8000 && R.mdLen > 3000, 'HTML ' + R.htmlLen + ' / MD ' + R.mdLen);
    }

    console.log('\n[6] 内置测试示例');
    await seval('App.go("examples")'); await sleep(400);
    await seval('document.getElementById("btnRunCasesOnly").click()');
    await sleep(1200);
    const caseRes = await seval(`JSON.stringify((App.state.lastCaseResults||[]).map(function(r){return {id:r.id, ok:r.ok};}))`);
    const CR = JSON.parse(caseRes || '[]');
    const cp = CR.filter((x) => x.ok).length;
    check('测试示例全部通过', CR.length === 10 && cp === 10,
      cp + '/' + CR.length + ' 通过' + (cp < CR.length ? '（失败：' + CR.filter((x) => !x.ok).map((x) => x.id).join(',') + '）' : ''));

    console.log('\n[7] 大模型链路（经本地代理）');
    const srv = await seval('App.llm.status()', true);
    check('本地代理已连接', !!(srv && srv.online), srv && srv.online ? srv.base : '未连接');
    if (srv && srv.online && srv.llmConfigured) {
      const llmRes = await seval(`App.llm.chat({prompt:"用一句话说明你可以辅助舞弊审计人员做什么。", useRag:false, maxTokens:3000}).then(function(r){return JSON.stringify({mode:r.mode, len:(r.text||"").length, sample:(r.text||"").slice(0,60), guard:r.guardrails.ok});})`, true);
      const L = JSON.parse(llmRes);
      check('大模型调用成功', L.mode === 'llm' && L.len > 5, L.mode + ' / ' + L.len + ' 字：' + L.sample);
      check('模型输出通过合规检查', L.guard);
    } else {
      console.log('  - 跳过（未配置 Key）');
    }

    console.log('\n[8] 页面异常检查');
    check('运行期间无未捕获 JS 异常', pageErrors.length === 0,
      pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '0 个');

    console.log('\n============================================');
    if (failures.length === 0) {
      console.log('浏览器冒烟测试全部通过：' + passes + ' 项');
    } else {
      console.log('通过 ' + passes + ' 项，失败 ' + failures.length + ' 项：');
      failures.forEach((f) => console.log('  ✗ ' + f));
    }
    console.log('============================================');
    process.exitCode = failures.length ? 1 : 0;

  } catch (e) {
    console.error('测试执行失败：', e.message);
    process.exitCode = 1;
  } finally {
    try { proc.kill(); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(process.exitCode || 0);
  }
})();
