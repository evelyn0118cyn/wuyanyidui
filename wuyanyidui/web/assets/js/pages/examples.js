/* =============================================================
 * 页面：测试示例（强制内置）
 * 内置可一键运行的演示样例 + 自检用例，用于验收与回归
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  var G = typeof window !== 'undefined' ? window : globalThis;
  App.pages = App.pages || {};

  /* 内置样例：每项含"干什么、期望什么、判定方法" */
  var CASES = [
    {
      id: 'EX-01',
      title: '虚构交易识别：整年固定金额、期末、夜间、无凭证、收款方为自然人',
      scene: '供应商付费场景中，发现同一自然人对手方在 4 个季度末各收到 100 万元，金额为整数、记账时间 23:41、无对应记账凭证。',
      expect: '这 4 笔应同时命中 R01 大额、R02 整数、R04 期末突击、R05 个人卡、R08 非工作时间、R09 无业务支撑，并被标记为参考高风险。',
      run: function () {
        var S = App.state;
        if (!S.riskAlert || !S.riskAlert.ok) return { ok: false, msg: '请先执行「风险信号识别」或点击下方「运行全部样例」。' };
        var target = S.riskAlert.signals.filter(function (s) {
          return s.amount === 1000000 && s.counterparty_is_person && s.ruleCodes.indexOf('R09') >= 0 && s.ruleCodes.indexOf('R04') >= 0;
        });
        var high = target.filter(function (s) { return s.riskLevel === 'high'; });
        var lines = ['命中 ' + target.length + ' 笔（参考高风险 ' + high.length + ' 笔）：'];
        target.slice(0, 6).forEach(function (s) {
          lines.push('  · ' + s.txn_date + ' ' + s.txn_time + ' ' + U.money(s.amount) + ' → ' + s.counterparty + '　规则 ' + s.ruleCodes.join('/') + '　等级 ' + s.riskLabel);
        });
        return { ok: target.length >= 3 && high.length >= 3, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-02',
      title: '拆分支付识别：同一对手方 7 日内多笔 48,000 元',
      scene: '某咨询供应商在 5 个连续日期分别收到 48,000 元付款，单笔均低于 5 万审批线。',
      expect: '应命中 R03 拆分规则，并在线索台账中体现为"已拆分"特征。',
      run: function () {
        var S = App.state;
        if (!S.riskAlert || !S.riskAlert.ok) return { ok: false, msg: '请先执行风险筛查。' };
        var groups = S.riskAlert.splitGroups;
        if (!groups.length) return { ok: false, msg: '未识别到拆分分组（请确认 R03 阈值设置）' };
        var lines = ['识别到 ' + groups.length + ' 个拆分组：'];
        groups.slice(0, 4).forEach(function (g) {
          lines.push('  · ' + g.counterparty + '：' + g.count + ' 笔 / ' + g.days + ' 天内，累计 ' + U.money(g.total) + '（' + g.dates.join(', ') + '）');
        });
        return { ok: groups.length > 0, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-03',
      title: '资金回流识别：短期收付金额近似相等',
      scene: '与某客户在 6 天内先付出约 60–95 万、随后又收回金额相差不到 4% 的款项。',
      expect: '资金链路状态应标记为「疑似回流」，并在四流检查中提示业务支撑缺口。',
      run: function () {
        var S = App.state;
        if (!S.clueSort || !S.clueSort.ok) return { ok: false, msg: '请先执行「生成线索台账」。' };
        var reflow = S.clueSort.clues.filter(function (c) { return c.chain.status === '疑似回流'; });
        var lines = ['疑似回流线索 ' + reflow.length + ' 条（总线索 ' + S.clueSort.totals.clueCount + ' 条）：'];
        reflow.slice(0, 4).forEach(function (c) {
          lines.push('  · ' + c.id + ' ' + c.counterparty + '：流入 ' + U.money(c.chain.inflow) + ' / 流出 ' + U.money(c.chain.outflow));
          c.chain.notes.slice(0, 2).forEach(function (n) { lines.push('      - ' + n); });
        });
        return { ok: reflow.length > 0, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-04',
      title: '关联方关键人员识别：账号重合 / 法人同名 / 姓名相似',
      scene: '某客户法人"吴子豪"与本单位资管部主管同名，且其收款账号与该员工工资卡号完全一致；另有供应商法人与员工姓名编辑距离为 1。',
      expect: '关键人员关联核查应命中「银行账号重合」「法定代表人同名」「姓名相似」三类；股权穿透应出现本单位员工作为股东。',
      run: function () {
        var S = App.state;
        if (!S.linkage || !S.linkage.ok) return { ok: false, msg: '请先执行「关联方核查」。' };
        var kp = S.linkage.suspects.filter(function (s) { return s.typeCode === 'key_personnel_relation'; });
        var hard = kp.filter(function (s) {
          return s.hits.some(function (h) { return h.type === '银行账号重合' || h.type === '法定代表人同名'; });
        });
        var similar = kp.filter(function (s) { return s.hits.some(function (h) { return h.type === '姓名相似'; }); });
        var eq = S.linkage.suspects.filter(function (s) { return s.typeCode === 'equity_penetration'; });
        var lines = [
          '关键人员关联命中 ' + kp.length + ' 个主体，其中硬证据（账号/同名）' + hard.length + ' 个、仅姓名相似 ' + similar.length + ' 个',
          '股权穿透命中 ' + eq.length + ' 个主体'
        ];
        hard.slice(0, 3).forEach(function (s) {
          lines.push('  · ' + s.subject + '：' + s.hits.map(function (h) { return h.type; }).join('、'));
        });
        if (similar.length) lines.push('  · 姓名相似（需人工以身份证号复核，避免同名误判）：' + similar.slice(0, 3).map(function (s) { return s.subject; }).join('、'));
        return { ok: hard.length > 0 && similar.length > 0, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-05',
      title: '全科目汇总与借贷平衡校验',
      scene: '总账覆盖 52 个科目（1–2 级）；数据中人为植入 1 张借贷不平凭证与 4 笔未勾对流水。',
      expect: '应按科目树逐级汇总（父级=Σ子级），借贷发生额合计相等且在容差内平衡，并检出不平衡凭证与未勾对流水。',
      run: function () {
        var S = App.state;
        if (!S.aggregation || !S.aggregation.ok) return { ok: false, msg: '请先执行「按全科目汇总」。' };
        var a = S.aggregation;
        var lines = [
          '科目 ' + a.caliber.subjectCount + ' 个（末级 ' + a.caliber.leafCount + '，' + a.caliber.levelCount + ' 级），期间 ' + a.caliber.periodRange,
          '借方 ' + U.moneyRaw(a.balance.totalDebit) + ' / 贷方 ' + U.moneyRaw(a.balance.totalCredit) + '，差额 ' + U.moneyRaw(a.balance.diff) + ' → ' + (a.balance.balanced ? '平衡' : '不平衡'),
          '不平衡凭证 ' + a.balance.unbalancedVouchers.length + ' 张；数据质量问题 ' + a.qualityTotals.issueTypes + ' 类：' + a.quality.map(function (q) { return q.type + '(' + q.count + ')'; }).join('、')
        ];
        return { ok: a.balance.balanced && a.balance.unbalancedVouchers.length > 0 && a.rows.length > 10, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-06',
      title: '加权评分卡：参考区间与"需人工复核后定级"',
      scene: '七类舞弊各自按四维指标打分，加权汇总为 0–100 参考分值。',
      expect: '每类都应输出参考分值、参考区间，且区间结论必须包含"需人工复核后定级"字样；不得出现"构成舞弊"等定性表述。',
      run: function () {
        var S = App.state;
        if (!S.scorecard || !S.scorecard.ok) return { ok: false, msg: '请先执行「评分评估」。' };
        var sc = S.scorecard;
        var lines = ['综合参考分值 ' + sc.overall + '（' + sc.overallBand.text + '）'];
        sc.cards.forEach(function (c) {
          lines.push('  · ' + c.name + '：' + c.total + ' 分 → ' + c.band.text);
        });
        var allHaveNeedReview = sc.cards.every(function (c) { return /需人工复核后定级/.test(c.band.text); });
        var safe = U.assertSafeText(JSON.stringify(sc));
        lines.push('区间文案均含"需人工复核后定级"：' + (allHaveNeedReview ? '✓ 是' : '✗ 否'));
        lines.push('越界表述检查：' + (safe.ok ? '✓ 未发现' : '✗ ' + safe.issues.join('；')));
        return { ok: allHaveNeedReview && safe.ok, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-07',
      title: '报告生成：十节结构 + 强制声明 + 结论留空',
      scene: '汇总前序六个模块结果，按固定十节结构生成报告初稿。',
      expect: '报告须包含全部十节、强制声明原文不可缺、结论段留空、越界表述检查通过。',
      run: function () {
        var S = App.state;
        if (!S.riskAlert || !S.riskAlert.ok) return { ok: false, msg: '请先完成全流程（可点击工作台「一键完成全流程分析」）。' };
        var rep = App.report.build({
          riskAlert: S.riskAlert, clueSort: S.clueSort, linkage: S.linkage,
          aggregation: S.aggregation, scorecard: S.scorecard,
          data: S.dataset.data, meta: S.dataset.meta
        }, { template: { orgName: (S.dataset.meta || {}).company || '' } });
        var html = App.report.toHTML(rep);
        var md = App.report.toMarkdown(rep);
        var checks = [
          ['十节结构齐全', ['一、调查背景与范围', '二、分析方法', '三、主要发现', '四、线索台账摘要', '五、关联方核查摘要', '六、舞弊可能性参考评估', '七、证据缺口与待核实事项清单', '八、进一步核查建议', '九、数据质量与局限性说明', '十、声明'].every(function (t) { return html.indexOf(t) >= 0; })],
          ['强制声明存在', html.indexOf('不替代调查结论') >= 0],
          ['结论段留空', html.indexOf('由调查人员填写') >= 0],
          ['越界表述检查通过', U.assertSafeText(html).ok],
          ['Markdown 可导出', md.length > 1000]
        ];
        return {
          ok: checks.every(function (c) { return c[1]; }),
          msg: checks.map(function (c) { return (c[1] ? '  ✓ ' : '  ✗ ') + c[0]; }).join('\n') +
            '\n  报告编号：' + rep.reportNo + '　HTML ' + html.length + ' 字符 / MD ' + md.length + ' 字符'
        };
      }
    },
    {
      id: 'EX-08',
      title: '口径记忆与变更提示',
      scene: '修改阈值后重算，系统应提示"口径已变更，与历史分析不可直接比较"。',
      expect: '记忆写入 localStorage，口径签名变化被检出。',
      run: function () {
        var mem = App.memory.load();
        var base = { thresholds: mem.thresholds, period: mem.period, fraudTypes: mem.fraudTypes, whitelist: mem.whitelist };
        var sig1 = App.memory.signature(base);
        var changed = Object.assign({}, base, { thresholds: Object.assign({}, mem.thresholds, { R01_large_amount: mem.thresholds.R01_large_amount + 1 }) });
        var sig2 = App.memory.signature(changed);
        var lines = [
          '当前口径签名：' + sig1.slice(0, 48) + '…',
          '修改 R01 后签名：' + sig2.slice(0, 48) + '…',
          '签名是否变化：' + (sig1 !== sig2 ? '✓ 已变化（将提示不可直接比较）' : '✗ 未变化'),
          '记忆历史条数：' + (mem.history || []).length
        ];
        return { ok: sig1 !== sig2, msg: lines.join('\n') };
      }
    },
    {
      id: 'EX-09',
      title: '合规边界：禁用语自动改写',
      scene: '测试输出中出现"构成舞弊""建议立案"等越界表述时的防护效果。',
      expect: '越界表述应被检出并改写为合规用语。',
      run: function () {
        var bad = '经分析，该笔交易构成舞弊，此人存在舞弊行为，建议立案调查，建议处理该员工。';
        var guard = U.assertSafeText(bad);
        var fixed = U.sanitizeText(bad);
        var after = U.assertSafeText(fixed);
        return {
          ok: !guard.ok && after.ok,
          msg: '原文检出 ' + guard.issues.length + ' 处越界：\n  ' + guard.issues.join('\n  ') +
            '\n改写后：' + fixed + '\n改写后再检：' + (after.ok ? '✓ 通过' : '✗ 仍越界')
        };
      }
    },
    {
      id: 'EX-10',
      title: '知识库检索（RAG）：方法论问答命中',
      scene: '对"3σ 标准差怎么算""四流合一怎么核查"等方法论问题做本地检索。',
      expect: '应命中正确的知识片段（统计离群 / 四流合一）。',
      run: function () {
        var tests = [
          ['3σ 标准差怎么算', '统计离群'],
          ['四流合一怎么核查', '四流合一'],
          ['资金回流怎么识别', '资金链路'],
          ['报告里哪些话不能写', '禁用语']
        ];
        if (!App.rag.docs().length) {
          return { ok: false, msg: '知识库尚未加载（0 条）。请刷新页面；若仍为 0，请确认 data/knowledge/fraud-kb.json 可访问。' };
        }
        var lines = [], ok = true;
        tests.forEach(function (t) {
          var hits = App.rag.search(t[0], 2);
          var hit = hits.length > 0 && hits[0].title.indexOf(t[1]) >= 0;
          if (!hit) ok = false;
          lines.push((hit ? '  ✓ ' : '  ✗ ') + '「' + t[0] + '」→ ' + (hits[0] ? hits[0].title : '未命中'));
        });
        lines.push('知识库片段数：' + App.rag.docs().length + ' 条（不含企业制度条款）');
        return { ok: ok, msg: lines.join('\n') };
      }
    }
  ];

  App.pages.examples = {
    render: function (mount) {
      var S = App.state;
      var h = [];

      h.push(UI.divisionBar('内置测试示例：一键运行并给出可复核的判定结果'));

      h.push('<div class="wb-hero"><h2>测试示例与自检</h2>' +
        '<p>下面 10 个样例覆盖七个功能维度与合规边界。点击「运行全部样例」会自动加载预置演示数据、跑完整条流水线，' +
        '然后逐项校验判定条件，输出 <span class="pass">通过</span> / <span class="fail">未通过</span> 与可复核的依据。</p>' +
        '<div class="flex-gap mt14">' +
        '<button class="btn btn-primary" id="btnRunAll">▶ 运行全部样例</button>' +
        '<button class="btn" id="btnRunCasesOnly">仅校验（使用现有结果）</button>' +
        '<button class="btn" id="btnExportCases">导出校验报告 CSV</button>' +
        '</div></div>');

      h.push('<div id="caseSummary"></div>');
      h.push('<div class="card"><div class="card-head"><div class="card-title">样例清单<span class="sub">点击展开查看说明与判定细节</span></div></div>');
      h.push('<div id="caseList">' + CASES.map(function (c, i) {
        return '<div class="qa-item" data-case="' + c.id + '">' +
          '<div class="qa-head"><span class="qa-n">' + c.id + '</span><span class="grow">' + UI.esc(c.title) + '</span>' +
          '<span class="case-badge" id="badge_' + c.id + '"></span><span class="qa-arrow">▼</span></div>' +
          '<div class="qa-body hidden" id="body_' + c.id + '">' +
          '<div class="qa-block"><span class="qa-label">场景</span><div>' + UI.esc(c.scene) + '</div></div>' +
          '<div class="qa-block"><span class="qa-label">期望结果</span><div>' + UI.esc(c.expect) + '</div></div>' +
          '<div class="qa-block"><span class="qa-label">判定细节</span><pre id="out_' + c.id + '">（尚未运行）</pre></div>' +
          '</div></div>';
      }).join('') + '</div></div>');

      mount.innerHTML = h.join('');

      Array.prototype.forEach.call(mount.querySelectorAll('.qa-head'), function (head) {
        head.addEventListener('click', function () {
          var item = head.parentNode;
          var id = item.getAttribute('data-case');
          var body = mount.querySelector('#body_' + id);
          if (body.classList.contains('hidden')) {
            body.classList.remove('hidden');
            head.querySelector('.qa-arrow').textContent = '▲';
          } else {
            body.classList.add('hidden');
            head.querySelector('.qa-arrow').textContent = '▼';
          }
        });
      });

      mount.querySelector('#btnRunCasesOnly').addEventListener('click', function () { runCases(mount); });
      mount.querySelector('#btnRunAll').addEventListener('click', function () { runAll(mount); });
      mount.querySelector('#btnExportCases').addEventListener('click', function () { exportCases(mount); });

      if (S.lastCaseResults) renderSummary(mount, S.lastCaseResults);

      /* 首次进入自动提示 */
      if (!App.state.dataset) {
        var cs = mount.querySelector('#caseSummary');
        cs.innerHTML = UI.alert('当前尚未接入数据。点击「运行全部样例」会自动加载预置演示数据并跑完整条流水线。', 'info');
      }
    }
  };

  function runCases(mount) {
    var results = [];
    CASES.forEach(function (c) {
      var badge = mount.querySelector('#badge_' + c.id);
      var outEl = mount.querySelector('#out_' + c.id);
      var body = mount.querySelector('#body_' + c.id);
      body.classList.remove('hidden');
      try {
        var r = c.run();
        results.push({ id: c.id, title: c.title, ok: !!r.ok, msg: r.msg });
        badge.innerHTML = r.ok ? '<span class="tag tag-low">通过</span>' : '<span class="tag tag-high">未通过</span>';
        outEl.textContent = r.msg;
      } catch (e) {
        results.push({ id: c.id, title: c.title, ok: false, msg: '执行异常：' + e.message });
        badge.innerHTML = '<span class="tag tag-high">异常</span>';
        outEl.textContent = '执行异常：' + e.message + '\n' + (e.stack || '');
      }
    });
    App.state.lastCaseResults = results;
    renderSummary(mount, results);
    var pass = results.filter(function (r) { return r.ok; }).length;
    UI.toast('样例校验完成：' + pass + ' / ' + results.length + ' 通过', pass === results.length ? 'ok' : 'warn');
    return results;
  }

  function runAll(mount) {
    var btn = mount.querySelector('#btnRunAll');
    btn.disabled = true;
    btn.textContent = '⏳ 正在准备数据并执行全流程…';
    var cs = mount.querySelector('#caseSummary');
    cs.innerHTML = UI.loading('正在加载预置演示数据并运行完整流水线…');

    setTimeout(function () {
      try {
        var ds = App.demoData.build({});
        App.state.set('dataset', ds);
        App.memory.saveState({ dataset: ds });
        App.refreshTopbar();
        App.runPipeline({}).then(function () {
          btn.disabled = false;
          btn.textContent = '▶ 运行全部样例';
          cs.innerHTML = '';
          var results = runCases(mount);
          var pass = results.filter(function (r) { return r.ok; }).length;
          if (pass === results.length) {
            cs.innerHTML = UI.alert('✓ 全部 ' + results.length + ' 个样例通过。所有计算结果可回溯，且合规边界检查（禁用语改写、强制声明）均生效。', 'ok');
          } else {
            cs.innerHTML = UI.alert('部分样例未通过：' + results.filter(function (r) { return !r.ok; }).map(function (r) { return r.id; }).join('、') +
              '。展开对应样例查看判定细节。', 'warn');
          }
        });
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '▶ 运行全部样例';
        cs.innerHTML = UI.errorState(e.message);
      }
    }, 50);
  }

  function renderSummary(mount, results) {
    var pass = results.filter(function (r) { return r.ok; }).length;
    var h = '<div class="stat-row">' +
      UI.stat({ label: '样例总数', value: results.length + ' 个' }) +
      UI.stat({ label: '通过', value: pass + ' 个', tone: 'low' }) +
      UI.stat({ label: '未通过', value: (results.length - pass) + ' 个', tone: (results.length - pass) ? 'high' : 'low' }) +
      UI.stat({ label: '通过率', value: ((pass / results.length) * 100).toFixed(0) + '%', tone: pass === results.length ? 'low' : 'mid' }) +
      '</div>';
    mount.querySelector('#caseSummary').innerHTML = h;
  }

  function exportCases(mount) {
    var results = App.state.lastCaseResults;
    if (!results || !results.length) { UI.toast('请先运行样例', 'warn'); return; }
    var rows = results.map(function (r) {
      return [r.id, r.title, r.ok ? '通过' : '未通过', r.msg.replace(/\n/g, ' ／ ')];
    });
    var csv = App.dataSource.toCSV(rows, [0, 1, 2, 3], ['样例编号', '样例标题', '结果', '判定细节']);
    var ok = App.dataSource.download('测试样例校验报告_' + U.fmtDateCompact(new Date()) + '.csv', csv, 'text/csv');
    UI.toast(ok ? '校验报告已导出' : '当前环境不允许下载', ok ? 'ok' : 'err');
  }

  App.testCases = CASES;
  App.runTestCasesInNode = function () { return CASES.map(function (c) { return { id: c.id, run: c.run }; }); };
})(typeof window !== 'undefined' ? window : globalThis);
