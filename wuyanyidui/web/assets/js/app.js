/* =============================================================
 * 财务舞弊111 · 应用外壳
 *  - 全局 AppState 单一数据源（跨模块联动 linkage）
 *  - 下游模块 stale 标记：上游重算后，下游结果标记为"需重新生成"
 *  - 左侧导航 / 顶部栏 / 路由 / 大模型设置弹窗
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;

  /* ===================== 事件总线 ===================== */
  var bus = App.bus = (function () {
    var map = {};
    return {
      on: function (evt, fn) { (map[evt] = map[evt] || []).push(fn); return function () { bus.off(evt, fn); }; },
      off: function (evt, fn) { if (map[evt]) map[evt] = map[evt].filter(function (f) { return f !== fn; }); },
      emit: function (evt, data) { (map[evt] || []).forEach(function (f) { try { f(data); } catch (e) { console.error('[bus]', evt, e); } }); }
    };
  })();

  /* ===================== 全局状态 ===================== */
  var STATE = App.state = {
    dataset: null,        /* { data:{10表}, meta } */
    riskAlert: null,      /* F1 */
    clueSort: null,       /* F2 */
    linkage: null,        /* F3 */
    aggregation: null,    /* F4 */
    scorecard: null,      /* F5 */
    report: null,         /* F6 */
    stale: {},            /* 下游模块是否过期 */
    server: null,         /* 服务端状态 */
    running: {},          /* 各模块运行中标记 */
    chatHistory: []       /* 工作台对话 */
  };

  /* 模块流水线顺序（用于 stale 传播） */
  var PIPELINE = [
    { key: 'riskAlert', label: '风险信号识别', deps: [] },
    { key: 'clueSort', label: '线索台账', deps: ['riskAlert'] },
    { key: 'linkage', label: '关联方核查', deps: ['dataset'] },
    { key: 'aggregation', label: '数据汇总', deps: ['dataset'] },
    { key: 'scorecard', label: '评分评估', deps: ['riskAlert', 'clueSort', 'linkage', 'aggregation'] },
    { key: 'report', label: '报告草稿', deps: ['riskAlert', 'clueSort', 'linkage', 'aggregation', 'scorecard'] }
  ];

  STATE.markStale = function (fromKey) {
    var idx = PIPELINE.map(function (p) { return p.key; }).indexOf(fromKey);
    for (var i = idx + 1; i < PIPELINE.length; i++) {
      var k = PIPELINE[i].key;
      if (STATE[k]) STATE.stale[k] = true;
      else STATE.stale[k] = false;
    }
    STATE.stale[fromKey] = false;
    bus.emit('state:stale', STATE.stale);
  };

  STATE.set = function (key, value) {
    STATE[key] = value;
    if (key === 'dataset') {
      /* 更换数据源：所有下游结果全部失效 */
      ['riskAlert', 'clueSort', 'linkage', 'aggregation', 'scorecard', 'report'].forEach(function (k) {
        if (k !== 'dataset') { STATE[k] = null; STATE.stale[k] = false; }
      });
    } else {
      STATE.markStale(key);
    }
    bus.emit('state:changed', { key: key, value: value });
    refreshNavBadges();
  };

  /* 当前有效口径（记忆 + 会话覆盖） */
  STATE.caliber = function (override) {
    return App.memory.effective(override || STATE.override);
  };

  STATE.thresholds = function () { return STATE.caliber().thresholds; };

  /* ===================== 导航 ===================== */
  var PAGES = [
    { key: 'workbench', name: '工作台', icon: '◈' },
    { key: 'risk', name: '风险信号识别', icon: '⚠', badge: function () { return STATE.riskAlert && STATE.riskAlert.ok ? STATE.riskAlert.totals.byLevel.high : 0; } },
    { key: 'clue', name: '线索台账', icon: '☰', staleKey: 'clueSort' },
    { key: 'linkage', name: '关联方核查', icon: '⛓', staleKey: 'linkage' },
    { key: 'aggregate', name: '数据汇总', icon: '▤', staleKey: 'aggregation' },
    { key: 'score', name: '评分评估', icon: '◎', staleKey: 'scorecard' },
    { key: 'report', name: '报告草稿', icon: '▦', staleKey: 'report' },
    { key: 'examples', name: '测试示例', icon: '✓' },
    { key: 'settings', name: '设置', icon: '⚙' }
  ];

  var current = null;

  function refreshNavBadges() {
    PAGES.forEach(function (p) {
      var el = document.querySelector('[data-nav="' + p.key + '"]');
      if (!el) return;
      var badge = el.querySelector('.nav-badge');
      if (p.badge) {
        var n = p.badge();
        if (n > 0) {
          if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; el.appendChild(badge); }
          badge.textContent = n;
        } else if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      }
      /* stale 提示 */
      var oldDot = el.querySelector('.nav-stale');
      if (p.staleKey && STATE.stale[p.staleKey]) {
        if (!oldDot) {
          var d = document.createElement('span');
          d.className = 'nav-stale';
          d.textContent = '!';
          d.title = '上游数据已变化，需重新生成';
          d.style.cssText = 'margin-left:auto;font-size:10px;color:#E8A317;font-weight:700';
          el.appendChild(d);
        }
      } else if (oldDot && oldDot.parentNode) oldDot.parentNode.removeChild(oldDot);
    });
  }

  function buildShell() {
    var app = document.getElementById('app');
    app.innerHTML =
      '<aside class="sidebar">' +
        '<div class="brand"><div class="brand-mark">舞</div>' +
          '<div class="brand-text"><div class="brand-name">财务舞弊111</div><div class="brand-sub">舞弊审计调查助理</div></div>' +
        '</div>' +
        '<nav class="nav">' + PAGES.map(function (p) {
          return '<button class="nav-item" data-nav="' + p.key + '"><span class="nav-ico">' + p.icon + '</span>' + p.name + '</button>';
        }).join('') + '</nav>' +
        '<div class="sidebar-foot">' +
          '<div>v' + App.config.VERSION + ' · 助理辅助 / 人工决策</div>' +
          '<div style="margin-top:3px">输出均为辅助材料</div>' +
        '</div>' +
      '</aside>' +
      '<div class="main">' +
        '<header class="topbar">' +
          '<div class="topbar-title" id="pageTitle">工作台</div>' +
          '<div class="topbar-right">' +
            '<span class="status-pill" id="sourceStatus" title="当前数据源"><i class="dot"></i><span>未接入数据</span></span>' +
            '<span class="status-pill" id="modelStatus" title="大模型与记忆状态"><i class="dot"></i><span>检测中…</span></span>' +
            '<button class="btn btn-sm btn-outline-primary" id="btnApiSettings">⚙ 大模型API设置</button>' +
          '</div>' +
        '</header>' +
        '<main class="content" id="pageContent"></main>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (b) {
      b.addEventListener('click', function () { go(b.getAttribute('data-nav')); });
    });
    document.getElementById('btnApiSettings').addEventListener('click', function () { openApiSettings(); });

    window.addEventListener('hashchange', function () {
      var k = (location.hash || '#workbench').slice(1);
      if (k !== current) go(k, true);
    });
  }

  /* ===================== 路由 ===================== */
  function go(key, fromHash) {
    var page = PAGES.filter(function (p) { return p.key === key; })[0];
    if (!page) page = PAGES[0];
    current = page.key;
    if (!fromHash) {
      try { location.hash = '#' + page.key; } catch (e) {}
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-nav') === page.key);
    });
    document.getElementById('pageTitle').innerHTML = page.name +
      '<small>' + pageSubtitle(page.key) + '</small>';
    document.title = page.name + ' · 财务舞弊111';
    bus.emit('route:leaving', current);

    var mount = document.getElementById('pageContent');
    mount.innerHTML = UI.loading('正在加载…');
    var mod = App.pages && App.pages[page.key];
    if (!mod || !mod.render) {
      mount.innerHTML = UI.errorState('页面未实现：' + page.key);
      return;
    }
    try {
      mod.render(mount);
    } catch (e) {
      console.error(e);
      mount.innerHTML = UI.errorState(e.message, '请按 F12 查看控制台详细堆栈。');
    }
    mount.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function pageSubtitle(key) {
    return {
      workbench: '数据接入 · 一键分析 · 智能问答',
      risk: '统计异常 + 规则异常双路筛查',
      clue: '信号归集 · 资金链路 · 四流核对',
      linkage: '关键人员 · 股权穿透 · 频次规模 · 合同错配',
      aggregate: '全科目汇总 · 借贷平衡 · 数据质量',
      score: '七类舞弊加权评分卡（参考区间）',
      report: '结构化报告初稿 · 强制声明 · 导出',
      examples: '内置演示样例与自检',
      settings: '偏好记忆 · 阈值口径 · 大模型'
    }[key] || '';
  }

  App.go = go;
  App.PAGES = PAGES;
  App.PIPELINE = PIPELINE;

  /* ===================== 顶部状态 ===================== */
  function setPill(id, cls, text) {
    var el = document.getElementById(id);
    if (!el) return;
    var dot = el.querySelector('.dot');
    if (dot) dot.className = 'dot ' + (cls || '');
    var span = el.querySelector('span:last-child');
    if (span) span.textContent = text;
  }

  App.refreshTopbar = function () {
    /* 数据源 */
    var ds = STATE.dataset;
    if (!ds) {
      setPill('sourceStatus', '', '未接入数据');
    } else {
      var n = (ds.data.bank_transactions || []).length;
      var label = (ds.meta && (ds.meta.label || ds.meta.source)) || '已接入';
      setPill('sourceStatus', 'ok', '数据源：' + String(label).slice(0, 22) + '（' + n + ' 笔流水）');
    }
    /* 模型 + 记忆 */
    var mem = App.memory.load();
    var srv = STATE.server;
    var txt, cls;
    if (!srv) { txt = '模型检测中…'; cls = ''; }
    else if (!srv.online) { txt = '本地模式（代理未启动）'; cls = 'warn'; }
    else if (!srv.llmConfigured) { txt = '本地模式（未配置 Key）'; cls = 'warn'; }
    else { txt = '大模型已连接 · ' + (srv.model || ''); cls = 'ok'; }
    txt += ' · 记忆' + (mem.enabled ? '开' : '关');
    var kb = (App.rag && App.rag.docs) ? App.rag.docs().length : 0;
    if (kb === 0) { txt += ' · 知识库未加载'; if (cls === 'ok') cls = 'warn'; }
    setPill('modelStatus', cls, txt);
  };

  App.detectServer = function () {
    return App.llm.status().then(function (st) {
      STATE.server = st;
      App.refreshTopbar();
      return st;
    });
  };

  /* ===================== 大模型 API 设置弹窗 ===================== */
  function openApiSettings() {
    var srv = STATE.server || {};
    var mem = App.memory.load();
    var body = [];
    body.push('<div class="modal-section"><h4>🔌 服务状态</h4>' +
      '<div class="mem-row"><span class="mem-k">本地代理</span><span class="mem-v">' +
        (srv.online ? '<span class="pass">已连接</span> ' + UI.esc(srv.base) : '<span class="fail">未连接</span> ' + UI.esc(srv.base || App.llm.serverBase())) +
      '</span></div>' +
      '<div class="mem-row"><span class="mem-k">大模型 API Key</span><span class="mem-v">' +
        (srv.llmConfigured ? '<span class="pass">已配置（服务端持有，前端不可见）</span>' : '<span class="fail">未配置</span>') +
      '</span></div>' +
      '<div class="mem-row"><span class="mem-k">模型</span><span class="mem-v">' + UI.esc(srv.model || 'deepseek-flash') + '</span></div>' +
      '<div class="hint">出于安全设计，API Key 只存放在项目根目录 <b>.env</b> 文件中（变量 <span class="mono">FRAUD111_LLM_KEY</span>），由本地服务读取后转发，前端永不持有、不落盘。修改 .env 后需重启 start.bat。</div>' +
      '</div>');

    body.push('<div class="modal-section"><h4>🧠 未启动代理时怎么办</h4>' +
      '<div class="hint">双击项目根目录的 <b>start.bat</b> 即可启动本地服务并自动打开页面。<br>' +
      '即使不启动，本系统全部<b>离线能力</b>仍可用：预置数据、风险信号筛查、线索梳理、关联方核查、全科目汇总、评分评估、报告生成与导出。<br>' +
      '此时大模型相关功能会降级为「本地模式」（基于内置规则与知识库生成内容，并在界面明确标注）。</div>' +
      '</div>');

    body.push('<div class="modal-section"><h4>💾 偏好记忆</h4>' +
      '<label class="switch"><input type="checkbox" id="swMem"' + (mem.enabled ? ' checked' : '') + '><span class="track"></span><span>启用偏好记忆（记住常用口径、阈值、关注舞弊类型）</span></label>' +
      '<div class="hint">记忆内容只保存在本浏览器 localStorage，不会上传。</div>' +
      '</div>');

    body.push('<div class="modal-section"><h4>🧪 连通性测试</h4>' +
      '<button class="btn btn-sm" id="btnTestLLM">发送测试请求</button> ' +
      '<span class="small muted" id="testOut">点击后测试大模型调用链路</span>' +
      '</div>');

    var m = UI.modal({
      title: '大模型 API 设置',
      body: body.join(''),
      footer: '<button class="btn" data-close>关闭</button><button class="btn btn-primary" id="btnRecheck">重新检测</button>'
    });

    m.body.querySelector('#swMem').addEventListener('change', function (e) {
      App.memory.save({ enabled: e.target.checked });
      App.refreshTopbar();
      UI.toast('偏好记忆已' + (e.target.checked ? '启用' : '关闭'), 'ok');
    });
    m.el.querySelector('#btnRecheck').addEventListener('click', function () {
      App.detectServer().then(function () { m.close(); openApiSettings(); UI.toast('已重新检测服务状态', 'ok'); });
    });
    var testBtn = m.body.querySelector('#btnTestLLM');
    var out = m.body.querySelector('#testOut');
    testBtn.addEventListener('click', function () {
      testBtn.disabled = true;
      out.innerHTML = '<span class="muted">正在调用…</span>';
      App.llm.chat({
        prompt: '请回复「连通正常」四个字。',
        useRag: false, maxTokens: 3000,
        onDelta: function (acc) { out.innerHTML = '<span class="muted">接收中：' + UI.esc(String(acc).slice(-40)) + '</span>'; }
      }).then(function (r) {
        testBtn.disabled = false;
        if (r.mode === 'llm') {
          out.innerHTML = '<span class="pass">✓ 大模型连通正常</span><div class="small muted" style="margin-top:4px">返回：' + UI.esc(String(r.text).slice(0, 120)) + '</div>' +
            (r.reasoning ? '<div class="small muted">（含思考过程 ' + r.reasoning.length + ' 字，已单独隔离，不混入正文）</div>' : '');
        } else {
          out.innerHTML = '<span class="fail">✗ 已降级为本地模式</span><div class="small muted" style="margin-top:4px">' +
            UI.esc(r.fallbackReason || '本地代理未启动或未配置 Key') + '</div>';
        }
      });
    });
  }
  App.openApiSettings = openApiSettings;

  /* ===================== 启动 ===================== */
  App.boot = function () {
    buildShell();
    App.refreshTopbar();
    App.detectServer();
    /* 知识库：优先同步加载；失败则异步兜底（加载完成后刷新问答页） */
    var ragReady = App.rag.load();
    if (!ragReady) {
      App.rag.loadAsync().then(function (n) {
        if (n > 0) {
          App.refreshTopbar();
          bus.emit('rag:ready', n);
        }
      });
    }
    /* 恢复上次数据源（sessionStorage） */
    var st = App.memory.loadState && App.memory.loadState();
    if (st && st.dataset && st.dataset.data) {
      STATE.dataset = st.dataset;
      App.refreshTopbar();
    }
    var k = (location.hash || '#workbench').slice(1);
    go(k && PAGES.some(function (p) { return p.key === k; }) ? k : 'workbench', true);
    bus.on('memory:changed', function () { App.refreshTopbar(); });

    /* 全局错误兜底 */
    window.addEventListener('error', function (e) {
      console.error('[global error]', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', function (e) {
      console.error('[unhandled rejection]', e.reason);
    });
  };

  /* 便捷：确保有数据，否则引导去数据汇总 */
  App.requireDataset = function (mount, pageName) {
    if (STATE.dataset && STATE.dataset.data) return true;
    mount.innerHTML = UI.divisionBar() +
      '<div class="card">' + UI.empty({
        icon: '📥',
        title: '尚未接入数据',
        desc: '请先在「数据汇总」页选择使用内置演示数据，或上传 Excel/CSV、连接数据库。' + (pageName ? '<br>「' + pageName + '」需要先有数据才能开始。' : ''),
        action: '<button class="btn btn-primary" id="goAgg">前往数据汇总</button>'
      }) + '</div>';
    var b = mount.querySelector('#goAgg');
    if (b) b.addEventListener('click', function () { go('aggregate'); });
    return false;
  };

  /* 便捷：一键跑完整流水线 */
  App.runPipeline = function (opts) {
    opts = opts || {};
    var ds = STATE.dataset;
    if (!ds) return Promise.reject(new Error('未接入数据'));
    var cal = STATE.caliber();
    var steps = [];
    var progress = opts.onProgress || function () {};

    var risk = App.riskAlert.run(ds, { thresholds: cal.thresholds, period: cal.period, whitelist: cal.whitelist, fraudTypes: cal.fraudTypes });
    STATE.set('riskAlert', risk);
    progress('risk', risk);

    if (!risk.ok) return Promise.resolve({ riskAlert: risk });

    var clue = null, link = null, agg = null, sc = null;
    if (opts.skipClue !== true) {
      clue = App.clueSort.run(risk, ds, { thresholds: cal.thresholds, linkage: STATE.linkage });
      STATE.set('clueSort', clue);
      progress('clue', clue);
    }
    if (opts.skipLinkage !== true) {
      link = App.linkage.run(ds, { thresholds: cal.thresholds });
      STATE.set('linkage', link);
      progress('linkage', link);
    }
    if (opts.skipAggregation !== true) {
      agg = App.aggregation.run(ds, { period: cal.period });
      STATE.set('aggregation', agg);
      progress('aggregate', agg);
    }
    if (clue && clue.ok) {
      /* 线索需用到关联方结果，重算一次以刷新关联方命中标志 */
      clue = App.clueSort.run(risk, ds, { thresholds: cal.thresholds, linkage: link });
      STATE.set('clueSort', clue);
      progress('clue', clue);
    }
    sc = App.scorecard.run({
      riskAlert: risk, clueSort: STATE.clueSort, linkage: link, aggregation: agg,
      data: ds.data, meta: ds.meta
    }, { scoreWeights: cal.thresholds, fraudTypes: cal.fraudTypes });
    STATE.set('scorecard', sc);
    progress('score', sc);

    App.memory.recordUsage({
      thresholds: cal.thresholds, period: cal.period,
      fraudTypes: cal.fraudTypes, whitelist: cal.whitelist
    });
    return Promise.resolve({ riskAlert: risk, clueSort: STATE.clueSort, linkage: link, aggregation: agg, scorecard: sc });
  };
})(typeof window !== 'undefined' ? window : globalThis);
