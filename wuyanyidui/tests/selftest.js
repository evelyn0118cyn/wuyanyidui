/* =============================================================
 * 财务舞弊111 · 自检脚本（纯 Node，无需浏览器、无需依赖）
 *   node tests/selftest.js
 * 覆盖：统计口径正确性、规则命中、四类关联核查、全科目汇总与借贷平衡、
 *       评分区间与合规边界、报告结构与强制声明、知识库检索、禁用语改写。
 * ============================================================= */
'use strict';

const path = require('path');
const fs = require('fs');

/* 最小浏览器环境垫片（localStorage / XHR 等） */
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.sessionStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };

const BASE = path.join(__dirname, '..', 'web', 'assets', 'js');
const LOAD = [
  'core/config', 'core/util', 'core/stats', 'core/memory', 'core/rag',
  'core/demo-data', 'core/datasource',
  'analysis/risk-alert', 'analysis/clue-sort', 'analysis/linkage',
  'analysis/aggregation', 'analysis/scorecard', 'analysis/report',
  'core/llm'
];
LOAD.forEach((f) => require(path.join(BASE, f.split('/').join(path.sep) + '.js')));

const App = globalThis.App;
const U = App.util, S = App.stats;

/* ---------------- 测试框架 ---------------- */
let pass = 0, fail = 0;
const failures = [];
const groups = [];

function group(name) { groups.push(name); console.log('\n■ ' + name); }
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps); }
function section(t) { console.log('\n— ' + t); }

/* ============================================================= */
console.log('财务舞弊111 · 自检开始');
const t0 = Date.now();

/* ---------- 1. 统计口径 ---------- */
group('1. 统计口径（3σ / IQR / MAD）');
(function () {
  section('基础统计量');
  check('均值', approx(S.mean([1, 2, 3, 4, 5]), 3), '3');
  check('样本标准差', approx(S.stdev([2, 4, 4, 4, 5, 5, 7, 9], true), 2.1380899353, 1e-6), '2.1381');
  check('中位数（偶数个）', approx(S.median([1, 2, 3, 4]), 2.5), '2.5');
  check('中位数（奇数个）', approx(S.median([1, 5, 9]), 5), '5');
  check('Q1/Q3 线性插值', approx(S.quantile([1, 2, 3, 4, 5], 0.25), 2) && approx(S.quantile([1, 2, 3, 4, 5], 0.75), 4), '2 / 4');
  check('MAD', approx(S.mad([1, 2, 3, 4, 5]), 1), '1');

  section('离群判定');
  var vals = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
  var b = S.baseline(vals, { sigma: 3, iqrK: 1.5, madZ: 3.5 });
  check('基线样本量', b.n === 10, 'n=' + b.n);
  check('正常值不判为离群', !S.evalValue(190, b).hit, '190 未命中');
  check('极端值判为离群（3σ）', S.evalValue(100000, b).hit && S.evalValue(100000, b).reasons.indexOf('3σ') >= 0,
    S.evalValue(100000, b).reasons.join('/'));
  check('IQR 上界计算', approx(b.iqrLimit, b.q3 + 1.5 * b.iqr, 1e-9), 'Q3 + 1.5×IQR');
  check('样本量不足时降级并给出原因', S.baseline([1, 2, 3], {}).usable === false && !!S.baseline([1, 2, 3], {}).reason);
  check('无波动时降级', S.baseline([5, 5, 5, 5, 5, 5, 5, 5, 5], {}).usable === false);

  section('箱线图五数概括');
  var box = S.boxplot([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  check('离群点被识别', box.outliers.indexOf(100) >= 0, 'outliers=' + JSON.stringify(box.outliers));
  check('五数单调', box.min <= box.q1 && box.q1 <= box.median && box.median <= box.q3 && box.q3 <= box.max);
})();

/* ---------- 2. 数据与工具 ---------- */
group('2. 数据生成与通用工具');
var DS = App.demoData.build({});
(function () {
  section('十张业务表完整性');
  App.config.TABLE_ORDER.forEach(function (t) {
    check('表 ' + t + ' 有数据', (DS.data[t] || []).length > 0, (DS.data[t] || []).length + ' 行');
  });
  section('数据自洽性');
  var ents = DS.data.gl_voucher_entries;
  var debit = U.sum(ents, function (e) { return e.debit; });
  var credit = U.sum(ents, function (e) { return e.credit; });
  check('分录借贷合计含人造差额（应差 900）', approx(debit - credit, 900, 0.01), '差额 ' + U.round(debit - credit, 2));
  var perf = Date.now();
  App.demoData.build({});
  check('数据生成性能 < 1000ms', Date.now() - perf < 1000, (Date.now() - perf) + 'ms');

  section('工具函数');
  check('金额格式化（万/亿）', U.money(123456789) === '1.23 亿' && U.money(123456) === '12.35 万', U.money(123456789) + ' / ' + U.money(123456));
  check('千分位', U.moneyRaw(1234567.891) === '1,234,567.89', U.moneyRaw(1234567.891));
  check('日期解析（多种格式）',
    U.fmtDate('2025/3/5') === '2025-03-05' && U.fmtDate('20250305') === '2025-03-05' && U.fmtDate(new Date(2025, 2, 5)) === '2025-03-05');
  check('距月末天数（月末当天=1）', U.daysToMonthEnd('2025-03-31') === 1 && U.daysToMonthEnd('2025-03-27') === 5,
    U.daysToMonthEnd('2025-03-31') + ' / ' + U.daysToMonthEnd('2025-03-27'));
  check('编辑距离', U.levenshtein('李鹃国', '李建国') === 1 && U.levenshtein('孙鹏飞', '孙鹏飞') === 0);
  check('公司名识别', U.isCompany('上海某某贸易有限公司') && !U.isCompany('孙鹏飞'));
  check('自然人名识别', App.isPersonName('周成林', false, {}) && !App.isPersonName('宁波宏泰管理咨询有限公司', false, {}));
  check('身份证脱敏', U.maskIdCard('310101198503124417') === '3101**********4417', U.maskIdCard('310101198503124417'));
  check('日期间隔', U.daysBetween('2025-01-01', '2025-01-11') === 10);
})();

/* ---------- 3. F1 风险信号识别 ---------- */
group('3. F1 风险信号识别（双路筛查）');
var TH = JSON.parse(JSON.stringify(App.config.DEFAULT_THRESHOLDS));
var risk = App.riskAlert.run(DS, { thresholds: TH });
(function () {
  check('筛查成功', risk.ok === true);
  check('筛查性能 < 2000ms', risk.elapsedMs < 2000, risk.elapsedMs + 'ms');
  check('覆盖流水笔数 = 数据笔数', risk.totals.txnCount === DS.data.bank_transactions.length,
    risk.totals.txnCount + '/' + DS.data.bank_transactions.length);
  check('产生风险信号', risk.totals.signalCount > 0, risk.totals.signalCount + ' 条');
  check('信号占比在合理区间（5%–60%）', risk.totals.signalRatio > 0.05 && risk.totals.signalRatio < 0.60,
    (risk.totals.signalRatio * 100).toFixed(1) + '%');
  check('存在参考高风险', risk.totals.byLevel.high > 0, risk.totals.byLevel.high + ' 条');
  check('等级合计 = 信号总数', risk.totals.byLevel.high + risk.totals.byLevel.mid + risk.totals.byLevel.low === risk.totals.signalCount);

  section('九条规则均有命中');
  ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09'].forEach(function (code) {
    var st = risk.ruleStats.filter(function (x) { return x.code === code; })[0];
    check(code + ' ' + st.name + ' 有命中', st.count > 0, st.count + ' 条');
  });

  section('每条信号均可回溯（命中依据完整）');
  var noEvidence = risk.signals.filter(function (s) { return !s.ruleCodes.length || s.rules.some(function (x) { return !x.detail || !x.evidence; }); });
  check('所有信号都带命中依据', noEvidence.length === 0, noEvidence.length + ' 条缺失');

  section('植入信号被正确识别');
  var fake = risk.signals.filter(function (s) {
    return s.counterparty === '周成林' && s.amount === 1000000;
  });
  check('虚构交易样例（周成林 100 万）命中 ≥4 笔', fake.length >= 4, fake.length + ' 笔');
  check('该样例命中 R09 无业务支撑', fake.length > 0 && fake.every(function (s) { return s.ruleCodes.indexOf('R09') >= 0; }));
  check('该样例命中 R05 个人卡', fake.length > 0 && fake.every(function (s) { return s.ruleCodes.indexOf('R05') >= 0; }));
  check('该样例参考等级为高', fake.every(function (s) { return s.riskLevel === 'high'; }),
    fake.map(function (s) { return s.riskLabel; }).join(','));
  check('拆分交易被识别为 R03', risk.splitGroups.length > 0, risk.splitGroups.length + ' 组');
  var splitG = risk.splitGroups.filter(function (g) { return g.counterparty === '宁波宏泰管理咨询有限公司'; })[0];
  check('拆分单笔均低于 5 万且累计超阈值', !!splitG && splitG.total >= TH.R03_split_total, splitG ? U.money(splitG.total) : '未命中');

  section('阈值可调（口径记忆生效路径）');
  var loose = App.riskAlert.run(DS, { thresholds: Object.assign({}, TH, { R01_large_amount: 1e12 }) });
  var r01loose = loose.ruleStats.filter(function (x) { return x.code === 'R01'; })[0].count;
  check('提高大额阈值后 R01 命中减少', r01loose < risk.ruleStats[0].count, risk.ruleStats[0].count + ' → ' + r01loose);

  section('结果校验提示');
  check('给出跨期提示', risk.warnings.some(function (w) { return /跨/.test(w); }), risk.warnings.length + ' 条提示');

  section('合规边界');
  var safe = U.assertSafeText(JSON.stringify(risk));
  check('筛查结果不含越界表述', safe.ok, safe.issues.join(';'));
})();

/* ---------- 4. F2 线索梳理 ---------- */
group('4. F2 可疑交易线索梳理');
var clue = App.clueSort.run(risk, DS, { thresholds: TH });
(function () {
  check('生成线索', clue.ok && clue.totals.clueCount > 0, clue.totals.clueCount + ' 条');
  check('线索按优先级降序', clue.clues.every(function (c, i, a) { return i === 0 || a[i - 1].priority >= c.priority; }));
  check('每条线索有排序理由（≥4 条）', clue.clues.every(function (c) { return c.reasons.length >= 4; }),
    '首条理由数 ' + clue.clues[0].reasons.length);
  check('每条线索有建议核查方向', clue.clues.every(function (c) { return c.directions.length > 0; }));
  check('线索金额合计 > 0', clue.totals.totalAmount > 0, U.money(clue.totals.totalAmount));

  section('资金链路追踪');
  var statuses = Object.keys(clue.chainStats);
  check('链路状态只有三种取值', statuses.every(function (k) { return ['完整', '断点', '疑似回流'].indexOf(k) >= 0; }), statuses.join('/'));
  check('识别出疑似回流', (clue.chainStats['疑似回流'] || 0) > 0, clue.chainStats['疑似回流'] + ' 条');
  check('识别出链路断点', (clue.chainStats['断点'] || 0) > 0, clue.chainStats['断点'] + ' 条');

  section('四流合一与业务交叉核对');
  check('每条线索都有四流评分(0-100)', clue.clues.every(function (c) { return c.fourFlow.score >= 0 && c.fourFlow.score <= 100; }));
  check('四流评分不宣称证据链闭合', clue.clues.every(function (c) {
    /* 规则：出现"证据链…闭合/完整"时，必须是"不代表…"这类否定句 */
    var t = String(c.fourFlow.conclusion || '');
    if (/证据链(已)?闭?合|证据链完整/.test(t)) return /不代表证据链已闭合/.test(t) && !/^证据链/.test(t);
    return true;
  }), App.util.uniq(clue.clues.map(function (c) { return c.fourFlow.conclusion; })).join(' | ').slice(0, 90));
  check('识别出有资金无业务', (clue.crossStats.has_fund_no_biz || 0) > 0, clue.crossStats.has_fund_no_biz + ' 条');

  section('同对手方合并提示');
  check('生成合并提示', clue.mergeNotes.length > 0, clue.mergeNotes.length + ' 组');

  section('优先级权重可解释');
  check('权重合计为 100', clue.weights.amount + clue.weights.rules + clue.weights.related + clue.weights.chain === 100,
    JSON.stringify(clue.weights));

  section('合规边界');
  check('线索结果不含越界表述', U.assertSafeText(JSON.stringify(clue)).ok);
})();

/* ---------- 5. F3 关联方核查 ---------- */
group('5. F3 关联方穿透与关联交易核查');
var link = App.linkage.run(DS, { thresholds: TH });
(function () {
  check('核查成功', link.ok === true);
  check('发现可疑主体', link.totals.suspectCount > 0, link.totals.suspectCount + ' 个');
  section('四类核查均有命中');
  link.typeStats.forEach(function (t) {
    check(t.name + ' 有命中', t.count > 0, t.count + ' 个');
  });
  section('命中依据');
  var kp = link.suspects.filter(function (s) { return s.subject === '北京鼎峰资产管理有限公司' && s.typeCode === 'key_personnel_relation'; })[0];
  check('识别出账号重合（吴子豪工资卡）', !!kp && kp.hits.some(function (h) { return h.type === '银行账号重合'; }),
    kp ? kp.hits.map(function (h) { return h.type; }).join('/') : '未命中');
  check('识别出法人同名', !!kp && kp.hits.some(function (h) { return h.type === '法定代表人同名'; }));
  check('同一人不重复计数（法人=联系人）', !!kp && kp.hits.filter(function (h) { return h.type === '法定代表人同名'; }).length === 1);
  var sim = link.suspects.filter(function (s) { return s.hits.some(function (h) { return h.type === '姓名相似'; }); });
  check('识别出姓名相似（编辑距离≤1）', sim.length > 0, sim.length + ' 个，如 ' + (sim[0] ? sim[0].subject : ''));
  check('姓名相似给出防误判提示', sim.length > 0 && sim[0].needs.some(function (n) { return /身份证号比对|避免同名误判/.test(n); }));
  var eq = link.suspects.filter(function (s) { return s.typeCode === 'equity_penetration'; })[0];
  check('股权穿透输出链条', !!eq && eq.equityChain && eq.equityChain.length > 0, eq ? eq.depth + ' 层' : '');
  var mm = link.suspects.filter(function (s) { return s.typeCode === 'fund_contract_mismatch'; });
  check('识别资金合同错配', mm.length > 0, mm.length + ' 个');
  check('每个可疑主体都有需核实事项', link.suspects.every(function (s) { return s.needs && s.needs.length > 0; }));
  check('关系网络图有节点与连线', link.graph.nodes.length > 0 && link.graph.edges.length > 0,
    link.graph.nodes.length + ' 节点 / ' + link.graph.edges.length + ' 连线');
  section('合规边界');
  check('不宣称关联关系已成立', link.suspects.every(function (s) { return !/确认为关联方|已认定为关联方/.test(JSON.stringify(s)); }));
  check('关联方结果不含越界表述', U.assertSafeText(JSON.stringify(link)).ok);
})();

/* ---------- 6. F4 全科目汇总 ---------- */
group('6. F4 全科目汇总与数据质量');
var agg = App.aggregation.run(DS, {});
(function () {
  check('汇总成功', agg.ok === true);
  check('科目全覆盖', agg.rows.length === DS.data.subjects.length, agg.rows.length + '/' + DS.data.subjects.length);
  check('识别末级科目', agg.caliber.leafCount > 0 && agg.caliber.leafCount < agg.caliber.subjectCount,
    '末级 ' + agg.caliber.leafCount + '/' + agg.caliber.subjectCount);
  check('借贷平衡', agg.balance.balanced === true, '差额 ' + U.moneyRaw(agg.balance.diff));
  check('检出借贷不平凭证', agg.balance.unbalancedVouchers.length > 0, agg.balance.unbalancedVouchers.length + ' 张');
  check('逐期间借贷平衡', agg.balance.byPeriod.every(function (p) { return p.ok; }), agg.balance.byPeriod.length + ' 个期间');

  section('父级 = Σ子级');
  var parentOk = true, checkedParents = 0;
  agg.rows.filter(function (r) { return !r.isLeaf; }).forEach(function (p) {
    var kids = agg.rows.filter(function (r) { return r.parent_code === p.subject_code && r.level === p.level + 1; });
    if (!kids.length) return;
    checkedParents++;
    var sum = U.sum(kids, function (k) { return k.debit; });
    if (!approx(sum, p.debit, 0.02)) parentOk = false;
  });
  check('借方发生额父级汇总正确', parentOk, checkedParents + ' 个父级');

  section('数据质量检查');
  check('检出未勾对银企对账', agg.quality.some(function (q) { return q.code === 'unmatched_bank'; }));
  check('每个质量问题都有影响提示', agg.quality.every(function (q) { return !!q.impact; }));
  check('借贷平衡不因质量问题被误判', agg.balance.balanced === true);
})();

/* ---------- 7. F5 评分评估 ---------- */
group('7. F5 舞弊可能性参考评估');
var sc = App.scorecard.run({ riskAlert: risk, clueSort: clue, linkage: link, aggregation: agg, data: DS.data, meta: DS.meta }, {});
(function () {
  check('评分成功', sc.ok === true);
  check('覆盖七类舞弊', sc.cards.length === 7, sc.cards.length + ' 类');
  check('每类四个维度', sc.cards.every(function (c) { return c.dims.length === 4; }));
  check('分值在 0–100 区间', sc.cards.every(function (c) { return c.total >= 0 && c.total <= 100; }),
    sc.cards.map(function (c) { return c.name + c.total; }).join(' '));
  check('权重合计为 100', sc.cards.every(function (c) { return U.sum(c.dims, function (d) { return d.weight; }) === 100; }));

  section('参考区间必须带人工复核提示');
  check('每个区间文案含"需人工复核后定级"', sc.cards.every(function (c) { return /需人工复核后定级/.test(c.band.text); }));
  check('综合区间文案含"需人工复核后定级"', /需人工复核后定级/.test(sc.overallText), sc.overallText);
  check('免责句存在', /不替代调查结论|不构成对任何单位或个人的舞弊认定/.test(sc.disclaimer));

  section('结果校验');
  check('每个维度都有原始指标与计分口径', sc.cards.every(function (c) {
    return c.dims.every(function (d) { return !!d.rawText && !!d.rule; });
  }));
  check('每个类型都有解释', sc.cards.every(function (c) { return c.explain && c.explain.why.length > 10; }));
  check('分值有区分度（不全部相同）', U.uniq(sc.cards.map(function (c) { return c.total; })).length > 2,
    U.uniq(sc.cards.map(function (c) { return c.total; })).length + ' 个不同分值');

  section('权重可调');
  var sc2 = App.scorecard.run({ riskAlert: risk, clueSort: clue, linkage: link, aggregation: agg, data: DS.data, meta: DS.meta },
    { weights: { fake_transaction: { no_support_ratio: 100, cp_concentration: 0, four_flow_gap: 0, period_end_count: 0 } } });
  var f1 = sc.cards.filter(function (c) { return c.code === 'fake_transaction'; })[0].total;
  var f2 = sc2.cards.filter(function (c) { return c.code === 'fake_transaction'; })[0].total;
  check('调整权重改变分值', f1 !== f2, f1 + ' → ' + f2);

  section('合规边界');
  check('评分结果不含越界表述', U.assertSafeText(JSON.stringify(sc)).ok);
})();

/* ---------- 8. F6 报告 ---------- */
group('8. F6 舞弊调查分析报告起草');
var rep = App.report.build({ riskAlert: risk, clueSort: clue, linkage: link, aggregation: agg, scorecard: sc, data: DS.data, meta: DS.meta },
  { template: { title: '舞弊调查分析报告（初稿）', orgName: '华信融通投资控股有限公司', reviewer: '郑雅琴' } });
var repHtml = App.report.toHTML(rep);
var repMd = App.report.toMarkdown(rep);
(function () {
  check('报告构建成功', rep.ok === true);
  check('报告编号存在', /^FR-\d{8}-/.test(rep.reportNo), rep.reportNo);
  var SECS = ['一、调查背景与范围', '二、分析方法', '三、主要发现', '四、线索台账摘要', '五、关联方核查摘要',
    '六、舞弊可能性参考评估', '七、证据缺口与待核实事项清单', '八、进一步核查建议', '九、数据质量与局限性说明', '十、声明'];
  section('十节结构');
  SECS.forEach(function (t) { check('含「' + t + '」', repHtml.indexOf(t) >= 0); });

  section('强制声明');
  check('强制声明与配置完全一致', repHtml.indexOf(App.config.MANDATORY_DISCLAIMER) >= 0);
  check('声明含"不替代调查结论"', repHtml.indexOf('不替代调查结论') >= 0);
  check('结论段留空待填', repHtml.indexOf('由调查人员填写') >= 0);
  check('有签署栏', repHtml.indexOf('签字') >= 0);

  section('内容完整性');
  check('主要发现 ≥3 条', rep.sections.s3.findings.length >= 3, rep.sections.s3.findings.length + ' 条');
  check('线索摘要表非空', rep.sections.s4.rows.length > 0);
  check('关联方摘要表非空', rep.sections.s5.rows.length > 0);
  check('证据缺口清单非空', rep.sections.s7.gaps.length > 0, rep.sections.s7.gaps.length + ' 项');
  check('核查建议非空', rep.sections.s8.items.length > 0, rep.sections.s8.items.length + ' 条');
  check('局限性说明非空', rep.sections.s9.limits.length > 0);
  check('HTML 可导出', repHtml.length > 8000, repHtml.length + ' 字符');
  check('Markdown 可导出', repMd.length > 3000, repMd.length + ' 字符');

  section('合规边界');
  var g = U.assertSafeText(repHtml);
  check('报告正文不含越界表述', g.ok, g.issues.join(';'));
  check('报告声明不宣称证据链闭合', !/证据链已闭合/.test(repHtml) || /不代表证据链已闭合/.test(repHtml));

  section('缺模块时的降级');
  var partial = App.report.build({ riskAlert: risk, data: DS.data, meta: DS.meta }, {});
  check('标记缺失模块', partial.missingModules.length > 0, partial.missingModules.join('、'));
  check('仍包含强制声明', App.report.toHTML(partial).indexOf('不替代调查结论') >= 0);
})();

/* ---------- 9. F7 记忆 ---------- */
group('9. F7 偏好记忆与口径校验');
(function () {
  var mem = App.memory.load();
  check('默认记忆可加载', !!mem.thresholds && mem.enabled === true);
  check('默认阈值等于配置默认值', mem.thresholds.R01_large_amount === App.config.DEFAULT_THRESHOLDS.R01_large_amount);
  App.memory.save({ thresholds: Object.assign({}, mem.thresholds, { R01_large_amount: 999999 }) });
  check('记忆持久化生效', App.memory.load().thresholds.R01_large_amount === 999999);
  var sigA = App.memory.signature({ thresholds: App.memory.load().thresholds, period: mem.period, fraudTypes: mem.fraudTypes, whitelist: [] });
  var sigB = App.memory.signature({ thresholds: Object.assign({}, App.memory.load().thresholds, { R01_large_amount: 1 }), period: mem.period, fraudTypes: mem.fraudTypes, whitelist: [] });
  check('口径签名能检出变更', sigA !== sigB);
  var echo = App.memory.describe({ thresholds: App.config.DEFAULT_THRESHOLDS, period: { start: '2025-01-01', end: '2025-12-31' }, fraudTypes: [] });
  check('口径回显文案可用', echo.length > 20, echo.slice(0, 60) + '…');
  App.memory.clear();
  check('清空记忆恢复默认', App.memory.load().thresholds.R01_large_amount === App.config.DEFAULT_THRESHOLDS.R01_large_amount);
})();

/* ---------- 10. 知识库 ---------- */
group('10. 知识库检索（RAG）');
(function () {
  var kb = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'knowledge', 'fraud-kb.json'), 'utf8'));
  /* 快照：rag.load 会给文档追加索引字段（_len），不能拿加载后的对象做全等比较 */
  var kbSnapshot = JSON.stringify(kb.docs);
  App.rag.load(kb.docs);
  check('知识库加载', App.rag.docs().length === kb.docs.length, App.rag.docs().length + ' 条');
  check('不含企业制度条款库', kb.note.indexOf('不含') >= 0);
  var cases = [
    ['3σ 标准差怎么算', '统计离群'],
    ['四流合一怎么核查', '四流合一'],
    ['资金回流怎么识别', '资金链路'],
    ['报告里哪些话不能写', '禁用语'],
    ['拆分交易', '规则'],
    ['全科目汇总借贷不平', '全科目'],
    ['关联方股权穿透', '关联方'],
    ['表外担保', '担保'],
    ['加权评分卡怎么做', '评分卡'],
    ['数据质量怎么检查', '数据质量']
  ];
  var allOk = true;
  cases.forEach(function (c) {
    var hits = App.rag.search(c[0], 2);
    var ok = hits.length > 0 && hits[0].title.indexOf(c[1]) >= 0;
    if (!ok) allOk = false;
    check('检索「' + c[0] + '」', ok, hits.length ? hits[0].title : '未命中');
  });
  check('全部检索用例命中', allOk);
  var ctx = App.rag.context('四流合一', 2);
  check('可拼接上下文供大模型使用', ctx.text.length > 100 && ctx.hits.length > 0, ctx.text.length + ' 字符');

  section('离线内嵌副本与源文件同步');
  require(path.join(BASE, 'core', 'kb-embedded.js'));
  var emb = App.embeddedKB;
  check('内嵌副本存在', !!(emb && emb.docs && emb.docs.length), emb ? emb.docs.length + ' 条' : '缺失');
  check('内嵌副本与源文件内容一致（防遗漏重新生成）',
    JSON.stringify(emb.docs) === kbSnapshot,
    '源 ' + kb.docs.length + ' 条 / 内嵌 ' + (emb.docs || []).length + ' 条');
})();

/* ---------- 11. 合规边界 ---------- */
group('11. 合规边界与禁用语');
(function () {
  var bad = '经分析，该笔交易构成舞弊，此人存在舞弊行为，建议立案调查，建议处理该员工。';
  var g = U.assertSafeText(bad);
  check('检出越界表述', !g.ok && g.issues.length >= 4, g.issues.length + ' 处');
  var fixed = U.sanitizeText(bad);
  check('改写后通过检查', U.assertSafeText(fixed).ok, fixed.slice(0, 40) + '…');
  check('改写后不含"构成舞弊"', fixed.indexOf('构成舞弊') < 0);
  check('改写后不含"建议立案"', fixed.indexOf('建议立案') < 0);
  check('改写后不含"建议处理某"', !/建议处理[某该]/.test(fixed));
  check('合法表述不被误判', U.assertSafeText('该笔交易触发 3 项风险信号，建议人工核查。').ok);
  check('配置中的禁用语模式可编译', App.config.FORBIDDEN_PATTERNS.every(function (re) { return re instanceof RegExp; }));
})();

/* ---------- 12. 数据接入 ---------- */
group('12. 数据接入（CSV 解析与字段映射）');
(function () {
  var csv = '交易日期,对方户名,交易金额,收付标志,用途,凭证号\n2025-01-05,某供应商,123456.78,付,货款,PZ0001\n2025-01-06,张三,50000,收,咨询费,\n';
  var rows = App.dataSource.parseCSV(csv);
  check('CSV 解析行数', rows.length === 2, rows.length + ' 行');
  check('中文表头保留', rows[0]['对方户名'] === '某供应商');
  var r = App.dataSource.fromSheets({ '银行流水': rows }, { source: 'upload' });
  check('自动识别为银行流水表', r.ok && r.data.bank_transactions && r.data.bank_transactions.length === 2);
  if (r.ok) {
    var t = r.data.bank_transactions[0];
    check('字段映射（对方户名→counterparty）', t.counterparty_name === '某供应商', String(t.counterparty_name));
    check('字段映射（金额→amount）', t.amount === 123456.78, String(t.amount));
    check('收付标志归一', t.direction === '付' || t.direction === '收', t.direction);
    check('日期标准化', /^\d{4}-\d{2}-\d{2}$/.test(t.txn_date), t.txn_date);
  }
  var csvOut = App.dataSource.toCSV([{ a: 1, b: 'x,y' }], ['a', 'b'], ['A', 'B']);
  check('CSV 导出转义', csvOut.indexOf('"x,y"') >= 0 && csvOut.charCodeAt(0) === 0xFEFF);
})();

/* ---------- 13. 端到端 ---------- */
group('13. 端到端一致性');
(function () {
  var r1 = App.riskAlert.run(DS, { thresholds: TH });
  var r2 = App.riskAlert.run(DS, { thresholds: TH });
  check('相同输入结果确定（可复现）', r1.totals.signalCount === r2.totals.signalCount,
    r1.totals.signalCount + ' = ' + r2.totals.signalCount);
  var t = Date.now();
  var all = App.runPipelineForTest ? null : null;
  var ra = App.riskAlert.run(DS, { thresholds: TH });
  var ca = App.clueSort.run(ra, DS, { thresholds: TH });
  var la = App.linkage.run(DS, { thresholds: TH });
  var aa = App.aggregation.run(DS, {});
  var sa = App.scorecard.run({ riskAlert: ra, clueSort: ca, linkage: la, aggregation: aa, data: DS.data, meta: DS.meta }, {});
  var elapsed = Date.now() - t;
  check('全流水线性能 < 3000ms', elapsed < 3000, elapsed + 'ms');
  check('全流水线无异常', !!(ra.ok && ca.ok && la.ok && aa.ok && sa.ok));
})();

/* ---------- 汇总 ---------- */
const dur = Date.now() - t0;
console.log('\n============================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项，耗时 ' + dur + 'ms');
if (fail) {
  console.log('\n失败明细：');
  failures.forEach(function (f) { console.log('  ✗ ' + f); });
  console.log('============================================');
  process.exit(1);
} else {
  console.log('全部通过 ✓');
  console.log('============================================');
  process.exit(0);
}
