/* =============================================================
 * 页面：评分评估（F5 weighted_scorecard）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.score = {
    render: function (mount) {
      var S = App.state;
      if (!App.requireDataset(mount, '评分评估')) return;

      var h = [];
      h.push(UI.divisionBar('助理辅助：算分 / 展示依据　｜　人工决策：定级、是否启动调查'));

      h.push('<div class="card"><div class="card-head"><div class="card-title">加权评分卡<span class="sub">七类舞弊 × 四维指标，0–5 分 × 权重 → 0–100 参考分值</span></div>' +
        '<div class="card-actions">' +
        '<button class="btn btn-sm" id="btnWeights">查看/调整权重</button>' +
        '<button class="btn btn-sm btn-primary" id="btnRunScore">生成评估</button>' +
        '</div></div>');

      var missing = [];
      if (!S.riskAlert || !S.riskAlert.ok) missing.push('风险信号识别');
      if (!S.clueSort || !S.clueSort.ok) missing.push('线索台账');
      if (missing.length) {
        h.push(UI.alert('未完成：' + missing.join('、') + '。评分仍可生成，但相关维度将按 0 计，参考性降低。', 'warn'));
      } else if (S.stale.scorecard) {
        h.push(UI.alert('上游结果已更新，本页评分可能已过期，建议重新生成。', 'warn'));
      }
      h.push('<div class="small muted">分值与区间为参考值，用于帮助分配复核注意力；不等同于舞弊概率，最终定级由岗位人员作出。</div>');
      h.push('</div>');

      h.push('<div id="scoreOut"></div>');
      mount.innerHTML = h.join('');

      mount.querySelector('#btnRunScore').addEventListener('click', function () { run(mount); });
      mount.querySelector('#btnWeights').addEventListener('click', function () { showWeights(mount); });

      if (S.scorecard && S.scorecard.ok) renderResult(mount, S.scorecard);
      else mount.querySelector('#scoreOut').innerHTML = UI.empty({
        icon: '◎', title: '尚未生成评分',
        desc: '点击「生成评估」，助理将基于前序模块结果计算七类舞弊的参考分值与参考区间。'
      });
    }
  };

  function run(mount) {
    var S = App.state;
    var out = mount.querySelector('#scoreOut');
    out.innerHTML = UI.loading('正在计算七类舞弊评分…');
    setTimeout(function () {
      try {
        var cal = S.caliber();
        var r = App.scorecard.run({
          riskAlert: S.riskAlert, clueSort: S.clueSort, linkage: S.linkage,
          aggregation: S.aggregation, data: S.dataset.data, meta: S.dataset.meta
        }, { weights: S.scoreWeights || {}, fraudTypes: cal.fraudTypes });
        if (!r.ok) { out.innerHTML = UI.errorState(r.error); return; }
        App.state.set('scorecard', r);
        renderResult(mount, r);
        UI.toast('评分完成：综合参考分值 ' + r.overall + ' 分（' + r.overallBand.label + '）', 'ok');
      } catch (e) {
        console.error(e);
        out.innerHTML = UI.errorState(e.message);
      }
    }, 30);
  }

  function renderResult(mount, r) {
    var out = mount.querySelector('#scoreout') || mount.querySelector('#scoreOut');
    var h = [];

    /* 参考区间结论条（必须附"需人工复核后定级"） */
    var bandCls = { low: 'band-low', mid: 'band-mid', high: 'band-high', crit: 'band-crit' }[r.overallBand.level] || 'band-mid';
    h.push('<div class="band-strip ' + bandCls + '">' +
      '<span class="band-score">' + r.overall + '</span>' +
      '<div><div class="band-text">' + UI.esc(r.overallText) + '</div>' +
      '<div class="small">综合参考分值（' + r.cards.filter(function (c) { return c.inFocus; }).length + ' 类舞弊均值）' + UI.info('参考值，需人工复核后定级') + '</div></div>' +
      '<div class="band-note">⚠ ' + UI.esc(r.disclaimer) + '</div>' +
      '</div>');

    if (r.warnings && r.warnings.length) h.push('<div class="mt14">' + UI.alerts(r.warnings, 'warn', '结果校验提示') + '</div>');

    /* 雷达图 + 概览 */
    h.push('<div class="grid2 mt14">');
    h.push(UI.chartCard({
      title: '七类舞弊参考分值雷达图', sub: '刻度 0–100',
      caliber: '全科目 / 全量交易',
      body: UI.radarChart(r.cards, { size: 340 })
    }));
    h.push(UI.chartCard({
      title: '各类型参考区间', sub: '分值与区间（需人工复核后定级）',
      caliber: '加权评分卡',
      body: UI.barChart(r.cards.map(function (c) {
        return {
          label: c.name, value: c.total, text: c.total + ' · ' + c.band.label,
          color: c.total >= 80 ? '#7A1FA2' : c.total >= 60 ? '#D93025' : c.total >= 30 ? '#E8A317' : '#9B7BFF'
        };
      }), { labelWidth: 110, valueWidth: 116 })
    }));
    h.push('</div>');

    /* 评分卡明细 */
    h.push('<div class="card mt14"><div class="card-head"><div class="card-title">评分卡明细<span class="sub">每维度 0–5 分；点击行展开计分口径</span></div>' +
      '<div class="card-actions"><button class="btn btn-sm" id="btnExportScore">导出评分明细 CSV</button>' +
      '<button class="btn btn-sm" id="btnExplainScore">🤖 解释这个分数</button>' +
      '<button class="btn btn-sm btn-primary" id="btnToReport">生成报告草稿 →</button></div></div><div id="scoreTable"></div></div>');

    out.innerHTML = h.join('');

    /* 展平为行：舞弊类型 × 维度 */
    var rows = [];
    r.cards.forEach(function (c) {
      c.dims.forEach(function (d) {
        rows.push({
          typeCode: c.code, typeName: c.name, total: c.total, band: c.band,
          dimLabel: d.label, score: d.score, weight: d.weight, rawText: d.rawText, rule: d.rule,
          contribution: U.round(d.score * d.weight / 100 * 20, 1)
        });
      });
    });

    var api = UI.table(out.querySelector('#scoreTable'), {
      rows: rows,
      csvName: '舞弊可能性参考评分',
      pageSize: 40,
      expandable: true,
      defaultSort: 'total',
      defaultSortDir: 'desc',
      columns: [
        {
          key: 'typeName', title: '舞弊类型', width: 122,
          render: function (row) { return '<b>' + UI.esc(row.typeName) + '</b>'; }
        },
        {
          key: 'total', title: '参考分值', width: 84,
          render: function (row) { return '<b>' + row.total + '</b>'; },
          sortValue: function (row) { return row.total; },
          csv: function (row) { return row.total; }
        },
        {
          key: 'band', title: '参考区间', width: 96,
          render: function (row) { return UI.bandTag(row.band); },
          csv: function (row) { return row.band.text; }
        },
        { key: 'dimLabel', title: '评分维度', width: 130 },
        {
          key: 'score', title: '得分（0–5）', width: 130,
          render: function (row) { return UI.scoreBar(row.score, 5); },
          sortValue: function (row) { return row.score; },
          csv: function (row) { return row.score; }
        },
        { key: 'weight', title: '权重', width: 60, render: function (row) { return row.weight + '%'; }, csv: function (row) { return row.weight; } },
        {
          key: 'contribution', title: '加权贡献', width: 86,
          render: function (row) { return row.contribution + ' 分'; },
          sortValue: function (row) { return row.contribution; },
          csv: function (row) { return row.contribution; }
        },
        {
          key: 'rawText', title: '原始指标', width: 300,
          render: function (row) { return '<span class="small">' + UI.esc(row.rawText) + '</span>'; },
          csv: function (row) { return row.rawText; }
        }
      ],
      filters: [
        {
          key: 'type', label: '舞弊类型',
          options: r.cards.map(function (c) { return { value: c.code, label: c.name }; }),
          test: function (row, v) { return row.typeCode === v; }
        },
        {
          key: 'band', label: '参考区间',
          options: [{ value: 'low', label: '信号较弱' }, { value: 'mid', label: '信号中等' }, { value: 'high', label: '信号较强' }, { value: 'crit', label: '信号集中' }],
          test: function (row, v) { return row.band.level === v; }
        }
      ],
      expand: function (row) {
        return '<div class="evidence-box"><h5>计分口径（可复核）</h5><ul>' +
          '<li><b>原始指标</b>：' + UI.esc(row.rawText) + '</li>' +
          '<li><b>计分公式</b>：' + UI.esc(row.rule) + '</li>' +
          '<li><b>本维度得分</b>：' + row.score + ' / 5　<b>权重</b>：' + row.weight + '%　<b>加权贡献</b>：' + row.contribution + ' 分（满分 100 制）</li>' +
          '<li><b>该类型参考分值</b>：' + row.total + ' 分 —— ' + UI.esc(row.band.text) + '</li>' +
          '</ul><div class="small muted">权重可由岗位人员调整（见「查看/调整权重」）；调整后与历史评分不可直接比较。</div></div>';
      }
    });

    out.querySelector('#btnExportScore').addEventListener('click', function () { api.exportCSV(); });
    out.querySelector('#btnToReport').addEventListener('click', function () { App.go('report'); });
    out.querySelector('#btnExplainScore').addEventListener('click', function () { explainScore(r); });

    /* 顶部结论条里的一处安全隐患兜底：若 r.disclaimer 缺失则补 */
    if (!r.disclaimer) r.disclaimer = '以上分值与区间为参考值，需人工复核后定级。';
  }

  function explainScore(r) {
    var m = UI.modal({
      title: '评分解释（AI 辅助）',
      wide: true,
      body: '<div id="scAiOut">' + UI.loading('正在调用大模型解释评分…') + '</div>',
      footer: '<button class="btn" data-close>关闭</button><button class="btn" id="btnCopySc">复制</button>'
    });
    var o = m.body.querySelector('#scAiOut');
    App.llm.explainScore(r, {
      onDelta: function (acc) { o.innerHTML = '<div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + UI.esc(acc) + '</div>'; }
    }).then(function (res) {
      o.innerHTML = App.pages.risk.modeBanner(res) + '<div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + UI.esc(res.text) + '</div>';
      var cp = m.body.parentNode.querySelector('#btnCopySc');
      if (cp) cp.onclick = function () { UI.copy(res.text, '解释已复制'); };
    });
  }

  /* 权重调整 */
  function showWeights(mount) {
    var cur = App.state.scoreWeights || {};
    var body = ['<div class="small muted mb14">调整各维度权重后点击「应用并重算」。权重合计不为 100 时系统会自动归一化。请在设置后人工确认权重口径。</div>'];
    App.config.FRAUD_TYPES.forEach(function (ft) {
      var card = App.config.SCORE_CARD[ft.code];
      body.push('<div class="modal-section"><h4>' + UI.esc(ft.name) + '</h4>');
      card.dims.forEach(function (d) {
        var v = (cur[ft.code] && cur[ft.code][d.key] !== undefined) ? cur[ft.code][d.key] : d.weight;
        body.push('<label class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:5px">' +
          '<span style="flex:1;margin:0">' + UI.esc(d.label) + '</span>' +
          '<input class="input" style="width:90px;text-align:right" data-w="' + ft.code + '|' + d.key + '" value="' + v + '">' +
          '<span class="small muted" style="width:24px">%</span></label>');
      });
      body.push('</div>');
    });
    var m = UI.modal({
      title: '评分权重设置', wide: true, body: body.join(''),
      footer: '<button class="btn" data-close>取消</button><button class="btn" id="btnResetW">恢复默认</button><button class="btn btn-primary" id="btnApplyW">应用并重算</button>'
    });
    m.body.parentNode.querySelector('#btnApplyW').addEventListener('click', function () {
      var next = {};
      Array.prototype.forEach.call(m.body.querySelectorAll('[data-w]'), function (inp) {
        var k = inp.getAttribute('data-w').split('|');
        next[k[0]] = next[k[0]] || {};
        next[k[0]][k[1]] = U.num(inp.value, 0);
      });
      App.state.scoreWeights = next;
      m.close();
      run(mount);
    });
    m.body.parentNode.querySelector('#btnResetW').addEventListener('click', function () {
      App.state.scoreWeights = {};
      m.close();
      run(mount);
      UI.toast('权重已恢复默认', 'ok');
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
