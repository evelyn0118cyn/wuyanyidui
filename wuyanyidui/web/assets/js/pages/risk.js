/* =============================================================
 * 页面：风险信号识别（F1 risk_alert）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.risk = {
    render: function (mount) {
      var S = App.state;
      if (!App.requireDataset(mount, '风险信号识别')) return;

      var cal = S.caliber();
      var h = [];
      h.push(UI.divisionBar('助理辅助：筛查 / 排序 / 打标签　｜　人工决策：是否异常、异常原因、是否纳入线索'));
      h.push(caliberBar(cal));

      /* 操作区 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">双路筛查<span class="sub">统计异常（3σ / IQR / MAD）+ 规则异常（R01–R09）</span></div>' +
        '<div class="card-actions">' +
        '<button class="btn btn-sm" id="btnCfgTh">阈值设置</button>' +
        '<button class="btn btn-sm btn-primary" id="btnRun">开始筛查</button>' +
        '</div></div>');
      h.push('<div class="small muted">' + UI.esc(cal.echo) + '</div>');
      if (S.stale.riskAlert) h.push(UI.alert('数据源或口径已变化，建议重新执行筛查。', 'warn'));
      h.push('</div>');

      h.push('<div id="riskOut"></div>');
      mount.innerHTML = h.join('');

      mount.querySelector('#btnCfgTh').addEventListener('click', function () { openThresholds(); });
      mount.querySelector('#btnRun').addEventListener('click', function () { run(mount); });

      if (S.riskAlert && S.riskAlert.ok) renderResult(mount, S.riskAlert);
      else mount.querySelector('#riskOut').innerHTML = UI.empty({
        icon: '⚠', title: '尚未执行筛查',
        desc: '点击「开始筛查」，助理将对 ' + ((S.dataset.data.bank_transactions || []).length) + ' 笔银行流水逐笔计算统计偏离度并命中 R01–R09 规则，按参考风险等级排序输出。'
      });
    }
  };

  function caliberBar(cal) {
    return '<div class="caliber-bar"><span>本次使用口径：</span><b>' + UI.esc(cal.echo) + '</b>' +
      '<span class="small muted">（来自记忆' + (cal.fromMemory ? '' : '，记忆已关闭') + '）</span>' +
      '<span class="cal-actions"><button class="btn btn-sm" id="btnEditCal">修改</button></span></div>';
  }

  /* ---------------- 阈值设置弹窗（F7 记忆） ---------------- */
  function openThresholds() {
    var cal = App.state.caliber();
    var th = cal.thresholds;
    var fields = [
      ['sigma', '统计：σ 倍数（3σ 口径）', 0.1],
      ['iqrK', '统计：IQR 系数', 0.1],
      ['madZ', '统计：MAD 修正 Z 阈值', 0.1],
      ['R01_large_amount', 'R01 大额阈值（元）', 10000],
      ['R02_round_amount', 'R02 整数基数（元）', 10000],
      ['R03_split_total', 'R03 拆分累计阈值（元）', 10000],
      ['R03_split_single_max', 'R03 单笔上限（元）', 1000],
      ['R03_split_window_days', 'R03 窗口天数', 1],
      ['R04_period_end_days', 'R04 期末天数', 1],
      ['R04_period_end_amount', 'R04 期末金额门槛（元）', 10000],
      ['R06_freq_multiple', 'R06 频次倍数', 1],
      ['R07_hedge_ratio', 'R07 对冲金额容差（0–1）', 0.01],
      ['R07_hedge_days', 'R07 对冲窗口（天）', 1],
      ['R08_night_start', 'R08 夜间起点（时）', 1],
      ['R08_night_end', 'R08 夜间终点（时）', 1]
    ];
    var body = ['<div class="small muted mb14">修改后将写入偏好记忆，并在每次分析前回显。阈值口径的最终确认由岗位人员作出。</div>'];
    body.push('<div class="modal-section"><h4>统计异常阈值</h4>');
    fields.slice(0, 3).forEach(function (f) { body.push(fieldHTML(f, th[f[0]])); });
    body.push('</div><div class="modal-section"><h4>规则异常阈值</h4>');
    fields.slice(3).forEach(function (f) { body.push(fieldHTML(f, th[f[0]])); });
    body.push('</div><div class="modal-section"><h4>白名单（对手方关键词，命中的流水不参与筛查）</h4>' +
      '<input class="input" id="f_whitelist" style="width:100%" placeholder="用逗号分隔，如：税务局,社保中心" value="' + UI.esc((cal.whitelist || []).join(',')) + '">' +
      '<div class="hint">常用白名单可减少误报，但会掩盖真实异常，请谨慎使用。</div></div>');

    var m = UI.modal({
      title: '口径与阈值设置',
      wide: true,
      body: body.join(''),
      footer: '<button class="btn" data-close>取消</button><button class="btn" id="btnResetTh">恢复默认</button><button class="btn btn-primary" id="btnSaveTh">保存并记忆</button>'
    });

    m.body.parentNode.querySelector('#btnSaveTh').addEventListener('click', function () {
      var next = {};
      var bad = [];
      fields.forEach(function (f) {
        var v = U.num(m.body.querySelector('#f_' + f[0]).value);
        if (!isFinite(v)) { bad.push(f[1]); return; }
        next[f[0]] = v;
      });
      if (bad.length) { UI.toast('请检查数值：' + bad.join('、'), 'err'); return; }
      var wl = m.body.querySelector('#f_whitelist').value.split(/[,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);
      App.memory.save({ thresholds: Object.assign({}, App.config.DEFAULT_THRESHOLDS, next), whitelist: wl });
      m.close();
      UI.toast('阈值已保存并记忆（口径已变更，与历史分析不可直接比较）', 'ok');
      App.pages.risk.render(document.getElementById('pageContent'));
    });
    m.body.parentNode.querySelector('#btnResetTh').addEventListener('click', function () {
      App.memory.save({ thresholds: JSON.parse(JSON.stringify(App.config.DEFAULT_THRESHOLDS)), whitelist: [] });
      m.close();
      UI.toast('已恢复默认阈值', 'ok');
      App.pages.risk.render(document.getElementById('pageContent'));
    });
  }

  function fieldHTML(f, v) {
    return '<label class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:7px">' +
      '<span style="flex:1;margin:0">' + UI.esc(f[1]) + '</span>' +
      '<input class="input" id="f_' + f[0] + '" style="width:130px;text-align:right" value="' + UI.esc(v) + '"></label>';
  }

  /* ---------------- 执行 ---------------- */
  function run(mount) {
    var S = App.state;
    var out = mount.querySelector('#riskOut');
    out.innerHTML = UI.loading('正在逐笔计算统计偏离度与规则命中…');
    setTimeout(function () {
      try {
        var cal = S.caliber();
        var t0 = Date.now();
        var r = App.riskAlert.run(S.dataset, {
          thresholds: cal.thresholds, period: cal.period,
          whitelist: cal.whitelist, fraudTypes: cal.fraudTypes
        });
        if (!r.ok) { out.innerHTML = UI.errorState(r.error); return; }
        App.state.set('riskAlert', r);
        App.memory.recordUsage({ thresholds: cal.thresholds, period: cal.period, fraudTypes: cal.fraudTypes, whitelist: cal.whitelist });
        renderResult(mount, r);
        UI.toast('筛查完成：' + r.totals.signalCount + ' 条信号（参考高 ' + r.totals.byLevel.high + ' 条），耗时 ' + (Date.now() - t0) + 'ms', 'ok');
      } catch (e) {
        console.error(e);
        out.innerHTML = UI.errorState(e.message, '请按 F12 查看控制台。');
      }
    }, 30);
  }

  /* ---------------- 渲染结果 ---------------- */
  function renderResult(mount, r) {
    var out = mount.querySelector('#riskOut');
    var t = r.totals, b = r.baseline;
    var h = [];

    /* 统计卡 */
    h.push('<div class="stat-row">' +
      UI.stat({ label: '筛查流水', value: U.thousands(t.txnCount) + ' 笔', hint: '统计期间内全部流水' }) +
      UI.stat({ label: '风险信号', value: t.signalCount + ' 条', hint: '占比 ' + (t.signalRatio * 100).toFixed(1) + '%', tone: 'primary' }) +
      UI.stat({ label: '参考高风险', value: t.byLevel.high + ' 条', hint: '需优先人工复核', tone: 'high', tip: '参考风险等级，需人工复核后定级' }) +
      UI.stat({ label: '参考中风险', value: t.byLevel.mid + ' 条', hint: '建议纳入核查范围', tone: 'mid' }) +
      UI.stat({ label: '参考低风险', value: t.byLevel.low + ' 条', hint: '常规关注', tone: 'low' }) +
      UI.stat({ label: '统计离群命中', value: t.statHitCount + ' 条', hint: '3σ / IQR / MAD 任一命中' }) +
      '</div>');

    /* 校验提示 */
    if (r.warnings && r.warnings.length) h.push(UI.alerts(r.warnings, 'warn', '结果校验提示'));
    else h.push(UI.alert('结果校验：样本量、空值、跨期等检查均未发现异常提示。', 'ok'));

    /* 统计基线 */
    h.push('<div class="caliber-bar" style="display:block;line-height:1.9">' +
      '<div><b>统计基线（可复核的中间量）</b></div>' +
      '<div class="small">样本 ' + b.n + ' 笔　均值 ' + U.moneyRaw(b.mean) + '　标准差 ' + U.moneyRaw(b.stdev) +
      '　中位数 ' + U.moneyRaw(b.median) + '　MAD ' + U.moneyRaw(b.mad) + '</div>' +
      '<div class="small">Q1 ' + U.moneyRaw(b.q1) + '　Q3 ' + U.moneyRaw(b.q3) + '　IQR ' + U.moneyRaw(b.iqr) +
      '　→ ' + b.sigma + 'σ 上界 ' + U.moneyRaw(b.sigmaLimit) + '　IQR 上界 ' + U.moneyRaw(b.iqrLimit) +
      '　MAD 上界 ' + (isFinite(b.madLimit) ? U.moneyRaw(b.madLimit) : '—') + '</div>' +
      (b.reason ? '<div class="small" style="color:#A9700A">· ' + UI.esc(b.reason) + '</div>' : '') +
      '</div>');

    /* 图表 */
    var cal = App.state.caliber();
    h.push('<div class="grid2 mt14">');
    h.push(UI.chartCard({
      title: '信号金额时间分布', sub: '散点图：X=交易日期，Y=金额',
      caliber: '统计期间 ' + (r.periodUsed.start || '—') + ' ~ ' + (r.periodUsed.end || '—'),
      body: UI.scatterChart(r.signals, { mean: b.mean })
    }));
    h.push(UI.chartCard({
      title: '规则命中分布', sub: '按规则统计命中条数',
      caliber: '全科目 · R01–R09',
      body: UI.barChart(r.ruleStats.filter(function (x) { return x.count > 0; }).map(function (x) {
        return { label: x.code + ' ' + x.name, value: x.count, text: x.count + ' 条 / ' + U.money(x.amount) };
      }), { labelWidth: 116, valueWidth: 130 })
    }));
    h.push('</div>');

    h.push('<div class="grid2 mt14">');
    var amts = r.signals.map(function (s) { return s.amount; }).filter(function (v) { return isFinite(v); });
    var box = {
      n: b.n,
      min: amts.length ? Math.min.apply(null, amts) : 0,
      max: amts.length ? Math.max.apply(null, amts) : 0,
      q1: b.q1, median: b.median, q3: b.q3,
      iqr: b.iqr, hiFence: b.iqrLimit, loFence: b.q1 - U.num(b.iqrK, 1.5) * b.iqr,
      outliers: r.signals.filter(function (s) { return s.statHit; }).map(function (s) { return s.amount; })
    };
    h.push(UI.chartCard({
      title: '金额箱线图', sub: '离群阈值与分布',
      caliber: 'IQR 口径（Q3 + ' + b.iqrK + '×IQR）',
      body: UI.boxplotChart(box)
    }));
    h.push(UI.chartCard({
      title: '疑似舞弊类型分布', sub: '规则映射结果（非定性）',
      caliber: 'R01–R09 → 七类舞弊映射',
      body: UI.barChart(r.fraudDist.filter(function (x) { return x.count > 0; }).map(function (x) {
        return { label: x.name, value: x.count, text: x.count + ' 条（高 ' + x.highCount + '）', color: x.highCount > 0 ? '#D93025' : '#9B7BFF' };
      }), { labelWidth: 110, valueWidth: 110 })
    }));
    h.push('</div>');

    /* 拆分组明细 */
    if (r.splitGroups.length) {
      h.push('<div class="card mt14"><div class="card-head"><div class="card-title">R03 拆分交易分组明细<span class="sub">同一对手方窗口内多笔小额累计</span></div></div>');
      h.push('<div class="table-wrap"><table class="grid"><thead><tr><th>对手方</th><th style="text-align:right">笔数</th><th style="text-align:right">累计金额</th><th>窗口</th><th>日期</th><th>交易ID</th></tr></thead><tbody>');
      r.splitGroups.slice(0, 20).forEach(function (g) {
        h.push('<tr><td>' + UI.esc(g.counterparty) + '</td><td class="num">' + g.count + '</td><td class="num">' + U.moneyRaw(g.total) + '</td>' +
          '<td>' + g.days + ' 天</td><td class="small">' + UI.esc(g.dates.join(', ')) + '</td><td class="small mono">' + UI.esc(g.txnIds.join(', ')) + '</td></tr>');
      });
      h.push('</tbody></table></div></div>');
    }

    /* 风险信号清单 */
    h.push('<div class="card mt14"><div class="card-head"><div class="card-title">风险信号清单<span class="sub">按参考风险等级与金额排序，点击行可展开命中依据</span></div>' +
      '<div class="card-actions">' +
      '<button class="btn btn-sm" id="btnExplainTop">解读首条信号（AI）</button>' +
      '<button class="btn btn-sm" id="btnExportSig">导出信号清单 CSV</button>' +
      '<button class="btn btn-sm btn-primary" id="btnToClue">生成线索台账 →</button>' +
      '</div></div><div id="sigTable"></div></div>');

    out.innerHTML = h.join('');

    /* 绑定 */
    var calEdit = mount.querySelector('#btnEditCal');
    if (calEdit) calEdit.addEventListener('click', openThresholds);

    var api = UI.table(out.querySelector('#sigTable'), {
      rows: r.signals,
      csvName: '风险信号清单',
      pageSize: 50,
      expandable: true,
      rowClass: function (row) { return 'risk-' + row.riskLevel; },
      columns: [
        { key: 'id', title: '信号号', width: 88, render: function (row) { return '<span class="mono">' + UI.esc(row.id) + '</span>'; } },
        { key: 'txn_date', title: '交易日期', width: 104 },
        { key: 'txn_time', title: '时间', width: 72, render: function (row) { return UI.esc(row.txn_time || '—'); } },
        { key: 'direction', title: '方向', width: 52, render: function (row) { return '<span class="tag ' + (row.direction === '收' ? 'tag-low' : 'tag-gray') + '">' + UI.esc(row.direction) + '</span>'; } },
        { key: 'amount', title: '金额（元）', width: 118, type: 'num', render: function (row) { return U.moneyRaw(row.amount); }, csv: function (row) { return row.amount; } },
        {
          key: 'counterparty', title: '对手方', width: 190,
          render: function (row) {
            return UI.esc(row.counterparty) + (row.counterparty_is_person ? ' <span class="tag tag-mid">个人</span>' : '');
          }
        },
        { key: 'purpose', title: '用途', width: 104, render: function (row) { return UI.esc(row.purpose || '—'); } },
        {
          key: 'ruleCodes', title: '命中规则', width: 150,
          render: function (row) {
            return row.ruleCodes.map(function (c) { return '<span class="tag" title="' + UI.esc((r.rules[c] || {}).name || '') + '">' + c + '</span>'; }).join(' ');
          },
          csv: function (row) { return row.ruleCodes.join('/'); }
        },
        {
          key: 'statReasons', title: '统计偏离', width: 106,
          render: function (row) {
            if (!row.statHit) return '<span class="muted">—</span>';
            return row.statReasons.map(function (x) { return '<span class="tag tag-mid">' + UI.esc(x) + '</span>'; }).join(' ') +
              '<div class="small muted">Z=' + row.statZ + '</div>';
          },
          csv: function (row) { return row.statHit ? row.statReasons.join('/') + ' Z=' + row.statZ : ''; }
        },
        {
          key: 'primaryFraud', title: '疑似舞弊类型', width: 118,
          render: function (row) {
            var ft = App.config.FRAUD_TYPES.filter(function (x) { return x.code === row.primaryFraud; })[0];
            return ft ? '<span class="tag tag-line">' + UI.esc(ft.name) + '</span>' : '—';
          },
          csv: function (row) {
            return row.fraudTypes.map(function (c) { var f = App.config.FRAUD_TYPES.filter(function (x) { return x.code === c; })[0]; return f ? f.name : c; }).join('/');
          }
        },
        {
          key: 'riskLevel', title: '参考等级', width: 84,
          render: function (row) { return UI.riskTag(row.riskLevel, true); },
          sortValue: function (row) { return ({ high: 3, mid: 2, low: 1 })[row.riskLevel]; },
          csv: function (row) { return row.riskLabel; }
        }
      ],
      filters: [
        {
          key: 'level', label: '风险等级',
          options: [{ value: 'high', label: '参考高' }, { value: 'mid', label: '参考中' }, { value: 'low', label: '参考低' }],
          test: function (row, v) { return row.riskLevel === v; }
        },
        {
          key: 'rule', label: '命中规则',
          options: Object.keys(r.rules).map(function (c) { return { value: c, label: c + ' ' + r.rules[c].name }; }),
          test: function (row, v) { return row.ruleCodes.indexOf(v) >= 0; }
        },
        {
          key: 'fraud', label: '舞弊类型',
          options: App.config.FRAUD_TYPES.map(function (f) { return { value: f.code, label: f.name }; }),
          test: function (row, v) { return row.fraudTypes.indexOf(v) >= 0; }
        },
        {
          key: 'stat', label: '统计离群',
          options: [{ value: 'y', label: '仅统计离群' }, { value: 'n', label: '排除统计离群' }],
          test: function (row, v) { return v === 'y' ? row.statHit : !row.statHit; }
        },
        {
          key: 'person', label: '对手方',
          options: [{ value: 'y', label: '仅个人' }, { value: 'n', label: '仅单位' }],
          test: function (row, v) { return v === 'y' ? row.counterparty_is_person : !row.counterparty_is_person; }
        }
      ],
      expand: function (row) { return evidenceHTML(row, r); }
    });

    out.querySelector('#btnExportSig').addEventListener('click', function () { api.exportCSV(); });
    out.querySelector('#btnToClue').addEventListener('click', function () {
      var clue = App.clueSort.run(r, App.state.dataset, { thresholds: App.state.caliber().thresholds, linkage: App.state.linkage });
      if (!clue.ok) { UI.toast(clue.error, 'err'); return; }
      App.state.set('clueSort', clue);
      UI.toast('已生成 ' + clue.totals.clueCount + ' 条线索', 'ok');
      App.go('clue');
    });
    out.querySelector('#btnExplainTop').addEventListener('click', function () {
      if (!r.signals.length) return;
      explainSignal(r.signals[0]);
    });

    /* 行点击 → 展开依据（已由 expandable 处理） */
  }

  /* 命中依据展开区 */
  function evidenceHTML(row, r) {
    var h = [];
    h.push('<div class="evidence-box">');
    h.push('<h5>命中依据（可复核的中间量）</h5>');
    h.push('<div class="evidence-grid">' +
      '<div class="kv">交易ID：<b class="mono">' + UI.esc(row.txn_id) + '</b></div>' +
      '<div class="kv">账户：<b>' + UI.esc(row.account_no || row.account_id || '—') + '</b></div>' +
      '<div class="kv">凭证号：<b class="mono">' + UI.esc(row.voucher_no || '无') + '</b></div>' +
      '<div class="kv">银企对账：<b>' + (row.matched ? '已勾对' : '未勾对') + '</b></div>' +
      '<div class="kv">统计偏离度：<b>Z=' + row.statZ + '，MAD-Z=' + row.statMadZ + '</b></div>' +
      '<div class="kv">综合偏离：<b>' + row.devScore + '</b></div>' +
      '</div>');
    h.push('<h5 class="mt8">规则命中明细</h5><ul>');
    row.rules.forEach(function (x) {
      h.push('<li><b>' + x.code + ' ' + UI.esc((r.rules[x.code] || {}).name) + '</b>：' + UI.esc(x.detail) +
        '<div class="kv">证据：' + UI.esc(x.evidence) + '</div></li>');
    });
    h.push('</ul>');
    if (row.weakRules && row.weakRules.length) {
      h.push('<h5>弱支撑提示（未单独计分）</h5><ul>');
      row.weakRules.forEach(function (x) { h.push('<li>' + x.code + '：' + UI.esc(x.detail) + '</li>'); });
      h.push('</ul>');
    }
    if (row.statHit) {
      h.push('<div class="kv" style="margin-bottom:6px">统计离群：命中 <b>' + UI.esc(row.statReasons.join(' / ')) + '</b> 口径（' +
        '3σ 上界 ' + U.moneyRaw(r.baseline.sigmaLimit) + '，IQR 上界 ' + U.moneyRaw(r.baseline.iqrLimit) + '）</div>');
    }
    var ft = App.config.FRAUD_TYPES.filter(function (x) { return x.code === row.primaryFraud; })[0];
    h.push('<div class="kv">疑似舞弊类型（规则映射）：<b>' + UI.esc(ft ? ft.name : row.primaryFraud) + '</b>' +
      '　（映射关系为 R01–R09 → 七类舞弊，非定性结论）</div>');
    h.push('<div class="flex-gap mt8"><button class="btn btn-sm" data-explain="' + UI.esc(row.id) + '">🤖 让 AI 解读这笔信号</button>' +
      '<span class="small muted">解读为参考文本，最终判断由调查人员作出</span></div>');
    h.push('</div>');
    setTimeout(function () {
      var btn = document.querySelector('[data-explain="' + row.id + '"]');
      if (btn) btn.addEventListener('click', function () { explainSignal(row); });
    }, 0);
    return h.join('');
  }

  /* AI 解读 */
  function explainSignal(sig) {
    var m = UI.modal({
      title: '信号解读（AI 辅助）',
      wide: true,
      body: '<div id="expOut">' + UI.loading('正在调用大模型解读…（未配置时将使用本地模式）') + '</div>',
      footer: '<button class="btn" data-close>关闭</button><button class="btn" id="btnCopyExp">复制</button>'
    });
    var out = m.body.querySelector('#expOut');
    App.llm.explainSignal(sig, {
      onDelta: function (acc) { out.innerHTML = '<div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + UI.esc(acc) + '</div>'; }
    }).then(function (r) {
      out.innerHTML = modeBanner(r) + '<div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + UI.esc(r.text) + '</div>';
      var cp = m.body.parentNode.querySelector('#btnCopyExp');
      if (cp) cp.onclick = function () { UI.copy(r.text, '解读已复制'); };
    });
  }

  function modeBanner(r) {
    if (r.mode === 'llm') return UI.alert('✓ 大模型生成 ' + (r.reasoning ? '（已隔离 ' + r.reasoning.length + ' 字思考过程）' : '') +
      (r.ragHits && r.ragHits.length ? '　知识库参考：' + r.ragHits.map(function (x) { return x.title; }).join('、') : ''), 'ok');
    return UI.alert('⚠ 本地模式：' + UI.esc(r.fallbackReason || '未配置大模型 Key') +
      '<br>以下内容由内置规则与知识库生成，仅供离线参考。', 'warn');
  }

  App.pages.risk.openThresholds = openThresholds;
  App.pages.risk.modeBanner = modeBanner;
})(typeof window !== 'undefined' ? window : globalThis);
