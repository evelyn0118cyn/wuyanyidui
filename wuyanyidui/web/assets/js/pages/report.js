/* =============================================================
 * 页面：报告草稿（F6 report_draft / chart_report）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.report = {
    render: function (mount) {
      var S = App.state;
      if (!App.requireDataset(mount, '报告草稿')) return;

      var mem = App.memory.load();
      var tpl = mem.reportTemplate || {};
      var h = [];
      h.push(UI.divisionBar('助理辅助：起草 / 排版 / 图表　｜　人工决策：结论、定稿、签发、上报'));

      /* 强制声明 */
      h.push('<div class="disclaimer-lock"><span class="lock-badge">🔒 不可删除、不可编辑</span>' +
        '<b>强制声明</b><br>' + UI.esc(App.config.MANDATORY_DISCLAIMER) + '</div>');

      /* 模板设置 */
      h.push('<div class="card mt14"><div class="card-head"><div class="card-title">报告模板<span class="sub">标题、单位、复核人可自定义（记忆保存）</span></div>' +
        '<div class="card-actions"><button class="btn btn-sm btn-primary" id="btnGenReport">生成报告初稿</button></div></div>');
      h.push('<div class="grid3">' +
        '<label class="field"><span>报告标题</span><input class="input" id="rpTitle" value="' + UI.esc(tpl.title || '舞弊调查分析报告（初稿）') + '"></label>' +
        '<label class="field"><span>被调查单位</span><input class="input" id="rpOrg" value="' + UI.esc(tpl.orgName || (S.dataset.meta && S.dataset.meta.company) || '') + '"></label>' +
        '<label class="field"><span>复核人</span><input class="input" id="rpReviewer" value="' + UI.esc(tpl.reviewer || '') + '"></label>' +
        '</div>');
      h.push('<div class="flex-gap">' +
        '<label class="switch"><input type="checkbox" id="rpCharts"' + (tpl.includeCharts !== false ? ' checked' : '') + '><span class="track"></span><span>包含图表</span></label>' +
        '<label class="switch"><input type="checkbox" id="rpScore"' + (tpl.includeScorecard !== false ? ' checked' : '') + '><span class="track"></span><span>包含评分卡</span></label>' +
        '<label class="switch"><input type="checkbox" id="rpQuality"' + (tpl.includeQuality !== false ? ' checked' : '') + '><span class="track"></span><span>包含数据质量说明</span></label>' +
        '</div>');

      var missing = [];
      if (!S.riskAlert || !S.riskAlert.ok) missing.push('风险信号识别');
      if (!S.clueSort || !S.clueSort.ok) missing.push('线索台账');
      if (!S.linkage || !S.linkage.ok) missing.push('关联方核查');
      if (!S.aggregation || !S.aggregation.ok) missing.push('数据汇总');
      if (!S.scorecard || !S.scorecard.ok) missing.push('评分评估');
      if (missing.length) h.push('<div class="mt14">' + UI.alert('以下模块尚未完成，报告对应章节将为空：<b>' + missing.join('、') + '</b>。建议先完成全部模块再生成报告。', 'warn') + '</div>');
      h.push('</div>');

      h.push('<div id="reportOut"></div>');
      mount.innerHTML = h.join('');

      mount.querySelector('#btnGenReport').addEventListener('click', function () { generate(mount, false); });

      if (S.report && S.report.ok) renderResult(mount, S.report);
      else mount.querySelector('#reportOut').innerHTML = UI.empty({
        icon: '▦', title: '尚未生成报告',
        desc: '点击「生成报告初稿」，助理将汇总前序模块结果，按十节结构成文，并在结论段留空供岗位人员填写。'
      });
    }
  };

  function readTemplate() {
    return {
      title: document.getElementById('rpTitle').value.trim() || '舞弊调查分析报告（初稿）',
      orgName: document.getElementById('rpOrg').value.trim(),
      reviewer: document.getElementById('rpReviewer').value.trim(),
      includeCharts: document.getElementById('rpCharts').checked,
      includeScorecard: document.getElementById('rpScore').checked,
      includeQuality: document.getElementById('rpQuality').checked
    };
  }

  function generate(mount, withAI) {
    var S = App.state;
    var out = mount.querySelector('#reportOut');
    var tpl = readTemplate();
    App.memory.save({ reportTemplate: tpl });
    out.innerHTML = UI.loading(withAI ? '正在生成报告并让大模型润色叙述…' : '正在汇总前序结果并起草报告…');

    setTimeout(function () {
      try {
        var rep = App.report.build({
          riskAlert: S.riskAlert, clueSort: S.clueSort, linkage: S.linkage,
          aggregation: S.aggregation, scorecard: S.scorecard,
          data: S.dataset.data, meta: S.dataset.meta
        }, { template: tpl });

        if (!withAI) {
          App.state.set('report', rep);
          renderResult(mount, rep);
          UI.toast('报告初稿已生成（' + rep.reportNo + '）', 'ok');
          return;
        }

        /* 大模型润色叙述段 */
        var payload = buildNarrativePayload(S);
        App.llm.composeReportSection(payload).then(function (res) {
          rep.llmNarrative = res.text;
          rep.llmMode = res.mode;
          App.state.set('report', rep);
          renderResult(mount, rep);
          UI.toast(res.mode === 'llm' ? '报告已生成，并附 AI 叙述段' : '报告已生成（AI 叙述降级为本地模式）', res.mode === 'llm' ? 'ok' : 'warn');
        });
      } catch (e) {
        console.error(e);
        out.innerHTML = UI.errorState(e.message);
      }
    }, 30);
  }

  function buildNarrativePayload(S) {
    var lines = ['【风险信号】共 ' + (S.riskAlert ? S.riskAlert.totals.signalCount : 0) + ' 条，参考高风险 ' +
      (S.riskAlert ? S.riskAlert.totals.byLevel.high : 0) + ' 条'];
    if (S.riskAlert) {
      S.riskAlert.ruleStats.filter(function (x) { return x.count > 0; }).slice(0, 6).forEach(function (x) {
        lines.push('- ' + x.code + ' ' + x.name + '：' + x.count + ' 条，累计 ' + U.money(x.amount));
      });
    }
    if (S.clueSort && S.clueSort.ok) {
      lines.push('【线索】共 ' + S.clueSort.totals.clueCount + ' 条，优先级中以上 ' + (S.clueSort.totals.highPriority + S.clueSort.totals.midPriority) + ' 条');
      S.clueSort.clues.slice(0, 5).forEach(function (c) {
        lines.push('- ' + c.id + ' ' + c.counterparty + ' / ' + c.matter + '：' + c.txnCount + ' 笔 ' + U.money(c.amount) + '，链路' + c.chain.status + '，业务' + c.cross.status);
      });
    }
    if (S.linkage && S.linkage.ok) {
      lines.push('【关联方】可疑主体 ' + S.linkage.totals.suspectCount + ' 个');
      S.linkage.suspects.slice(0, 4).forEach(function (s) {
        lines.push('- ' + s.subject + '（' + s.type + '）：' + (s.hits[0] ? s.hits[0].evidence : ''));
      });
    }
    if (S.scorecard && S.scorecard.ok) {
      lines.push('【评分】综合参考分值 ' + S.scorecard.overall + '（' + S.scorecard.overallText + '）');
      S.scorecard.cards.forEach(function (c) { lines.push('- ' + c.name + '：' + c.total); });
    }
    if (S.aggregation && S.aggregation.ok) {
      lines.push('【数据质量】问题 ' + S.aggregation.qualityTotals.issueTypes + ' 类；借贷平衡：' + (S.aggregation.balance.balanced ? '平衡' : '差额 ' + U.moneyRaw(S.aggregation.balance.diff)));
    }
    return lines.join('\n');
  }

  function renderResult(mount, rep) {
    var out = mount.querySelector('#reportOut');
    var s = rep.sections;
    var h = [];

    h.push('<div class="stat-row">' +
      UI.stat({ label: '报告编号', value: rep.reportNo, small: true, hint: rep.generatedAt }) +
      UI.stat({ label: '主要发现', value: s.s3.findings.length + ' 条' }) +
      UI.stat({ label: '线索条目', value: s.s4.rows.length + ' 条' }) +
      UI.stat({ label: '关联方条目', value: s.s5.rows.length + ' 个' }) +
      UI.stat({ label: '证据缺口', value: s.s7.gaps.length + ' 项', tone: s.s7.gaps.length ? 'mid' : 'low' }) +
      UI.stat({ label: '核查建议', value: s.s8.items.length + ' 条' }) +
      '</div>');

    if (rep.missingModules.length) h.push(UI.alert('报告缺少模块：' + UI.esc(rep.missingModules.join('、')) + '，相关章节为空。', 'warn'));

    /* 章节完成度 */
    h.push('<div class="grid2">');
    h.push('<div class="card"><div class="card-head"><div class="card-title">报告结构（十节）</div></div><div class="report-outline">' +
      [
        ['一', s.s1.title.replace(/^一、/, ''), '已完成'],
        ['二', s.s2.title.replace(/^二、/, ''), '已完成'],
        ['三', s.s3.title.replace(/^三、/, ''), s.s3.findings.length + ' 条发现'],
        ['四', s.s4.title.replace(/^四、/, ''), s.s4.rows.length + ' 行'],
        ['五', s.s5.title.replace(/^五、/, ''), s.s5.rows.length + ' 行'],
        ['六', s.s6.title.replace(/^六、/, ''), rep.includeScorecard ? (s.s6.cards.length + ' 类') : '已关闭'],
        ['七', s.s7.title.replace(/^七、/, ''), s.s7.gaps.length + ' 项缺口'],
        ['八', s.s8.title.replace(/^八、/, ''), s.s8.items.length + ' 条'],
        ['九', s.s9.title.replace(/^九、/, ''), rep.includeQuality ? '已包含' : '已关闭'],
        ['十', s.s10.title.replace(/^十、/, ''), '强制声明'],
        ['—', '结论（由调查人员填写）', '<span class="tag tag-mid">留空待填</span>']
      ].map(function (x) {
        return '<div class="ro-item"><span class="ro-n">' + x[0] + '</span><span>' + UI.esc(x[1]) + '</span>' +
          '<span class="ro-state muted">' + x[2] + '</span></div>';
      }).join('') + '</div></div>');

    /* 导出与预览 */
    h.push('<div class="card"><div class="card-head"><div class="card-title">导出与预览</div></div>' +
      '<div class="small muted mb8">报告为初稿：结论段与签署栏留空，须由岗位人员完成定稿与签发。</div>' +
      '<div class="flex-gap">' +
      '<button class="btn btn-sm btn-primary" id="btnDlHtml">下载报告（.html，可打印为 PDF）</button>' +
      '<button class="btn btn-sm" id="btnDlMd">下载 Markdown（.md）</button>' +
      '<button class="btn btn-sm" id="btnDlCsv">下载线索台账附表（.csv）</button>' +
      '<button class="btn btn-sm" id="btnPrint">打印 / 另存 PDF</button>' +
      '<button class="btn btn-sm" id="btnPreview">在页面内预览</button>' +
      '<button class="btn btn-sm" id="btnAiNarr">🤖 AI 润色叙述段</button>' +
      '</div>' +
      '<div class="mt14"><div class="disclaimer-lock"><span class="lock-badge">🔒</span>' + UI.esc(rep.disclaimer) + '</div></div>' +
      '</div>');
    h.push('</div>');

    /* AI 叙述段 */
    if (rep.llmNarrative) {
      h.push('<div class="card mt14"><div class="card-head"><div class="card-title">AI 辅助叙述段<span class="sub">' +
        (rep.llmMode === 'llm' ? '大模型生成' : '本地模式生成') + '</span></div></div>' +
        UI.alert('该段文字由' + (rep.llmMode === 'llm' ? '大模型' : '内置规则') + '基于本报告结构化结果生成，仅供文字参考，<b>数据以报告表格为准</b>。', 'info') +
        '<div style="white-space:pre-wrap;font-size:13px;line-height:1.85;background:#FCFBFF;border:1px solid #E7E3F5;border-radius:8px;padding:12px 15px">' +
        UI.esc(rep.llmNarrative) + '</div></div>');
    }

    /* 主要发现预览 */
    h.push('<div class="card mt14"><div class="card-head"><div class="card-title">主要发现（预览）</div></div>');
    s.s3.findings.forEach(function (f) {
      h.push('<div class="kb-hit"><div class="kb-title">' + f.no + '. ' + UI.esc(f.title) + '</div>' +
        '<div class="kb-body"><b>数据依据</b>：' + UI.esc(f.basis) + '<br><b>命中规则</b>：' + UI.esc(f.rule) + '<br>' + UI.esc(f.detail) + '</div></div>');
    });
    h.push('</div>');

    out.innerHTML = h.join('');

    /* 事件 */
    out.querySelector('#btnDlHtml').addEventListener('click', function () {
      var html = App.report.toHTML(rep);
      var ok = App.dataSource.download('舞弊调查分析报告_' + rep.reportNo + '.html', html, 'text/html');
      UI.toast(ok ? '报告已下载，双击可打开、Ctrl+P 可打印为 PDF' : '当前环境不允许下载', ok ? 'ok' : 'err');
    });
    out.querySelector('#btnDlMd').addEventListener('click', function () {
      var md = App.report.toMarkdown(rep);
      var ok = App.dataSource.download('舞弊调查分析报告_' + rep.reportNo + '.md', md, 'text/markdown');
      UI.toast(ok ? 'Markdown 已下载' : '当前环境不允许下载', ok ? 'ok' : 'err');
    });
    out.querySelector('#btnDlCsv').addEventListener('click', function () {
      var rows = s.s4.rows;
      if (!rows.length) { UI.toast('附表为空', 'warn'); return; }
      var csv = App.dataSource.toCSV(rows, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], s.s4.headers);
      var ok = App.dataSource.download('报告附表_线索台账_' + rep.reportNo + '.csv', csv, 'text/csv');
      UI.toast(ok ? '附表已下载' : '当前环境不允许下载', ok ? 'ok' : 'err');
    });
    out.querySelector('#btnPreview').addEventListener('click', function () {
      var html = App.report.toHTML(rep);
      var m = UI.modal({
        title: '报告预览 · ' + rep.reportNo, wide: true,
        body: '<iframe class="report-frame" sandbox="" srcdoc="' + UI.esc(html) + '"></iframe>',
        footer: '<button class="btn" data-close>关闭</button>'
      });
      m.el.style.maxWidth = '1000px';
    });
    out.querySelector('#btnPrint').addEventListener('click', function () {
      var html = App.report.toHTML(rep);
      var w = window.open('', '_blank');
      if (!w) { UI.toast('浏览器拦截了新窗口，请改用「下载报告」', 'err'); return; }
      w.document.write(html);
      w.document.close();
      setTimeout(function () { try { w.print(); } catch (e) {} }, 400);
    });
    out.querySelector('#btnAiNarr').addEventListener('click', function () {
      generate(mount, true);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
