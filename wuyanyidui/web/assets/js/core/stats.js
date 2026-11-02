/* =============================================================
 * 财务舞弊111 · 统计工具（纯函数）
 * 提供 3σ / IQR / MAD 三种离群口径，全部输出中间量以便复核。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var S = {};

  S.mean = function (a) { return a.length ? U.sum(a) / a.length : 0; };

  S.stdev = function (a, sample) {
    if (a.length < 2) return 0;
    var m = S.mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return Math.sqrt(s / (a.length - (sample ? 1 : 0)));
  };

  /** 分位数（线性插值，与 Excel QUARTILE.INC 一致） */
  S.quantile = function (sorted, q) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };

  S.median = function (a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return S.quantile(s, 0.5);
  };

  S.mad = function (a) {
    if (!a.length) return 0;
    var m = S.median(a);
    return S.median(a.map(function (x) { return Math.abs(x - m); }));
  };

  /**
   * 计算一组金额的统计基线，返回可复核的中间量。
   * @param {number[]} values 金额（绝对值）
   * @param {object} th 阈值配置（sigma / iqrK / madZ）
   */
  S.baseline = function (values, th) {
    th = th || {};
    var sigma = U.num(th.sigma, 3), iqrK = U.num(th.iqrK, 1.5), madZ = U.num(th.madZ, 3.5);
    var n = values.length;
    var nums = values.filter(function (v) { return isFinite(v); });
    if (!n) {
      return { n: 0, mean: 0, stdev: 0, median: 0, mad: 0, q1: 0, q3: 0, iqr: 0, upper: 0, lower: 0, sigmaLimit: 0, iqrLimit: 0, madLimit: 0, sigma: sigma, iqrK: iqrK, madZ: madZ, usable: false, reason: '无有效金额样本' };
    }
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    var mean = S.mean(nums), stdev = S.stdev(nums, true);
    var q1 = S.quantile(sorted, 0.25), q3 = S.quantile(sorted, 0.75), iqr = q3 - q1;
    var med = S.quantile(sorted, 0.5), mad = S.mad(nums);
    var sigmaLimit = mean + sigma * stdev;
    var iqrLimit = q3 + iqrK * iqr;
    /* MAD 修正 Z：0.6745 * |x-med| / MAD > madZ  →  x > med + madZ*mad/0.6745 */
    var madLimit = mad > 0 ? med + madZ * mad / 0.6745 : Infinity;
    var usable = n >= 8 && stdev > 0;
    return {
      n: n, mean: mean, stdev: stdev, median: med, mad: mad,
      q1: q1, q3: q3, iqr: iqr,
      sigmaLimit: sigmaLimit, iqrLimit: iqrLimit, madLimit: madLimit,
      upper: Math.max(sigmaLimit, iqrLimit),
      sigma: sigma, iqrK: iqrK, madZ: madZ,
      usable: usable,
      reason: usable ? '' : (n < 8 ? '样本量 ' + n + ' 条 < 8，统计离群检测结果参考价值有限' : '金额无波动（σ=0），统计离群失效')
    };
  };

  /**
   * 单值离群判定，返回命中明细
   */
  S.evalValue = function (x, b) {
    if (!b || !b.usable) return { hit: false, reasons: [], devScore: 0 };
    var reasons = [], dev = 0;
    var z = b.stdev ? (x - b.mean) / b.stdev : 0;
    if (Math.abs(z) > b.sigma) { reasons.push('3σ'); }
    if (x > b.iqrLimit) { reasons.push('IQR'); }
    var mz = b.mad > 0 ? 0.6745 * Math.abs(x - b.median) / b.mad : 0;
    if (mz > b.madZ) { reasons.push('MAD'); }
    dev = Math.max(Math.abs(z), b.iqr !== 0 ? Math.abs(x - b.q3) / b.iqr : 0, mz);
    return { hit: reasons.length > 0, reasons: reasons, z: z, madZ: mz, devScore: dev };
  };

  /** 箱线图五数概括 + 离群点 */
  S.boxplot = function (values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var q1 = S.quantile(s, 0.25), q2 = S.quantile(s, 0.5), q3 = S.quantile(s, 0.75), iqr = q3 - q1;
    var lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    return {
      min: s.length ? s[0] : 0, q1: q1, median: q2, q3: q3, max: s.length ? s[s.length - 1] : 0,
      iqr: iqr, hiFence: hi, loFence: lo,
      outliers: s.filter(function (v) { return v > hi || v < lo; })
    };
  };

  /* 正态分布近似 p 值（用于说明偏离程度，非显著性检验结论） */
  S.normalCdf = function (z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp(-z * z / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };

  App.stats = S;
})(typeof window !== 'undefined' ? window : globalThis);
