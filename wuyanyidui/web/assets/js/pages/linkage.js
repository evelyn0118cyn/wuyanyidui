/* =============================================================
 * 页面：关联方核查（F3 linkage）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.linkage = {
    render: function (mount) {
      var S = App.state;
      if (!App.requireDataset(mount, '关联方核查')) return;

      var h = [];
      h.push(UI.divisionBar('助理辅助：比对 / 穿透 / 初筛　｜　人工决策：关联关系认定、是否构成利益输送'));

      var cal = S.caliber();
      h.push('<div class="caliber-bar"><span>本次使用口径：</span><b>供应商集中度 > ' + (U.num(cal.thresholds.supplier_share_limit) * 100) +
        '% · 客户收入占比 > ' + (U.num(cal.thresholds.customer_share_limit) * 100) + '% · 姓名相似编辑距离 ≤ ' +
        U.num(cal.thresholds.name_similarity_edit) + '</b></div>');

      h.push('<div class="card"><div class="card-head"><div class="card-title">四类关联核查<span class="sub">关键人员关联 · 股权穿透 · 频次规模异常 · 资金合同错配</span></div>' +
        '<div class="card-actions">' +
        '<button class="btn btn-sm" id="btnEquity">工商信息（' + ((S.linkage && S.linkage.equity) ? S.linkage.equity.length : 5) + ' 条）</button>' +
        '<button class="btn btn-sm btn-primary" id="btnRunLink">执行关联方核查</button>' +
        '</div></div>');
      h.push('<div class="small muted">比对企业档案：员工 ' + ((S.dataset.data.employees || []).length) + ' 人、客户 ' +
        ((S.dataset.data.customers || []).length) + ' 家、供应商 ' + ((S.dataset.data.suppliers || []).length) + ' 家、部门 ' +
        ((S.dataset.data.departments || []).length) + ' 个。</div>');
      if (S.stale.linkage) h.push(UI.alert('数据源已变化，建议重新执行关联方核查。', 'warn'));
      h.push('</div>');

      h.push('<div id="linkOut"></div>');
      mount.innerHTML = h.join('');

      mount.querySelector('#btnRunLink').addEventListener('click', function () { run(mount); });
      mount.querySelector('#btnEquity').addEventListener('click', function () { showEquity(mount); });

      if (S.linkage && S.linkage.ok) renderResult(mount, S.linkage);
      else mount.querySelector('#linkOut').innerHTML = UI.empty({
        icon: '⛓', title: '尚未执行关联方核查',
        desc: '点击「执行关联方核查」，助理将比对员工档案与客户/供应商的名称、法人、账号，做股权穿透、频次规模异常与资金合同错配四类核查。'
      });
    }
  };

  function run(mount) {
    var S = App.state;
    var out = mount.querySelector('#linkOut');
    out.innerHTML = UI.loading('正在进行关键人员比对、股权穿透与集中度分析…');
    setTimeout(function () {
      try {
        var r = App.linkage.run(S.dataset, { thresholds: S.caliber().thresholds });
        if (!r.ok) { out.innerHTML = UI.errorState(r.error); return; }
        App.state.set('linkage', r);
        renderResult(mount, r);
        UI.toast('关联方核查完成：' + r.totals.suspectCount + ' 个可疑主体', 'ok');
      } catch (e) {
        console.error(e);
        out.innerHTML = UI.errorState(e.message);
      }
    }, 30);
  }

  function renderResult(mount, r) {
    var out = mount.querySelector('#linkOut');
    var t = r.totals;
    var h = [];

    h.push('<div class="stat-row">' +
      UI.stat({ label: '可疑主体', value: t.suspectCount + ' 个', hint: '四类核查命中合计', tone: 'primary' }) +
      UI.stat({ label: '涉及交易金额', value: U.money(t.relatedTxnAmount), hint: '命中主体的交易合计' }) +
      UI.stat({ label: '较高置信', value: t.highConfidence + ' 个', hint: '存在硬证据或直接不一致', tone: 'mid', tip: '置信提示为参考，需人工核实工商信息' }) +
      r.typeStats.map(function (x) {
        return UI.stat({ label: x.name, value: x.count + ' 个', hint: typeHint(x.code) });
      }).join('') +
      '</div>');

    if (r.warnings.length) h.push(UI.alerts(r.warnings, 'warn', '结果校验提示'));

    /* 图表 */
    h.push('<div class="grid2">');
    h.push(UI.chartCard({
      title: '关联关系网络', sub: '节点=主体，连线=关联类型',
      caliber: '主数据 + 内置工商信息',
      body: UI.networkChart(r.graph, { width: 700, height: 380 })
    }));
    h.push(UI.chartCard({
      title: '交易对手集中度', sub: '前 12 大对手方（红色=命中关联核查）',
      caliber: '全部流水金额口径',
      body: UI.barChart(r.topCounterparties.map(function (x) {
        return {
          label: x.name, value: x.amount,
          text: U.money(x.amount) + '（' + (x.share * 100).toFixed(1) + '%）',
          color: x.isRelated ? '#D93025' : '#9B7BFF'
        };
      }), { labelWidth: 150, valueWidth: 132 }) +
        '<div class="chart-legend"><span><i style="background:#D93025"></i>命中关联核查</span><span><i style="background:#9B7BFF"></i>未命中</span></div>'
    }));
    h.push('</div>');

    /* 清单 */
    h.push('<div class="card mt14"><div class="card-head"><div class="card-title">关联方可疑清单<span class="sub">点击行展开命中依据与需人工核实事项</span></div>' +
      '<div class="card-actions"><button class="btn btn-sm" id="btnExportLink">导出可疑清单 CSV</button>' +
      '<button class="btn btn-sm btn-primary" id="btnToScore2">生成评分评估 →</button></div></div><div id="linkTable"></div></div>');

    out.innerHTML = h.join('');

    var api = UI.table(out.querySelector('#linkTable'), {
      rows: r.suspects,
      csvName: '关联方可疑清单',
      pageSize: 30,
      expandable: true,
      columns: [
        { key: 'id', title: '编号', width: 76, render: function (row) { return '<span class="mono">' + UI.esc(row.id) + '</span>'; } },
        {
          key: 'subject', title: '主体', width: 210,
          render: function (row) {
            return '<b>' + UI.esc(row.subject) + '</b><div class="small muted">' + UI.esc(row.subjectKind) +
              (row.legal ? '　法人：' + UI.esc(row.legal) : '') + '</div>';
          }
        },
        {
          key: 'typeCode', title: '关联类型', width: 158,
          render: function (row) { return '<span class="tag">' + UI.esc(typeName(row.typeCode)) + '</span>'; },
          csv: function (row) { return typeName(row.typeCode); }
        },
        {
          key: 'hits', title: '命中依据', width: 300,
          render: function (row) {
            return (row.hits || []).slice(0, 2).map(function (x) {
              return '<div class="small"><b>' + UI.esc(x.type) + '</b>：' + UI.esc(String(x.evidence).slice(0, 70)) + '</div>';
            }).join('');
          },
          csv: function (row) { return (row.hits || []).map(function (x) { return x.type + '：' + x.evidence; }).join(' | '); }
        },
        {
          key: 'confidence', title: '置信提示', width: 170,
          render: function (row) {
            var cls = String(row.confidence).indexOf('高') === 0 ? 'tag-high' : String(row.confidence).indexOf('较高') === 0 ? 'tag-mid' : 'tag-gray';
            return '<span class="tag ' + cls + '">' + UI.esc(row.confidence) + '</span>';
          }
        },
        { key: 'txnCount', title: '笔数', width: 56, type: 'num', csv: function (row) { return row.txnCount; } },
        { key: 'txnAmount', title: '累计金额', width: 106, type: 'num', render: function (row) { return U.moneyRaw(row.txnAmount); }, csv: function (row) { return row.txnAmount; } }
      ],
      filters: [
        {
          key: 'type', label: '关联类型',
          options: r.typeStats.map(function (x) { return { value: x.code, label: x.name }; }),
          test: function (row, v) { return row.typeCode === v; }
        },
        {
          key: 'conf', label: '置信度',
          options: [{ value: 'high', label: '高' }, { value: 'mid', label: '中' }],
          test: function (row, v) {
            var s = String(row.confidence);
            return v === 'high' ? (s.indexOf('高') === 0 || s.indexOf('较高') === 0) : s.indexOf('中') === 0;
          }
        }
      ],
      expand: function (row) { return detailHTML(row); }
    });

    out.querySelector('#btnExportLink').addEventListener('click', function () { api.exportCSV(); });
    out.querySelector('#btnToScore2').addEventListener('click', function () { App.go('score'); });
  }

  function detailHTML(s) {
    var h = [];
    h.push('<div class="evidence-box">');
    h.push('<h5>命中依据（' + UI.esc(typeName(s.typeCode)) + '）</h5><ul>');
    (s.hits || []).forEach(function (x) {
      h.push('<li><b>' + UI.esc(x.type) + '</b>：' + UI.esc(x.evidence) + '</li>');
    });
    h.push('</ul>');

    if (s.equityChain && s.equityChain.length) {
      h.push('<h5>股权穿透链条（' + s.depth + ' 层）</h5>');
      h.push('<div class="small" style="line-height:2">' + s.equityChain.map(function (c) {
        return '<span class="tag tag-line">' + UI.esc(c.company || '—') + '</span>' +
          (c.person ? ' ← <b>' + UI.esc(c.person) + '</b>（' + (c.share * 100).toFixed(1) + '%）' : '');
      }).join('　') + '</div>');
    }
    if (s.extraHits && s.extraHits.length) {
      h.push('<h5 class="mt8">附加命中（频次规模）</h5><ul>');
      s.extraHits.forEach(function (x) { h.push('<li><b>' + UI.esc(x.type) + '</b>：' + UI.esc(x.evidence) + '</li>'); });
      h.push('</ul>');
    }

    h.push('<h5 class="mt8">需人工核实的要点</h5><ul>');
    (s.needs || []).forEach(function (n) { h.push('<li>' + UI.esc(n) + '</li>'); });
    h.push('</ul>');
    h.push('<div class="small muted">关联关系是否成立、是否构成利益输送，须由岗位人员核实工商信息与访谈后判断。</div>');
    h.push('</div>');
    return h.join('');
  }

  function typeName(code) {
    return {
      key_personnel_relation: '关键人员关联',
      equity_penetration: '股权穿透',
      frequency_scale_anomaly: '频次规模异常',
      fund_contract_mismatch: '资金合同错配'
    }[code] || code;
  }
  function typeHint(code) {
    return {
      key_personnel_relation: '姓名/账号/身份证比对',
      equity_penetration: '股东链穿透',
      frequency_scale_anomaly: '集中度与频次偏离',
      fund_contract_mismatch: '主体/账户不一致'
    }[code] || '';
  }

  /* 工商信息查看/上传 */
  function showEquity(mount) {
    var S = App.state;
    var eq = (S.linkage && S.linkage.equity) || [];
    var body = [];
    body.push('<div class="small muted mb14">股权穿透依赖工商信息（股东结构）。系统内置 5 条示例数据用于演示；接入真实数据时可手工粘贴 JSON，或通过本地代理采集公开工商信息。</div>');
    if (eq.length) {
      body.push('<div class="table-wrap mb14"><table class="grid"><thead><tr><th>主体</th><th>股权链条</th><th>异常特征</th></tr></thead><tbody>');
      eq.forEach(function (n) {
        body.push('<tr><td>' + UI.esc(n.subject) + '</td><td class="small wrap" style="white-space:normal">' +
          (n.chain || []).map(function (c) { return UI.esc(c.company || '') + (c.person ? ' ← ' + UI.esc(c.person) + '(' + (c.share * 100).toFixed(0) + '%)' : ''); }).join('<br>') +
          '</td><td class="small wrap" style="white-space:normal">' + UI.esc((n.flags || []).join('；')) + '</td></tr>');
      });
      body.push('</tbody></table></div>');
    }
    body.push('<div class="modal-section"><h4>粘贴工商信息（JSON）</h4>' +
      '<textarea class="input" id="eqInput" style="width:100%;height:150px" placeholder=\'[{"subject":"某供应商","kind":"供应商","chain":[{"company":"某供应商","person":"张三","share":0.8,"level":1}],"flags":["新设"]}]\'></textarea>' +
      '<div class="hint">粘贴后点击「应用并重算」，将替换内置示例工商信息。</div></div>');

    var m = UI.modal({
      title: '工商信息（股权穿透数据源）',
      wide: true, body: body.join(''),
      footer: '<button class="btn" data-close>关闭</button><button class="btn" id="btnFetchEq">采集公开工商信息</button><button class="btn btn-primary" id="btnApplyEq">应用并重算</button>'
    });

    m.body.parentNode.querySelector('#btnApplyEq').addEventListener('click', function () {
      var txt = m.body.querySelector('#eqInput').value.trim();
      if (!txt) { UI.toast('请先粘贴 JSON', 'warn'); return; }
      var parsed;
      try { parsed = JSON.parse(txt); } catch (e) { UI.toast('JSON 格式错误：' + e.message, 'err'); return; }
      if (!Array.isArray(parsed)) { UI.toast('应为数组格式', 'err'); return; }
      var r = App.linkage.run(App.state.dataset, { thresholds: App.state.caliber().thresholds, equity: parsed });
      if (!r.ok) { UI.toast(r.error, 'err'); return; }
      App.state.set('linkage', r);
      m.close();
      renderResult(mount, r);
      UI.toast('已应用新的工商信息', 'ok');
    });

    m.body.parentNode.querySelector('#btnFetchEq').addEventListener('click', function () {
      var url = prompt('请输入公开工商信息页面网址（示例：https://www.qcc.com/…）');
      if (!url) return;
      var st = App.state.server;
      if (!st || !st.online) { UI.toast('网页采集需要本地代理，请先启动 start.bat', 'err'); return; }
      fetch(st.base + '/api/fetch-page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) { UI.toast(j.error || '采集失败', 'err'); return; }
        UI.toast('已采集页面：' + (j.title || ''), 'ok');
        m.body.insertAdjacentHTML('afterbegin', UI.alert('采集成功：<b>' + UI.esc(j.title || '') + '</b><div class="small" style="max-height:120px;overflow:auto;margin-top:6px">' +
          UI.esc(String(j.text || '').slice(0, 600)) + '…</div><div class="small muted">采集内容需人工解析核对后再填入股权链条，系统不自动生成关联关系认定。</div>', 'ok'));
      }).catch(function (e) { UI.toast('采集失败：' + e.message, 'err'); });
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
