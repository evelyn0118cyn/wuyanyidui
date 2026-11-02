/* =============================================================
 * 页面：工作台
 * 数据接入概览 · 一键流水线 · 智能问答 · 口径回显
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  var STEPS = [
    { key: 'risk', name: '风险信号识别' },
    { key: 'clue', name: '线索梳理' },
    { key: 'linkage', name: '关联方核查' },
    { key: 'aggregate', name: '全科目汇总' },
    { key: 'score', name: '评分评估' }
  ];

  App.pages.workbench = {
    render: function (mount) {
      var S = App.state;
      var cal = S.caliber();
      var h = [];

      h.push(UI.divisionBar('助理辅助：筛查 / 梳理 / 汇总 / 起草　｜　人工决策：定性、定级、上报、签发'));

      /* Hero */
      h.push('<div class="wb-hero"><h2>舞弊审计调查 · 综合辅助工作台</h2>' +
        '<p>一次接入数据，即可完成「风险信号识别 → 线索梳理 → 关联方核查 → 全科目汇总 → 参考评分 → 报告初稿」全流程。' +
        '所有输出均标注「助理辅助 / 人工决策」分工，<b>不构成任何舞弊认定</b>。</p>' +
        '<div class="flex-gap mt14">' +
        '<button class="btn btn-primary" id="btnPipeline">▶ 一键完成全流程分析</button>' +
        '<button class="btn" id="btnGoData">数据接入 / 更换数据源</button>' +
        '<button class="btn" id="btnGoReport">直接生成报告</button>' +
        '<button class="btn" id="btnGoExamples">查看测试示例</button>' +
        '</div></div>');

      /* 数据源状态 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">数据源<span class="sub">' +
        (S.dataset ? UI.esc((S.dataset.meta || {}).label || '已接入') : '未接入') + '</span></div>' +
        '<div class="card-actions"><button class="btn btn-sm" id="btnLoadPreset2">加载预置演示数据</button></div></div>');
      if (!S.dataset) {
        h.push(UI.empty({
          icon: '📥', title: '还没有数据',
          desc: '点击「加载预置演示数据」可立即体验全部功能（内置 10 张业务表与各类植入风险信号）；也可上传自己的 Excel/CSV。',
          action: '<button class="btn btn-primary" id="btnLoadPreset">加载预置演示数据</button>'
        }));
      } else {
        var d = S.dataset.data, m = S.dataset.meta || {};
        h.push('<div class="stat-row" style="margin-bottom:0">' +
          UI.stat({ label: '银行流水', value: U.thousands((d.bank_transactions || []).length), hint: m.periodStart ? m.periodStart + ' ~ ' + m.periodEnd : '' }) +
          UI.stat({ label: '凭证 / 分录', value: (d.gl_vouchers || []).length + ' / ' + (d.gl_voucher_entries || []).length, small: true }) +
          UI.stat({ label: '会计科目', value: (d.subjects || []).length }) +
          UI.stat({ label: '客户 / 供应商', value: (d.customers || []).length + ' / ' + (d.suppliers || []).length }) +
          UI.stat({ label: '员工 / 部门', value: (d.employees || []).length + ' / ' + (d.departments || []).length }) +
          '</div>');
      }
      h.push('</div>');

      /* 口径回显 */
      h.push('<div class="caliber-bar mt14"><span>本次使用口径：</span><b>' + UI.esc(cal.echo) + '</b>' +
        '<span class="small muted">（来自记忆' + (cal.fromMemory ? '' : '，记忆已关闭') + '）</span>' +
        '<span class="cal-actions"><button class="btn btn-sm" id="btnEditCal2">修改</button>' +
        '<button class="btn btn-sm" id="btnMemDetail">记忆明细</button></span></div>');

      /* 流水线步骤 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">分析流水线<span class="sub">跨模块联动：上游重算会自动标记下游结果过期</span></div></div>');
      h.push('<div class="steps">');
      STEPS.forEach(function (s, i) {
        var st = stepState(s.key);
        h.push('<div class="step ' + st.cls + '" data-step="' + s.key + '"><span class="idx">' + (st.cls === 'done' ? '✓' : (i + 1)) + '</span>' + s.name + '</div>');
        if (i < STEPS.length - 1) h.push('<span class="step-sep">›</span>');
      });
      h.push('</div>');
      h.push('<div class="table-wrap"><table class="grid"><thead><tr><th>模块</th><th>状态</th><th>关键结果</th><th style="width:96px">操作</th></tr></thead><tbody>');
      STEPS.forEach(function (s) {
        var st = stepState(s.key);
        h.push('<tr><td>' + s.name + '</td><td>' + st.badge + '</td><td class="small">' + st.summary + '</td>' +
          '<td><button class="btn btn-sm btn-ghost" data-goto="' + st.page + '">查看</button></td></tr>');
      });
      h.push('</tbody></table></div></div>');

      /* 智能问答 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">智能问答<span class="sub">基于内置知识库（方法论 / 释义 / 用语规范），不含企业制度条款</span></div>' +
        '<div class="card-actions"><span class="small muted" id="chatMode">检测中…</span>' +
        '<button class="btn btn-sm" id="btnClearChat">清空对话</button></div></div>');
      h.push('<div class="chat-box"><div class="chat-log" id="chatLog"></div>' +
        '<div class="chat-suggest">' +
        ['这批流水有什么问题？', '3σ 和 IQR 有什么区别？', '四流合一怎么核查？', '报告里哪些话不能写？', '评分为什么这么高？']
          .map(function (q) { return '<button data-ask="' + UI.esc(q) + '">' + UI.esc(q) + '</button>'; }).join('') +
        '</div>' +
        '<div class="chat-input"><textarea id="chatInput" placeholder="提问，例如：帮我筛查异常交易 / 解释一下 CL-001 这条线索 / 3σ 怎么算（Ctrl+Enter 发送）"></textarea>' +
        '<button class="btn btn-primary" id="btnSend">发送</button></div></div></div>');

      mount.innerHTML = h.join('');

      /* ---------- 事件 ---------- */
      var lp = mount.querySelector('#btnLoadPreset');
      if (lp) lp.addEventListener('click', function () { loadPreset(mount); });
      var lp2 = mount.querySelector('#btnLoadPreset2');
      if (lp2) lp2.addEventListener('click', function () { loadPreset(mount); });

      mount.querySelector('#btnGoData').addEventListener('click', function () { App.go('aggregate'); });
      mount.querySelector('#btnGoReport').addEventListener('click', function () { App.go('report'); });
      mount.querySelector('#btnGoExamples').addEventListener('click', function () { App.go('examples'); });
      mount.querySelector('#btnEditCal2').addEventListener('click', function () { App.pages.risk.openThresholds(); });
      mount.querySelector('#btnMemDetail').addEventListener('click', function () { showMemory(); });
      mount.querySelector('#btnPipeline').addEventListener('click', function () { runPipeline(mount); });
      Array.prototype.forEach.call(mount.querySelectorAll('[data-goto]'), function (b) {
        b.addEventListener('click', function () { App.go(b.getAttribute('data-goto')); });
      });

      initChat(mount);

      var srv = App.state.server;
      var cm = mount.querySelector('#chatMode');
      if (cm) cm.textContent = (srv && srv.online && srv.llmConfigured) ? '大模型已连接' : '本地模式';
    }
  };

  function stepState(key) {
    var S = App.state;
    var map = {
      risk: { page: 'risk', result: S.riskAlert, stale: S.stale.riskAlert },
      clue: { page: 'clue', result: S.clueSort, stale: S.stale.clueSort },
      linkage: { page: 'linkage', result: S.linkage, stale: S.stale.linkage },
      aggregate: { page: 'aggregate', result: S.aggregation, stale: S.stale.aggregation },
      score: { page: 'score', result: S.scorecard, stale: S.stale.scorecard }
    };
    var cfg = map[key];
    var r = cfg.result;
    if (r && r.ok && !cfg.stale) {
      return { cls: 'done', badge: '<span class="tag tag-low">已完成</span>', summary: summaryOf(key, r), page: cfg.page };
    }
    if (r && r.ok && cfg.stale) {
      return { cls: '', badge: '<span class="tag tag-mid">需重新生成</span>', summary: summaryOf(key, r) + ' <span class="small muted">（上游已变化）</span>', page: cfg.page };
    }
    return { cls: '', badge: '<span class="tag tag-gray">未执行</span>', summary: '<span class="muted">—</span>', page: cfg.page };
  }

  function summaryOf(key, r) {
    if (key === 'risk') return '信号 <b>' + r.totals.signalCount + '</b> 条（参考高 <b>' + r.totals.byLevel.high + '</b>），覆盖流水 ' + r.totals.txnCount + ' 笔';
    if (key === 'clue') return '线索 <b>' + r.totals.clueCount + '</b> 条，累计 ' + U.money(r.totals.totalAmount) + '，高优先级 ' + r.totals.highPriority + ' 条';
    if (key === 'linkage') return '可疑主体 <b>' + r.totals.suspectCount + '</b> 个，涉及 ' + U.money(r.totals.relatedTxnAmount);
    if (key === 'aggregate') return r.rows.length + ' 个科目，借贷' + (r.balance.balanced ? '<b>平衡</b>' : '<b style="color:#D93025">不平</b>') + '，质量问题 ' + r.qualityTotals.issueTypes + ' 类';
    if (key === 'score') return '综合参考分值 <b>' + r.overall + '</b>（' + UI.esc(r.overallBand.text) + '）';
    return '—';
  }

  function loadPreset(mount) {
    var ds = App.demoData.build({});
    App.state.set('dataset', ds);
    App.memory.saveState({ dataset: ds });
    App.refreshTopbar();
    UI.toast('已加载预置演示数据（' + ds.data.bank_transactions.length + ' 笔流水 / ' + ds.data.gl_vouchers.length + ' 张凭证）', 'ok');
    App.pages.workbench.render(mount);
  }

  /* ---------------- 一键流水线 ---------------- */
  function runPipeline(mount) {
    var S = App.state;
    if (!S.dataset) { UI.toast('请先接入数据（可点击「加载预置演示数据」）', 'warn'); return; }
    var btn = mount.querySelector('#btnPipeline');
    btn.disabled = true;
    btn.textContent = '分析中…';
    var logBox = document.createElement('div');
    logBox.className = 'card mt14';
    logBox.innerHTML = '<div class="card-head"><div class="card-title">分析进度</div></div><div id="pipeLog"></div>';
    mount.insertBefore(logBox, mount.children[2]);
    var lg = logBox.querySelector('#pipeLog');
    var add = function (txt, cls) {
      lg.insertAdjacentHTML('beforeend', '<div class="small" style="padding:3px 0"><span class="' + (cls || '') + '">' + txt + '</span></div>');
    };
    var names = { risk: '风险信号识别', clue: '线索梳理', linkage: '关联方核查', aggregate: '全科目汇总', score: '评分评估' };
    add('开始执行全流程分析…');

    setTimeout(function () {
      try {
        App.runPipeline({
          onProgress: function (key, res) {
            var extra = '';
            if (key === 'risk') extra = '：' + res.totals.signalCount + ' 条信号（参考高 ' + res.totals.byLevel.high + '）';
            else if (key === 'clue') extra = '：' + res.totals.clueCount + ' 条线索';
            else if (key === 'linkage') extra = '：' + res.totals.suspectCount + ' 个可疑主体';
            else if (key === 'aggregate') extra = '：' + res.rows.length + ' 个科目，借贷' + (res.balance.balanced ? '平衡' : '不平');
            else if (key === 'score') extra = '：综合参考分值 ' + res.overall + '（' + res.overallBand.label + '）';
            add('✓ ' + (names[key] || key) + ' 完成' + extra, 'pass');
          }
        }).then(function () {
          add('全流程完成。所有结果均为辅助材料，最终判断由调查人员作出。', 'pass');
          btn.disabled = false;
          btn.textContent = '▶ 一键完成全流程分析';
          App.pages.workbench.render(mount);
          UI.toast('全流程分析完成', 'ok');
        });
      } catch (e) {
        console.error(e);
        add('✗ 执行失败：' + e.message, 'fail');
        btn.disabled = false;
        btn.textContent = '▶ 一键完成全流程分析';
      }
    }, 60);
  }

  /* ---------------- 记忆明细 ---------------- */
  function showMemory() {
    var mem = App.memory.load();
    var rows = [
      ['记忆开关', mem.enabled ? '<span class="pass">已启用</span>' : '已关闭'],
      ['常用统计期间', (mem.period && (mem.period.start || mem.period.end)) ? (mem.period.start + ' ~ ' + mem.period.end) : '全量'],
      ['异常阈值', App.memory.describe({ thresholds: mem.thresholds, period: mem.period, fraudTypes: mem.fraudTypes, whitelist: mem.whitelist })],
      ['关注舞弊类型', (mem.fraudTypes || []).map(function (c) { var f = App.config.FRAUD_TYPES.filter(function (x) { return x.code === c; })[0]; return f ? f.name : c; }).join('、') || '全部'],
      ['常用输出形式', (mem.outputForm || []).join('、')],
      ['报告模板', (mem.reportTemplate && mem.reportTemplate.title) || '默认'],
      ['白名单', (mem.whitelist || []).join('、') || '无'],
      ['上次数据源', mem.lastSource || '—'],
      ['口径历史', (mem.history || []).length + ' 条记录']
    ];
    var body = rows.map(function (r) {
      return '<div class="mem-row"><span class="mem-k">' + UI.esc(r[0]) + '</span><span class="mem-v">' + r[1] + '</span></div>';
    }).join('');
    var m = UI.modal({
      title: '偏好记忆明细',
      wide: true,
      body: '<div class="small muted mb14">记忆内容仅保存在本浏览器 localStorage，不会上传到服务器。每次分析前会回显当前口径并请岗位人员确认。</div>' + body,
      footer: '<button class="btn" data-close>关闭</button><button class="btn btn-ghost" id="btnClearMem" style="color:#D93025">清空全部记忆</button>'
    });
    m.body.parentNode.querySelector('#btnClearMem').addEventListener('click', function () {
      UI.confirm({ title: '清空记忆', body: '将清除所有记住的口径、阈值、白名单与报告模板偏好。是否继续？', okText: '清空' }).then(function (ok) {
        if (!ok) return;
        App.memory.clear();
        m.close();
        UI.toast('记忆已清空，已恢复默认口径', 'ok');
        App.go('workbench');
      });
    });
  }
  App.showMemory = showMemory;

  /* ---------------- 智能问答 ---------------- */
  function initChat(mount) {
    var S = App.state;
    var log = mount.querySelector('#chatLog');
    var input = mount.querySelector('#chatInput');
    var send = mount.querySelector('#btnSend');

    function addMsg(role, text, meta) {
      var isUser = role === 'user';
      var d = document.createElement('div');
      d.className = 'msg ' + (isUser ? 'user' : 'bot');
      d.innerHTML = '<div class="avatar">' + (isUser ? '我' : 'AI') + '</div>' +
        '<div><div class="bubble">' + UI.esc(text) + '</div>' +
        (meta ? '<div class="msg-meta">' + meta + '</div>' : '') + '</div>';
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
      return d;
    }

    /* 恢复历史 */
    if (S.chatHistory.length) {
      log.innerHTML = '';
      S.chatHistory.forEach(function (m) { addMsg(m.role, m.text, m.meta); });
    } else {
      addMsg('bot', '你好，我是「财务舞弊111」。我可以帮你：\n· 筛查批量交易中的风险信号（统计异常 + R01–R09 规则）\n· 把信号整理成可核查的线索台账\n· 做关联方穿透与四流交叉核对\n· 计算舞弊可能性参考分值（参考区间，需人工复核）\n· 起草舞弊调查分析报告初稿\n\n注意：我是助理而非替代——不做舞弊认定、不给风险定级、不建议处置。所有输出都需你复核。');
    }

    function ask(q) {
      if (!q.trim()) return;
      addMsg('user', q);
      S.chatHistory.push({ role: 'user', text: q });
      input.value = '';
      send.disabled = true;

      /* 意图识别 → 走不同的本地/模型处理 */
      var intent = detectIntent(q);
      var botEl = addMsg('bot', '');
      var bubble = botEl.querySelector('.bubble');
      var meta = botEl.querySelector('.msg-meta') || document.createElement('div');
      if (!botEl.querySelector('.msg-meta')) { meta.className = 'msg-meta'; botEl.querySelector('div:last-child').appendChild(meta); }

      /* 1) 需要真实数据的问答：直接查结构化结果，保证数字可回溯 */
      if (intent === 'run_screen') {
        if (!S.dataset) { bubble.textContent = '还没有数据。请先在「数据汇总」接入数据，或回到工作台加载预置演示数据。'; send.disabled = false; return; }
        bubble.textContent = '正在执行筛查…';
        setTimeout(function () {
          var r = App.riskAlert.run(S.dataset, { thresholds: S.caliber().thresholds, period: S.caliber().period, whitelist: S.caliber().whitelist, fraudTypes: S.caliber().fraudTypes });
          App.state.set('riskAlert', r);
          var top = r.signals.slice(0, 5);
          var txt = '已完成筛查：共 ' + r.totals.txnCount + ' 笔流水，命中 ' + r.totals.signalCount + ' 条风险信号（占 ' + (r.totals.signalRatio * 100).toFixed(1) + '%）。\n' +
            '参考等级：高 ' + r.totals.byLevel.high + ' 条 / 中 ' + r.totals.byLevel.mid + ' 条 / 低 ' + r.totals.byLevel.low + ' 条。\n\n参考风险最高的几笔：\n' +
            top.map(function (s, i) {
              return (i + 1) + '. ' + s.txn_date + ' ' + s.direction + ' ' + U.money(s.amount) + '，对手方「' + s.counterparty + '」，命中 ' + s.ruleCodes.join('/');
            }).join('\n') +
            '\n\n以上为风险信号提示，是否构成异常及异常原因请由你结合业务背景判断。详见「风险信号识别」页。';
          bubble.textContent = txt;
          S.chatHistory.push({ role: 'bot', text: txt });
          meta.textContent = '数据来源：' + ((S.dataset.meta || {}).label || '已接入数据') + '　· 结构化计算结果（非模型生成）';
          send.disabled = false;
          log.scrollTop = log.scrollHeight;
        }, 50);
        return;
      }

      if (intent === 'data_summary') {
        if (!S.riskAlert || !S.riskAlert.ok) {
          bubble.textContent = '还没有分析结果。可以先说「帮我筛查异常交易」，或点击「一键完成全流程分析」。';
          send.disabled = false;
          return;
        }
        var r2 = S.riskAlert;
        var txt2 = '当前分析结果摘要（数据来源：' + ((S.dataset.meta || {}).label || '') + '）：\n' +
          '· 风险信号 ' + r2.totals.signalCount + ' 条，参考高风险 ' + r2.totals.byLevel.high + ' 条\n' +
          '· 规则命中最多：' + r2.ruleStats.slice().sort(function (a, b) { return b.count - a.count; }).slice(0, 3).map(function (x) { return x.code + x.name + '(' + x.count + ')'; }).join('、') + '\n' +
          (S.clueSort && S.clueSort.ok ? '· 线索 ' + S.clueSort.totals.clueCount + ' 条，其中疑似回流 ' + (S.clueSort.chainStats['疑似回流'] || 0) + ' 条、断点 ' + (S.clueSort.chainStats['断点'] || 0) + ' 条\n' : '') +
          (S.linkage && S.linkage.ok ? '· 关联方可疑主体 ' + S.linkage.totals.suspectCount + ' 个\n' : '') +
          (S.scorecard && S.scorecard.ok ? '· 综合参考分值 ' + S.scorecard.overall + '（' + S.scorecard.overallBand.text + '）\n' : '') +
          '\n需要我进一步解释某一项，或生成报告初稿吗？';
        bubble.textContent = txt2;
        S.chatHistory.push({ role: 'bot', text: txt2 });
        meta.textContent = '结构化结果汇总（非模型生成，数字可直接回溯）';
        send.disabled = false;
        log.scrollTop = log.scrollHeight;
        return;
      }

      /* 2) 一般问答：走大模型 + 知识库，失败则本地模式 */
      var localCtxOpt = {};
      var history = S.chatHistory.slice(-6).filter(function (m) { return m.role; });
      App.llm.chat({
        prompt: buildPrompt(q),
        ragQuery: q,
        history: history.slice(0, -1),
        onDelta: function (acc) { bubble.textContent = acc; log.scrollTop = log.scrollHeight; },
        onReasoning: function (r3) {
          if (!bubble.textContent) meta.textContent = '正在思考…（' + r3.length + ' 字）';
        }
      }).then(function (res) {
        bubble.textContent = res.text;
        S.chatHistory.push({ role: 'bot', text: res.text });
        meta.innerHTML = res.mode === 'llm'
          ? '✓ 大模型生成' + (res.reasoning ? '（思考过程 ' + res.reasoning.length + ' 字已隔离）' : '') +
            (res.ragHits && res.ragHits.length ? '　知识库：' + UI.esc(res.ragHits.map(function (x) { return x.title; }).join('、')) : '')
          : '⚠ 本地模式：' + UI.esc(res.fallbackReason || '未配置大模型 Key') + '（内容由内置规则与知识库生成）';
        send.disabled = false;
        log.scrollTop = log.scrollHeight;
        if (!res.guardrails.ok) UI.toast('已自动改写 ' + res.guardrails.issues.length + ' 处越界表述', 'warn');
      }).catch(function (e) {
        bubble.textContent = '处理失败：' + e.message;
        send.disabled = false;
      });
    }

    send.addEventListener('click', function () { ask(input.value); });
    input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { ask(input.value); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input.value); }
    });
    Array.prototype.forEach.call(mount.querySelectorAll('[data-ask]'), function (b) {
      b.addEventListener('click', function () { ask(b.getAttribute('data-ask')); });
    });
    mount.querySelector('#btnClearChat').addEventListener('click', function () {
      S.chatHistory = [];
      log.innerHTML = '';
      addMsg('bot', '对话已清空。可以重新提问。');
    });
  }

  function detectIntent(q) {
    if (/帮我筛查|筛查一下|筛一遍|有什么问题|查一下异常|找异常|异常交易|扫描/.test(q)) return 'run_screen';
    if (/结果摘要|分析结果|目前情况|整体情况|汇总一下结果|现在什么情况/.test(q)) return 'data_summary';
    return 'chat';
  }

  function buildPrompt(q) {
    var S = App.state;
    var ctx = [];
    if (S.dataset) {
      ctx.push('【当前数据概况】数据来源：' + ((S.dataset.meta || {}).label || '已接入') +
        '；银行流水 ' + (S.dataset.data.bank_transactions || []).length + ' 笔；凭证 ' + (S.dataset.data.gl_vouchers || []).length + ' 张。');
    }
    if (S.riskAlert && S.riskAlert.ok) {
      ctx.push('【已完成的风险信号识别】信号 ' + S.riskAlert.totals.signalCount + ' 条，参考高 ' + S.riskAlert.totals.byLevel.high +
        ' 条；规则命中：' + S.riskAlert.ruleStats.filter(function (x) { return x.count; }).map(function (x) { return x.code + x.name + x.count + '条'; }).join('、'));
    }
    if (S.clueSort && S.clueSort.ok) {
      ctx.push('【线索台账】' + S.clueSort.totals.clueCount + ' 条。前 3 条：' + S.clueSort.clues.slice(0, 3).map(function (c) {
        return c.id + ' ' + c.counterparty + '/' + c.matter + ' ' + c.txnCount + '笔 ' + U.money(c.amount);
      }).join('；'));
    }
    if (S.linkage && S.linkage.ok) {
      ctx.push('【关联方核查】可疑主体 ' + S.linkage.totals.suspectCount + ' 个，例如：' + S.linkage.suspects.slice(0, 3).map(function (s) { return s.subject + '(' + s.type + ')'; }).join('、'));
    }
    if (S.scorecard && S.scorecard.ok) {
      ctx.push('【评分评估】综合参考分值 ' + S.scorecard.overall + '（' + S.scorecard.overallBand.text + '）；各类：' +
        S.scorecard.cards.map(function (c) { return c.name + c.total; }).join('、'));
    }
    return (ctx.length ? '以下是本次分析的真实上下文，回答时可用其中的数字，但不要编造：\n' + ctx.join('\n') + '\n\n' : '') +
      '用户问题：' + q;
  }
})(typeof window !== 'undefined' ? window : globalThis);
