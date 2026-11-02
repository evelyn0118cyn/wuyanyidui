/* =============================================================
 * 财务舞弊111 · F4 数据自动汇总与采集（auto_collect / data_read）
 *  account_full_aggregation：按科目树逐级汇总发生额与余额，一级至末级全覆盖
 *  借贷平衡校验、数据质量报告、口径差异提示（>5% 高亮）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var AGG = {};

  AGG.run = function (ds, opt) {
    opt = opt || {};
    var data = (ds && ds.data) || ds || {};
    var meta = (ds && ds.meta) || {};
    var subjects = data.subjects || [];
    var ledger = data.gl_ledger || [];
    var entries = data.gl_voucher_entries || [];
    var vouchers = data.gl_vouchers || [];
    var txns = data.bank_transactions || [];

    if (!subjects.length || !ledger.length) {
      return { ok: false, error: '未读取到会计科目表或总账余额（subjects / gl_ledger），无法执行全科目汇总。' };
    }

    /* ---------- 1. 科目树构建 ---------- */
    var byCode = {};
    subjects.forEach(function (s) { byCode[s.subject_code] = s; });
    var children = {};
    subjects.forEach(function (s) {
      var p = s.parent_code || '';
      (children[p] = children[p] || []).push(s.subject_code);
    });
    var roots = subjects.filter(function (s) { return !s.parent_code; }).map(function (s) { return s.subject_code; });

    /* 层级（若数据未给出 level 则按父链推算） */
    subjects.forEach(function (s) {
      var lv = 1, cur = s;
      var guard = 0;
      while (cur && cur.parent_code && guard++ < 20) { lv++; cur = byCode[cur.parent_code]; }
      s.level = lv;
    });
    /* 末级判定 */
    subjects.forEach(function (s) { s.is_leaf = !children[s.subject_code] || !children[s.subject_code].length; });
    var leafCodes = subjects.filter(function (s) { return s.is_leaf; }).map(function (s) { return s.subject_code; });

    /* ---------- 2. 口径确定（期间范围） ---------- */
    var periodSet = U.uniq(ledger.map(function (l) { return l.period; })).sort();
    var range = opt.period && (opt.period.start || opt.period.end) ? opt.period : null;
    var periods = periodSet.filter(function (p) {
      if (!range) return true;
      var ps = p + '-01';
      if (range.start && ps.slice(0, 7) < String(range.start).slice(0, 7)) return false;
      if (range.end && ps.slice(0, 7) > String(range.end).slice(0, 7)) return false;
      return true;
    });
    if (!periods.length) periods = periodSet;

    /* ---------- 3. 末级科目逐期汇总 ---------- */
    var leafAgg = {}; // code → { opening, debit, credit, closing, direction }
    leafCodes.forEach(function (c) { leafAgg[c] = { opening: 0, debit: 0, credit: 0, closing: 0, direction: (byCode[c] || {}).direction || '借', periodCount: 0, firstPeriod: '', lastPeriod: '' }; });

    var unscheduled = []; // 不在科目表中的分录科目
    ledger.forEach(function (l) {
      if (periods.indexOf(l.period) < 0) return;
      var a = leafAgg[l.subject_code];
      if (!a) return; // 父科目行不入账，由末级汇总推导
      if (!a.periodCount) a.opening = U.num(l.opening_balance);
      a.debit = U.round(a.debit + U.num(l.debit_amount), 2);
      a.credit = U.round(a.credit + U.num(l.credit_amount), 2);
      a.closing = U.num(l.closing_balance);
      a.periodCount++;
      if (!a.firstPeriod || l.period < a.firstPeriod) a.firstPeriod = l.period;
      if (!a.lastPeriod || l.period > a.lastPeriod) a.lastPeriod = l.period;
    });

    /* ---------- 4. 逐级向上汇总（一级至末级全覆盖） ---------- */
    var aggMap = {};
    function rollup(code) {
      if (aggMap[code]) return aggMap[code];
      var s = byCode[code] || { subject_code: code, subject_name: code, direction: '' };
      var kids = children[code] || [];
      var node;
      if (!kids.length) {
      var la = leafAgg[code] || { opening: 0, debit: 0, credit: 0, closing: 0, direction: s.direction || '借', periodCount: 0, firstPeriod: '', lastPeriod: '' };
        node = {
          subject_code: code, subject_name: s.subject_name, parent_code: s.parent_code || '', level: s.level || 1,
          direction: la.direction, isLeaf: true,
          opening: U.round(la.opening, 2), debit: U.round(la.debit, 2), credit: U.round(la.credit, 2), closing: U.round(la.closing, 2),
          periodCount: la.periodCount, firstPeriod: la.firstPeriod || '', lastPeriod: la.lastPeriod || '',
          children: [], hasData: !!(la.periodCount)
        };
      } else {
        var opening = 0, debit = 0, credit = 0, closing = 0, hasData = false, pc = 0, fp = '', lp = '';
        kids.forEach(function (k) {
          var kn = rollup(k);
          /* 借贷方向不同的子科目，汇总时按父方向取符号 */
          var sign = kn.direction === s.direction || !s.direction ? 1 : -1;
          opening += kn.opening * sign;
          closing += kn.closing * sign;
          debit += kn.debit;
          credit += kn.credit;
          if (kn.hasData) hasData = true;
          pc += kn.periodCount || 0;
          if (kn.firstPeriod && (!fp || kn.firstPeriod < fp)) fp = kn.firstPeriod;
          if (kn.lastPeriod && (!lp || kn.lastPeriod > lp)) lp = kn.lastPeriod;
        });
        node = {
          subject_code: code, subject_name: s.subject_name, parent_code: s.parent_code || '', level: s.level || 1,
          direction: s.direction || '借', isLeaf: false,
          opening: U.round(opening, 2), debit: U.round(debit, 2), credit: U.round(credit, 2), closing: U.round(closing, 2),
          periodCount: pc, firstPeriod: fp, lastPeriod: lp,
          children: kids, hasData: hasData
        };
      }
      aggMap[code] = node;
      return node;
    }
    roots.forEach(rollup);
    /* 确保所有科目都入表（含孤儿子科目） */
    subjects.forEach(function (s) { if (!aggMap[s.subject_code]) rollup(s.subject_code); });

    /* 表格输出（按编码排序，层级缩进） */
    var rows = Object.keys(aggMap).map(function (k) { return aggMap[k]; })
      .sort(function (a, b) { return a.subject_code < b.subject_code ? -1 : a.subject_code > b.subject_code ? 1 : 0; });

    /* ---------- 5. 借贷平衡校验 ---------- */
    var totalDebit = U.sum(rows.filter(function (r) { return r.isLeaf; }), function (r) { return r.debit; });
    var totalCredit = U.sum(rows.filter(function (r) { return r.isLeaf; }), function (r) { return r.credit; });
    var diff = U.round(totalDebit - totalCredit, 2);

    /* 按期间校验 */
    var periodBalance = periods.map(function (p) {
      var d = 0, c = 0;
      ledger.forEach(function (l) {
        if (l.period !== p || leafCodes.indexOf(l.subject_code) < 0) return;
        d += U.num(l.debit_amount); c += U.num(l.credit_amount);
      });
      return { period: p, debit: U.round(d, 2), credit: U.round(c, 2), diff: U.round(d - c, 2), ok: Math.abs(d - c) < 0.01 };
    });

    /* ---------- 6. 凭证级借贷平衡 ---------- */
    var vAgg = {};
    entries.forEach(function (e) {
      var k = e.voucher_id || e.voucher_no;
      var g = vAgg[k] || (vAgg[k] = { voucher_id: k, voucher_no: e.voucher_no, date: U.fmtDate(e.voucher_date), period: e.period, debit: 0, credit: 0 });
      g.debit += U.num(e.debit); g.credit += U.num(e.credit);
    });
    var unbalanced = Object.keys(vAgg).map(function (k) { return vAgg[k]; })
      .filter(function (v) { return Math.abs(v.debit - v.credit) > 0.01; })
      .map(function (v) { return { voucher_id: v.voucher_id, voucher_no: v.voucher_no, date: v.date, period: v.period, debit: U.round(v.debit, 2), credit: U.round(v.credit, 2), diff: U.round(v.debit - v.credit, 2) }; });

    /* ---------- 7. 数据质量报告 ---------- */
    var QUALITY_IMPACT = {
      null_values: '空值会导致规则判定缺失，相关指标可能被低估',
      duplicates: '重复记录会放大金额与频次指标，导致误报',
      unbalanced_voucher: '借贷不平凭证影响科目余额正确性，需先调平再分析',
      unmatched_bank: '未勾对流水无法确认业务支撑关系，R09 判定可能失真',
      cross_period: '跨期记录会使期间归属错乱，影响期末突击等规则',
      missing_fk: '主数据缺失导致关联方比对与对手方分析不完整',
      unscheduled_subject: '存在科目表中的缺失科目，全科目汇总可能不完整'
    };
    var quality = [];

    /* 7.1 空值率 */
    var nullIssues = [];
    [['bank_transactions', ['amount', 'txn_date', 'counterparty_name', 'direction']],
     ['gl_voucher_entries', ['subject_code', 'debit', 'credit']],
     ['gl_ledger', ['subject_code', 'opening_balance', 'closing_balance']]].forEach(function (cfg) {
      var tbl = data[cfg[0]] || [];
      if (!tbl.length) return;
      cfg[1].forEach(function (f) {
        var cnt = tbl.filter(function (r) { return r[f] === undefined || r[f] === null || r[f] === ''; }).length;
        if (cnt) nullIssues.push({ table: cfg[0], field: f, count: cnt, ratio: cnt / tbl.length, sample: tbl.filter(function (r) { return r[f] === undefined || r[f] === null || r[f] === ''; })[0] });
      });
    });
    if (nullIssues.length) {
      quality.push({
        type: '空值率', code: 'null_values', count: U.sum(nullIssues, function (x) { return x.count; }),
        detail: nullIssues.map(function (x) { return App.config.TABLES[x.table].cn + '.' + x.field + ' 空值 ' + x.count + ' 条（' + (x.ratio * 100).toFixed(1) + '%）'; }).join('；'),
        sample: JSON.stringify(nullIssues[0].sample || {}).slice(0, 160),
        impact: QUALITY_IMPACT.null_values
      });
    }

    /* 7.2 重复记录（同一业务键重复出现） */
    var dupTargets = [['bank_transactions', function (t) { return [t.txn_date, t.account_id, t.counterparty_name, t.amount, t.direction, t.purpose].join('|'); }],
                      ['gl_voucher_entries', function (e) { return [e.voucher_id, e.subject_code, e.debit, e.credit, e.counterparty].join('|'); }]];
    var dupTotal = 0, dupDetail = [], dupRows = [];
    dupTargets.forEach(function (cfg) {
      var tbl = data[cfg[0]] || [];
      var seen = {}, dups = [];
      tbl.forEach(function (r) { var k = cfg[1](r); if (seen[k]) dups.push(r); else seen[k] = 1; });
      if (dups.length) { dupTotal += dups.length; dupDetail.push(App.config.TABLES[cfg[0]].cn + ' 重复 ' + dups.length + ' 条'); dupRows = dupRows.concat(dups.slice(0, 5)); }
    });
    if (dupTotal) quality.push({ type: '重复记录', code: 'duplicates', count: dupTotal, detail: dupDetail.join('；'), sample: JSON.stringify(dupRows[0] || {}).slice(0, 160), impact: QUALITY_IMPACT.duplicates });

    /* 7.3 借贷不平凭证 */
    if (unbalanced.length) {
      quality.push({
        type: '借贷不平凭证', code: 'unbalanced_voucher', count: unbalanced.length,
        detail: unbalanced.slice(0, 5).map(function (v) { return v.voucher_no + '（' + v.date + '，差额 ' + U.moneyRaw(v.diff) + ' 元）'; }).join('；'),
        sample: JSON.stringify(unbalanced[0]),
        impact: QUALITY_IMPACT.unbalanced_voucher,
        rows: unbalanced
      });
    }

    /* 7.4 未匹配银企对账 */
    var unmatched = txns.filter(function (t) { return U.num(t.matched, 1) === 0; });
    if (unmatched.length) {
      quality.push({
        type: '未匹配银企对账', code: 'unmatched_bank', count: unmatched.length,
        detail: '共 ' + unmatched.length + ' 笔、金额 ' + U.money(U.sum(unmatched, function (t) { return U.num(t.amount); })) + ' 的流水 matched=0',
        sample: (unmatched[0].txn_date || '') + ' ' + (unmatched[0].counterparty_name || '') + ' ' + U.money(unmatched[0].amount),
        impact: QUALITY_IMPACT.unmatched_bank
      });
    }

    /* 7.5 跨期记录：凭证期间与凭证日期所属月份不一致 */
    var crossPeriod = entries.filter(function (e) {
      if (!e.period || !e.voucher_date) return false;
      return U.fmtMonth(e.voucher_date) !== e.period;
    });
    if (crossPeriod.length) {
      quality.push({
        type: '跨期记录', code: 'cross_period', count: crossPeriod.length,
        detail: '凭证日期所属月份与记账期间不一致，共 ' + crossPeriod.length + ' 条分录',
        sample: (crossPeriod[0].voucher_no || '') + ' 期间 ' + crossPeriod[0].period + ' / 日期 ' + U.fmtDate(crossPeriod[0].voucher_date),
        impact: QUALITY_IMPACT.cross_period
      });
    }

    /* 7.6 主数据缺失外键 */
    var fkIssues = [];
    var custNames = {}, supNames = {}, empNamesMap = {};
    (data.customers || []).forEach(function (c) { custNames[c.customer_name] = 1; });
    (data.suppliers || []).forEach(function (s) { supNames[s.supplier_name] = 1; });
    (data.employees || []).forEach(function (e) { empNamesMap[e.employee_name] = 1; });
    var orphanCp = txns.filter(function (t) {
      var n = String(t.counterparty_name || '');
      if (!n) return true;
      return !custNames[n] && !supNames[n] && !empNamesMap[n] && !/^[\u4e00-\u9fa5]{2,4}$/.test(n);
    });
    if (orphanCp.length) fkIssues.push('流水对手方 ' + orphanCp.length + ' 个无法匹配客户/供应商/员工档案');
    var accountIds = {};
    (data.bank_accounts || []).forEach(function (a) { accountIds[a.account_id] = 1; });
    var orphanAcc = txns.filter(function (t) { return t.account_id && !accountIds[t.account_id]; });
    if (orphanAcc.length) fkIssues.push('流水账户 ' + orphanAcc.length + ' 条引用不存在的银行账户');
    var orphanEntry = entries.filter(function (e) { return e.voucher_id && !vAgg[e.voucher_id]; });
    var missingSubj = entries.filter(function (e) { return e.subject_code && !byCode[e.subject_code]; });
    if (missingSubj.length) fkIssues.push('分录科目 ' + U.uniq(missingSubj.map(function (e) { return e.subject_code; })).length + ' 个不在科目表中');
    if (fkIssues.length) {
      quality.push({ type: '主数据缺失外键', code: 'missing_fk', count: orphanCp.length + orphanAcc.length + missingSubj.length, detail: fkIssues.join('；'), sample: '', impact: QUALITY_IMPACT.missing_fk });
    }

    /* 7.7 科目表缺失科目 */
    if (unscheduled.length) {
      quality.push({ type: '科目表缺失科目', code: 'unscheduled_subject', count: unscheduled.length, detail: unscheduled.slice(0, 8).join('、'), sample: '', impact: QUALITY_IMPACT.unscheduled_subject });
    }

    /* ---------- 8. 口径说明卡 ---------- */
    var caliber = {
      periods: periods,
      periodCount: periods.length,
      periodRange: periods.length ? periods[0] + ' ~ ' + periods[periods.length - 1] : '',
      subjectCount: subjects.length,
      leafCount: leafCodes.length,
      levelCount: U.uniq(subjects.map(function (s) { return s.level; })).length,
      currency: meta.currency || 'CNY',
      unit: '元',
      source: meta.label || meta.source || '预置数据',
      aggregation: '末级科目取总账发生额与余额，逐级向上汇总至一级科目（父级 = Σ子级，按父级方向调整符号）',
      balanceRule: '借方余额类：期末 = 期初 + 借方 − 贷方；贷方余额类：期末 = 期初 − 借方 + 贷方'
    };

    /* ---------- 9. 口径差异提示（上传 vs 预置/数据库，>5% 高亮） ---------- */
    var caliberDiffs = [];
    if (opt.compareTo) {
      var other = opt.compareTo;
      (other.data && other.data.bank_transactions || []).forEach(function () {});
      var thisTxnAmt = U.sum(txns, function (t) { return U.num(t.amount); });
      var otherTxns = (other.data && other.data.bank_transactions) || [];
      var otherTxnAmt = U.sum(otherTxns, function (t) { return U.num(t.amount); });
      if (otherTxnAmt > 0) {
        var d2 = Math.abs(thisTxnAmt - otherTxnAmt) / Math.max(thisTxnAmt, otherTxnAmt);
        caliberDiffs.push({
          metric: '银行流水发生额合计', current: thisTxnAmt, other: otherTxnAmt, diffRatio: d2,
          note: d2 > 0.05 ? '差异超过 5%，结论不可直接比较，需先统一口径' : '差异在 5% 以内'
        });
      }
      var thisCnt = txns.length, otherCnt = otherTxns.length;
      if (otherCnt > 0) {
        var d3 = Math.abs(thisCnt - otherCnt) / Math.max(thisCnt, otherCnt);
        caliberDiffs.push({
          metric: '银行流水笔数', current: thisCnt, other: otherCnt, diffRatio: d3,
          note: d3 > 0.05 ? '差异超过 5%，可能存在漏取/重复取数' : '差异在 5% 以内'
        });
      }
    }

    var warnings = [];
    if (Math.abs(diff) > 0.01) warnings.push('全科目借方发生额与贷方发生额不平，差额 ' + U.moneyRaw(diff) + ' 元，建议先核查凭证完整性再进行分析。');
    if (unbalanced.length) warnings.push('存在 ' + unbalanced.length + ' 张借贷不平凭证，相关科目余额与汇总结果可能受影响。');
    if (caliber.periodCount > 1) warnings.push('汇总期间跨 ' + caliber.periodCount + ' 个月（' + caliber.periodRange + '），期末余额为最后期间值，发生额为期间累计。');

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      rows: rows,
      leafRows: rows.filter(function (r) { return r.isLeaf; }),
      caliber: caliber,
      balance: {
        totalDebit: U.round(totalDebit, 2),
        totalCredit: U.round(totalCredit, 2),
        diff: diff,
        balanced: Math.abs(diff) < 0.01,
        byPeriod: periodBalance,
        unbalancedVouchers: unbalanced
      },
      quality: quality,
      qualityTotals: { issueTypes: quality.length, issueCount: U.sum(quality, function (q) { return q.count; }) },
      caliberDiffs: caliberDiffs,
      warnings: warnings
    };
  };

  App.aggregation = AGG;
})(typeof window !== 'undefined' ? window : globalThis);
