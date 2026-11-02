/* =============================================================
 * 财务舞弊111 · F7 偏好记忆与口径校验（remember_all）
 * 记忆内容 localStorage 持久化；每次使用记忆值都回显并请用户确认。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;
  var KEY = 'fraud111.memory.v1';
  var KEY_STATE = 'fraud111.laststate.v1';

  var DEFAULTS = {
    enabled: true,
    /* 常用统计期间 */
    period: { start: '', end: '' },
    /* 异常阈值 */
    thresholds: null, // 初始化时复制 DEFAULT_THRESHOLDS
    /* 关注的舞弊类型 */
    fraudTypes: ['fake_transaction', 'fund_misappropriation', 'related_party_tunneling', 'illegal_guarantee', 'insider_trading', 'expense_fraud', 'asset_stripping'],
    /* 常用输出形式 */
    outputForm: ['table', 'chart', 'report_file'],
    /* 报告模板偏好 */
    reportTemplate: {
      title: '舞弊调查分析报告（初稿）',
      orgName: '',
      reviewer: '',
      includeCharts: true,
      includeScorecard: true,
      includeQuality: true
    },
    /* 常用对手方白名单（命中的对手方不参与规则标记） */
    whitelist: [],
    /* 上次数据源 */
    lastSource: 'preset',
    /* 最近使用口径历史 */
    history: []
  };

  var M = {};
  var cache = null;

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  M.defaults = function () {
    var d = deepClone(DEFAULTS);
    d.thresholds = deepClone(App.config.DEFAULT_THRESHOLDS);
    return d;
  };

  M.load = function () {
    if (cache) return cache;
    var mem = null;
    try {
      var raw = global.localStorage && global.localStorage.getItem(KEY);
      if (raw) mem = JSON.parse(raw);
    } catch (e) { mem = null; }
    var base = M.defaults();
    if (mem && typeof mem === 'object') {
      Object.keys(base).forEach(function (k) {
        if (mem[k] !== undefined && mem[k] !== null) base[k] = mem[k];
      });
      // 阈值合并（保证新增键有默认值）
      var th = M.defaults().thresholds;
      Object.keys(th).forEach(function (k) { if (base.thresholds[k] === undefined) base.thresholds[k] = th[k]; });
    }
    cache = base;
    return cache;
  };

  M.save = function (patch) {
    var mem = M.load();
    if (patch) Object.keys(patch).forEach(function (k) { mem[k] = patch[k]; });
    try { global.localStorage && global.localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* file:// 某些环境限制，忽略 */ }
    cache = mem;
    if (App.bus) App.bus.emit('memory:changed', mem);
    return mem;
  };

  M.clear = function () {
    cache = M.defaults();
    try { global.localStorage && global.localStorage.removeItem(KEY); } catch (e) {}
    if (App.bus) App.bus.emit('memory:changed', cache);
    return cache;
  };

  /** 记录一次口径使用（用于"口径已变更"对比） */
  M.recordUsage = function (snapshot) {
    var mem = M.load();
    var sig = M.signature(snapshot);
    if (mem.history.length && mem.history[0].sig === sig) return;
    mem.history.unshift({ sig: sig, at: new Date().toISOString(), snapshot: snapshot });
    mem.history = mem.history.slice(0, 10);
    M.save();
  };

  /** 口径签名：用于判断口径是否变更 */
  M.signature = function (snap) {
    snap = snap || {};
    var t = snap.thresholds || {};
    var parts = [
      t.sigma, t.iqrK, t.madZ, t.R01_large_amount, t.R02_round_amount,
      t.R03_split_total, t.R03_split_single_max, t.R04_period_end_amount,
      t.R06_freq_multiple, t.R07_hedge_ratio, t.R08_night_start, t.R08_night_end,
      (snap.period && snap.period.start) || '', (snap.period && snap.period.end) || '',
      (snap.fraudTypes || []).slice().sort().join('|'),
      (snap.whitelist || []).slice().sort().join('|')
    ];
    return parts.join('~');
  };

  /** 口径是否与上一次分析不同 → 提示不可直接比较 */
  M.changedSinceLast = function (snap) {
    var mem = M.load();
    if (!mem.history.length) return false;
    return mem.history[0].sig !== M.signature(snap);
  };

  /** 当前生效口径（记忆 + 本次覆盖），并给出回显文案 */
  M.effective = function (override) {
    var mem = M.load();
    var th = Object.assign({}, App.config.DEFAULT_THRESHOLDS, mem.thresholds || {});
    if (override && override.thresholds) Object.assign(th, override.thresholds);
    var period = (override && override.period) || mem.period || { start: '', end: '' };
    var types = (override && override.fraudTypes) || mem.fraudTypes || [];
    var wl = (override && override.whitelist) || mem.whitelist || [];
    return {
      thresholds: th,
      period: period,
      fraudTypes: types,
      whitelist: wl,
      fromMemory: !!mem.enabled,
      echo: M.describe({ thresholds: th, period: period, fraudTypes: types, whitelist: wl })
    };
  };

  M.describe = function (snap) {
    var t = snap.thresholds || {};
    var p = snap.period || {};
    var seg = [];
    seg.push('期间 ' + ((p.start || p.end) ? ((p.start || '—') + ' ~ ' + (p.end || '—')) : '全量'));
    seg.push('3σ / IQR×' + t.iqrK + ' / MAD>' + t.madZ);
    seg.push('大额≥' + U.money(t.R01_large_amount));
    seg.push('拆分' + t.R03_split_window_days + '日≥' + U.money(t.R03_split_total) + '且单笔<' + U.money(t.R03_split_single_max));
    seg.push('期末' + t.R04_period_end_days + '日≥' + U.money(t.R04_period_end_amount));
    seg.push('夜间 ' + t.R08_night_start + ':00–' + t.R08_night_end + ':00');
    seg.push('舞弊类型 ' + (snap.fraudTypes || []).length + ' 类');
    if ((snap.whitelist || []).length) seg.push('白名单 ' + snap.whitelist.length + ' 个');
    return seg.join('｜');
  };

  /* ---------- 上次会话状态（数据源与缓存） ---------- */
  M.saveState = function (state) {
    try { global.sessionStorage ? global.sessionStorage.setItem(KEY_STATE, JSON.stringify(state)) : null; } catch (e) {}
  };
  M.loadState = function () {
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(KEY_STATE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };

  App.memory = M;
})(typeof window !== 'undefined' ? window : globalThis);
