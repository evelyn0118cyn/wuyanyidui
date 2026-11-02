/* =============================================================
 * 财务舞弊111 · 通用工具（纯函数，无 DOM 依赖，可 Node 单测）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};

  var U = {};

  /* ---------- 数值 ---------- */
  U.num = function (v, dflt) {
    if (v === null || v === undefined || v === '') return dflt === undefined ? 0 : dflt;
    if (typeof v === 'number') return isFinite(v) ? v : (dflt || 0);
    var s = String(v).replace(/[,，\s¥$￥%]/g, '');
    if (s === '-' || s === '—' || s === '') return dflt === undefined ? 0 : dflt;
    var n = parseFloat(s);
    return isFinite(n) ? n : (dflt || 0);
  };
  U.round = function (v, d) { var p = Math.pow(10, d === undefined ? 2 : d); return Math.round((U.num(v) + Number.EPSILON) * p) / p; };
  U.clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  U.sum = function (arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += f ? (f(arr[i], i) || 0) : (U.num(arr[i]) || 0); return t; };
  U.avg = function (arr, f) { return arr.length ? U.sum(arr, f) / arr.length : 0; };
  U.pct = function (v, d) { return (U.num(v) * 100).toFixed(d === undefined ? 1 : d) + '%'; };
  U.safeDiv = function (a, b, dflt) { return !b ? (dflt === undefined ? 0 : dflt) : U.num(a) / U.num(b); };

  /* 金额格式化：>=1 亿显示亿，>=1 万显示万 */
  U.money = function (v, opts) {
    opts = opts || {};
    var n = U.num(v);
    var sign = n < 0 ? '-' : '';
    var a = Math.abs(n);
    var s;
    if (opts.raw) return sign + U.thousands(a.toFixed(2));
    if (a >= 1e8) s = (a / 1e8).toFixed(2) + ' 亿';
    else if (a >= 1e4) s = (a / 1e4).toFixed(2) + ' 万';
    else s = a.toFixed(2);
    return sign + s;
  };
  U.thousands = function (s) {
    var parts = String(s).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  };
  U.moneyRaw = function (v) { return U.thousands(U.num(v).toFixed(2)); };

  /* ---------- 日期 ---------- */
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  U.parseDate = function (v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') {
      // Excel 序列号
      if (v > 20000 && v < 80000) {
        return new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      }
      return new Date(v);
    }
    var s = String(v).trim();
    // 2026-03-05 / 2026/3/5 / 20260305 / 2026-03-05 10:32:00
    var m = s.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(s.replace(/-/g, '/'));
    return isNaN(d.getTime()) ? null : d;
  };
  U.fmtDate = function (v) { var d = U.parseDate(v); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; };
  U.fmtDateCompact = function (v) { var d = U.parseDate(v); return d ? d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) : ''; };
  U.fmtMonth = function (v) { var d = U.parseDate(v); return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) : ''; };
  U.fmtDateTime = function (d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  };
  U.daysBetween = function (a, b) {
    var da = U.parseDate(a), db = U.parseDate(b);
    if (!da || !db) return Infinity;
    return Math.round(Math.abs(db - da) / 86400000);
  };
  U.isWeekend = function (v) { var d = U.parseDate(v); if (!d) return false; var w = d.getDay(); return w === 0 || w === 6; };
  U.daysInMonth = function (y, m) { return new Date(y, m, 0).getDate(); }; // m: 1-12
  U.monthEnd = function (v) { var d = U.parseDate(v); if (!d) return null; return new Date(d.getFullYear(), d.getMonth() + 1, 0); };
  U.daysToMonthEnd = function (v) {
    var d = U.parseDate(v); if (!d) return Infinity;
    var e = U.monthEnd(d);
    return Math.round((e - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000) + 1; // 月末当天=1
  };
  /** 从记账时间字符串取小时：'10:32:00' | '2026-03-05 10:32:00' */
  U.hourOf = function (t) {
    if (t === null || t === undefined || t === '') return null;
    var s = String(t);
    var m = s.match(/(\d{1,2}):(\d{2})/);
    if (m) return +m[1];
    if (/^\d{1,2}$/.test(s)) return +s;
    return null;
  };

  /* ---------- 字符串 ---------- */
  U.levenshtein = function (a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[b.length];
  };
  U.isCompany = function (name) {
    return /(公司|厂|集团|有限|股份|合伙|中心|事务所|研究院|银行|支行|分行|合作社|企业|经营部|商行|店)$/.test(String(name || '').trim()) ||
      /(公司|集团|有限|股份|事务所)/.test(String(name || ''));
  };
  U.cleanName = function (n) {
    return String(n || '').replace(/[\s（）()·.．\-—_]/g, '')
      .replace(/(股份有限公司|有限责任公司|有限公司|公司|集团)/g, '');
  };
  U.containsAny = function (text, arr) {
    var s = String(text || '');
    for (var i = 0; i < arr.length; i++) if (s.indexOf(arr[i]) >= 0) return arr[i];
    return null;
  };
  U.maskIdCard = function (id) {
    var s = String(id || '');
    if (s.length < 8) return s;
    return s.slice(0, 4) + '**********' + s.slice(-4);
  };
  U.maskAccount = function (acc) {
    var s = String(acc || '');
    if (s.length < 8) return s;
    return s.slice(0, 4) + ' **** ' + s.slice(-4);
  };
  U.uid = function (prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  };
  U.escapeHtml = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ---------- 分组 ---------- */
  U.groupBy = function (arr, keyFn) {
    var map = Object.create(null);
    for (var i = 0; i < arr.length; i++) {
      var k = keyFn(arr[i], i);
      (map[k] = map[k] || []).push(arr[i]);
    }
    return map;
  };
  U.uniq = function (arr) { var seen = Object.create(null), out = []; for (var i = 0; i < arr.length; i++) { var k = String(arr[i]); if (!seen[k]) { seen[k] = 1; out.push(arr[i]); } } return out; };
  U.sortBy = function (arr, keyFn, desc) {
    return arr.slice().sort(function (a, b) {
      var ka = keyFn(a), kb = keyFn(b);
      if (ka === kb) return 0;
      var r = ka < kb ? -1 : 1;
      return desc ? -r : r;
    });
  };

  /* ---------- 结果校验：政治正确与合规边界 ---------- */
  U.assertSafeText = function (text) {
    var issues = [];
    var pats = (App.config && App.config.FORBIDDEN_PATTERNS) || [];
    for (var i = 0; i < pats.length; i++) {
      var m = String(text || '').match(pats[i]);
      if (m) issues.push('越界表述：「' + m[0] + '」（应改为"触发风险信号，建议人工核查"）');
    }
    return { ok: issues.length === 0, issues: issues };
  };
  U.sanitizeText = function (text) {
    var s = String(text || '');
    /* 顺序很重要：先处理"建议立案"等较长的短语，避免被短规则截断后留下语病 */
    s = s.replace(/建议立案调查/g, '建议由岗位人员评估是否启动正式调查')
      .replace(/建议立案/g, '建议由岗位人员评估是否启动正式调查')
      .replace(/建议(处理|处罚|处分|问责|辞退|移送司法)[某该]?(员工|人员|负责人|责任人|会计|出纳|经理|总监)?/g, '建议提交岗位人员复核并依职权决定后续程序')
      .replace(/存在舞弊行为/g, '触发多项风险信号')
      .replace(/构成舞弊/g, '触发风险信号')
      .replace(/认定为舞弊/g, '标注为待核实事项')
      .replace(/确定(为|系)舞弊/g, '标记为待核实')
      .replace(/(此人|该人|该员工|该负责人)(存在|涉嫌|确有)(舞弊|犯罪|违法)/g, '$1触发多项风险信号');
    return s;
  };

  App.util = U;
})(typeof window !== 'undefined' ? window : globalThis);
