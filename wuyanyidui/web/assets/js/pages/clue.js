/* =============================================================
 * 页面：线索台账（F2 clue_sort）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.clue = {
    render: function (mount) {
      var S = App.state;
      if (!App.requireDataset(mount, '线索台账')) return;

      var h = [];
      h.push(UI.divisionBar('助理辅助：归集 / 串联 / 去重 / 排序 / 给理由　｜　人工决策：线索取舍、核查顺序、调查方向'));

      var cal = S.caliber();
      h.push('<div class="caliber-bar"><span>本次使用口径：</span><b>' + UI.esc(cal.echo) + '</b></div>');

      h.push('<div class="card"><div class="card-head"><div class="card-title">线索归集<span class="sub">以「对手方 + 事项 + 时间窗口」聚合信号</span></div>' +
        '<div class="card-actions">' +
        '<select class="select" id="selTiebreak"><option value="weight">排序：综合权重优先</option><option value="amount">排序：金额优先</option></select>' +
        '<button class="btn btn-sm btn-primary" id="btnRunClue">生成线索台账</button>' +
        '</div></div>');
      if (!S.riskAlert || !S.riskAlert.ok) {
        h.push(UI.alert('线索台账依赖「风险信号识别」的结果。请先到「风险信号识别」页执行筛查。', 'warn'));
      } else if (S.stale.clueSort) {
        h.push(UI.alert('风险信号或关联方结果已更新，本页线索台账可能已过期，建议重新生成。', 'warn'));
      }
      h.push('<div class="small muted">排序权重：金额 ' + U.num(cal.thresholds.clueWeight_amount) + '% · 规则种类 ' +
        U.num(cal.thresholds.clueWeight_rules) + '% · 关联方命中 ' + U.num(cal.thresholds.clueWeight_related) +
        '% · 链路完整性 ' + U.num(cal.thresholds.clueWeight_chain) + '%（可在「风险信号识别 · 阈值设置」中调整）</div>');
      h.push('</div>');

      h.push('<div id="clueOut"></div>');
      mount.innerHTML = h.join('');

      mount.querySelector('#btnRunClue').addEventListener('click', function () {
        var tiebreak = mount.querySelector('#selTiebreak').value;
        run(mount, tiebreak);
      });

      if (S.clueSort && S.clueSort.ok) {
        mount.querySelector('#selTiebreak').value = S.clueSort.tiebreak || 'weight';
        renderResult(mount, S.clueSort);
      } else {
        mount.querySelector('#clueOut').innerHTML = UI.empty({
          icon: '☰', title: '尚未生成线索台账',
          desc: S.riskAlert && S.riskAlert.ok
            ? '当前有 ' + S.riskAlert.totals.signalCount + ' 条风险信号，点击「生成线索台账」按对手方与事项归并为可核查的线索卡片。'
            : '请先完成「风险信号识别」。'
        });
      }
    }
  };

  function run(mount, tiebreak) {
    var S = App.state;
    var out = mount.querySelector('#clueOut');
    if (!S.riskAlert || !S.riskAlert.ok) { UI.toast('请先执行风险信号识别', 'err'); return; }
    out.innerHTML = UI.loading('正在归集线索、追踪资金链路、做四流交叉核对…');
    setTimeout(function () {
      try {
        var r = App.clueSort.run(S.riskAlert, S.dataset, {
          thresholds: S.caliber().thresholds,
          linkage: S.linkage,
          tiebreak: tiebreak
        });
        if (!r.ok) { out.innerHTML = UI.errorState(r.error); return; }
        App.state.set('clueSort', r);
        renderResult(mount, r);
        UI.toast('已生成 ' + r.totals.clueCount + ' 条线索', 'ok');
      } catch (e) {
        console.error(e);
        out.innerHTML = UI.errorState(e.message);
      }
    }, 30);
  }

  function renderResult(mount, r) {
    var out = mount.querySelector('#clueOut');
    var t = r.totals;
    var h = [];

    h.push('<div class="stat-row">' +
      UI.stat({ label: '线索总数', value: t.clueCount + ' 条', hint: '归并后', tone: 'primary' }) +
      UI.stat({ label: '累计金额', value: U.money(t.totalAmount), hint: '线索涉及流水合计' }) +
      UI.stat({ label: '参考优先级高', value: t.highPriority + ' 条', hint: '建议优先核查', tone: 'high', tip: '参考值，需人工复核' }) +
      UI.stat({ label: '参考优先级中', value: t.midPriority + ' 条', hint: '纳入核查范围', tone: 'mid' }) +
      UI.stat({ label: '关联方命中', value: t.relatedHit + ' 条', hint: '线索对手方命中关联方核查', tone: t.relatedHit ? 'mid' : '' }) +
      '</div>');

    /* 链路与业务支撑状态 */
    h.push('<div class="caliber-bar" style="display:block;line-height:1.9">' +
      '<div><b>资金链路状态</b>：' +
      '<span class="tag tag-low">完整 ' + (r.chainStats['完整'] || 0) + '</span> ' +
      '<span class="tag tag-mid">断点 ' + (r.chainStats['断点'] || 0) + '</span> ' +
      '<span class="tag tag-high">疑似回流 ' + (r.chainStats['疑似回流'] || 0) + '</span>' +
      '　<b style="margin-left:14px">业务支撑状态</b>：' +
      '<span class="tag tag-low">基本匹配 ' + r.crossStats.ok + '</span> ' +
      '<span class="tag tag-high">有资金无业务 ' + r.crossStats.has_fund_no_biz + '</span> ' +
      '<span class="tag tag-mid">金额不匹配 ' + r.crossStats.amount_mismatch + '</span>' +
      '</div>' +
      '<div class="small muted">资金链路与业务支撑均为特征提示，不构成定性依据。</div>' +
      '</div>');

    /* 合并提示 */
    if (r.mergeNotes && r.mergeNotes.length) {
      h.push(UI.alerts(r.mergeNotes.slice(0, 6).map(function (m) {
        return '「' + UI.esc(m.counterparty) + '」涉及 ' + m.matters.length + ' 个事项（' + UI.esc(m.matter || m.matters.join('/')) + '），' + m.clueIds.join(' / ') + '，合计 ' + U.money(m.totalAmount) + ' —— ' + UI.esc(m.note);
      }), 'info', '同对手方合并提示（' + r.mergeNotes.length + ' 组）'));
    }

    /* 台账表 */
    h.push('<div class="card mt14"><div class="card-head"><div class="card-title">线索台账<span class="sub">点击行展开排序理由、资金链路与四流核对</span></div>' +
      '<div class="card-actions"><button class="btn btn-sm" id="btnExportClue">导出线索台账 CSV</button>' +
      '<button class="btn btn-sm btn-primary" id="btnToScore">生成评分评估 →</button></div></div><div id="clueTable"></div></div>');

    out.innerHTML = h.join('');

    var api = UI.table(out.querySelector('#clueTable'), {
      rows: r.clues,
      csvName: '线索台账',
      pageSize: 30,
      expandable: true,
      columns: [
        { key: 'id', title: '线索编号', width: 88, render: function (row) { return '<span class="mono">' + UI.esc(row.id) + '</span>'; } },
        {
          key: 'counterparty', title: '线索摘要', width: 240,
          render: function (row) {
            return '<b>' + UI.esc(row.counterparty) + '</b>' + (row.isPerson ? ' <span class="tag tag-mid">个人</span>' : '') +
              (row.relatedHit ? ' <span class="tag tag-high" title="' + UI.esc(row.relatedType) + '">关联方</span>' : '') +
              '<div class="small muted">事项：' + UI.esc(row.matter) + '　命中：' + row.ruleCodes.join('/') + '</div>';
          },
          csv: function (row) { return row.counterparty + ' / ' + row.matter; }
        },
        { key: 'txnCount', title: '笔数', width: 58, type: 'num', csv: function (row) { return row.txnCount; } },
        { key: 'amount', title: '累计金额', width: 106, type: 'num', render: function (row) { return U.moneyRaw(row.amount); }, csv: function (row) { return row.amount; } },
        {
          key: 'dateStart', title: '时间跨度', width: 176,
          render: function (row) { return '<span class="small">' + UI.esc(row.dateStart) + ' ~ ' + UI.esc(row.dateEnd) + '</span><div class="small muted">' + row.spanDays + ' 天</div>'; },
          csv: function (row) { return row.dateStart + '~' + row.dateEnd + '(' + row.spanDays + '天)'; }
        },
        {
          key: 'ruleCodes', title: '命中规则', width: 118,
          render: function (row) { return row.ruleCodes.map(function (c) { return '<span class="tag">' + c + '</span>'; }).join(' '); },
          csv: function (row) { return row.ruleCodes.join('/'); }
        },
        { key: 'chain', title: '资金链路', width: 92, render: function (row) { return UI.chainTag(row.chain.status); }, csv: function (row) { return row.chain.status; }, sortValue: function (row) { return ({ '疑似回流': 3, '断点': 2, '完整': 1 })[row.chain.status] || 0; } },
        { key: 'cross', title: '业务支撑', width: 106, render: function (row) { return UI.crossTag(row.cross.status); }, csv: function (row) { return row.cross.status; } },
        {
          key: 'fourFlow', title: '四流合一', width: 96,
          render: function (row) {
            var s = row.fourFlow.score;
            var cls = s >= 80 ? 'tag-low' : s >= 50 ? 'tag-mid' : 'tag-high';
            return '<span class="tag ' + cls + '">' + s + ' 分</span>';
          },
          csv: function (row) { return row.fourFlow.score + '分：' + (row.fourFlow.missing.join('；') || '要素齐全'); }
        },
        {
          key: 'priority', title: '参考优先级', width: 96,
          render: function (row) {
            return '<b>' + row.priority + '</b> ' + UI.riskTag(row.priorityLevel, true);
          },
          csv: function (row) { return row.priority + '(' + row.priorityLevel + ')'; }
        }
      ],
      filters: [
        {
          key: 'prio', label: '优先级',
          options: [{ value: 'high', label: '高' }, { value: 'mid', label: '中' }, { value: 'low', label: '低' }],
          test: function (row, v) { return row.priorityLevel === v; }
        },
        {
          key: 'chain', label: '资金链路',
          options: [{ value: '疑似回流', label: '疑似回流' }, { value: '断点', label: '断点' }, { value: '完整', label: '完整' }],
          test: function (row, v) { return row.chain.status === v; }
        },
        {
          key: 'cross', label: '业务支撑',
          options: [{ value: '有资金无业务', label: '有资金无业务' }, { value: '金额不匹配', label: '金额不匹配' }, { value: '基本匹配', label: '基本匹配' }],
          test: function (row, v) { return row.cross.status === v; }
        },
        {
          key: 'rel', label: '关联方',
          options: [{ value: 'y', label: '仅关联方命中' }],
          test: function (row, v) { return v === 'y' ? row.relatedHit : true; }
        }
      ],
      expand: function (row) { return detailHTML(row); }
    });

    out.querySelector('#btnExportClue').addEventListener('click', function () { api.exportCSV(); });
    out.querySelector('#btnToScore').addEventListener('click', function () { App.go('score'); });
  }

  /* 线索详情 */
  function detailHTML(c) {
    var h = [];
    h.push('<div class="evidence-box">');
    h.push('<h5>排序理由（可解释，可被人工否决）</h5><ul>');
    c.reasons.forEach(function (x) { h.push('<li>' + UI.esc(x) + '</li>'); });
    h.push('</ul>');

    h.push('<div class="grid2">');
    /* 资金链路 */
    h.push('<div><h5>资金链路追踪（fund_chain_tracing）· ' + UI.chainTag(c.chain.status) + '</h5><ul>');
    c.chain.notes.forEach(function (n) { h.push('<li>' + UI.esc(n) + '</li>'); });
    h.push('</ul><div class="kv">流入 ' + U.money(c.chain.inflow) + '　流出 ' + U.money(c.chain.outflow) +
      '　关联凭证 ' + c.chain.voucherCount + ' 张　无凭证 ' + c.chain.noVoucherCount + ' 笔</div>');
    h.push('<div class="mt8">' + UI.networkChart({ nodes: c.chain.nodes, edges: c.chain.edges }, { width: 520, height: 260 }) + '</div>');
    h.push('</div>');

    /* 业务交叉 */
    h.push('<div><h5>资金—业务交叉核对（fund_business_crosscheck）· ' + UI.crossTag(c.cross.status) + '</h5>');
    h.push('<div class="kv">资金金额 ' + U.money(c.cross.fundAmount) + '（' + c.cross.fundCount + ' 笔）　凭证金额 ' +
      U.money(c.cross.bizAmount) + '（' + c.cross.bizCount + ' 行）</div>');
    if (c.cross.gaps.length) { h.push('<ul>' + c.cross.gaps.map(function (g) { return '<li>' + UI.esc(g) + '</li>'; }).join('') + '</ul>'); }
    if (c.cross.notes.length) { h.push('<ul>' + c.cross.notes.map(function (g) { return '<li class="muted">' + UI.esc(g) + '</li>'; }).join('') + '</ul>'); }

    /* 四流 */
    h.push('<h5 class="mt8">四流合一检查（four_flow_check）· ' + c.fourFlow.score + ' 分</h5>');
    h.push('<div class="table-wrap"><table class="grid"><thead><tr><th>流向</th><th>有支撑</th><th>缺支撑</th></tr></thead><tbody>');
    c.fourFlow.flows.forEach(function (f) {
      h.push('<tr><td>' + UI.esc(f.name) + '</td><td class="num">' + f.ok + '</td><td class="num"' + (f.miss ? ' style="color:#D93025"' : '') + '>' + f.miss + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<div class="small muted">' + UI.esc(c.fourFlow.conclusion) + '</div>');
    h.push('</div>');
    h.push('</div>');

    /* 建议核查方向 */
    h.push('<h5 class="mt8">建议核查方向（调查方向建议，非处置建议）</h5><ul>');
    c.directions.forEach(function (d) { h.push('<li>' + UI.esc(d) + '</li>'); });
    h.push('</ul>');

    h.push('<div class="flex-gap mt8">' +
      '<button class="btn btn-sm" data-clue-ai="' + UI.esc(c.id) + '">🤖 生成核查摘要（AI）</button>' +
      '<span class="small muted">线索取舍与核查顺序由岗位人员决定</span></div>');
    h.push('</div>');

    setTimeout(function () {
      var btn = document.querySelector('[data-clue-ai="' + c.id + '"]');
      if (btn) btn.addEventListener('click', function () { explainClue(c); });
    }, 0);
    return h.join('');
  }

  function explainClue(c) {
    var m = UI.modal({
      title: '线索核查摘要（AI 辅助）· ' + c.id,
      wide: true,
      body: '<div id="clueAiOut">' + UI.loading('正在生成核查摘要…') + '</div>',
      footer: '<button class="btn" data-close>关闭</button><button class="btn" id="btnCopyClue">复制</button>'
    });
    var out = m.body.querySelector('#clueAiOut');
    App.llm.explainClue(c, {
      onDelta: function (acc) { out.innerHTML = '<div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + UI.esc(acc) + '</div>'; }
    }).then(function (r) {
      out.innerHTML = App.pages.risk.modeBanner(r) + '<div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + UI.esc(r.text) + '</div>';
      var cp = m.body.parentNode.querySelector('#btnCopyClue');
      if (cp) cp.onclick = function () { UI.copy(r.text, '摘要已复制'); };
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
