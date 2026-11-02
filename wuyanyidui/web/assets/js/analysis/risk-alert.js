/* =============================================================
 * 财务舞弊111 · F1 风险信号识别与预警（risk_alert）
 * 双路筛查：统计异常（3σ / IQR / MAD）+ 规则异常（R01–R09）
 * 所有命中均输出「命中依据」中间量，供人工复核。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, S = App.stats;

  var RISK = {};
  var RISK_LEVELS = { high: '高', mid: '中', low: '低' };

  /* 规则字典（R01–R09） */
  var RULES = {
    R01: { code: 'R01', name: '大额', desc: '单笔金额超过大额阈值' },
    R02: { code: 'R02', name: '整数', desc: '金额为 10 万整数倍且达到门槛' },
    R03: { code: 'R03', name: '拆分', desc: '同一对手方短窗口内多笔小额累计超过阈值' },
    R04: { code: 'R04', name: '期末突击', desc: '会计期间最后 N 个自然日发生的大额交易' },
    R05: { code: 'R05', name: '个人卡', desc: '对手方为自然人且用途非工资/报销' },
    R06: { code: 'R06', name: '高频', desc: '同一对手方单月笔数显著超过其历史月均' },
    R07: { code: 'R07', name: '双向对冲', desc: '短期与同一对手方收付金额近似相等' },
    R08: { code: 'R08', name: '非工作时间', desc: '记账时间处于夜间或非工作日' },
    R09: { code: 'R09', name: '无业务支撑', desc: '流水有金额但无对应凭证分录或业务记录' }
  };

  /* 规则 → 七类舞弊 映射 */
  var RULE_TO_FRAUD = {
    R01: ['fake_transaction', 'fund_misappropriation'],
    R02: ['fake_transaction', 'expense_fraud'],
    R03: ['fake_transaction', 'fund_misappropriation'],
    R04: ['fake_transaction', 'insider_trading', 'asset_stripping'],
    R05: ['fund_misappropriation', 'related_party_tunneling'],
    R06: ['fake_transaction', 'related_party_tunneling'],
    R07: ['fake_transaction', 'fund_misappropriation'],
    R08: ['fund_misappropriation', 'insider_trading'],
    R09: ['fake_transaction', 'asset_stripping', 'expense_fraud']
  };

  function isPersonName(name, cpIsPerson, empNames) {
    if (cpIsPerson) return true;
    var n = String(name || '').trim();
    if (!n) return false;
    if (U.isCompany(n)) return false;
    if (empNames[n]) return true;
    return /^[\u4e00-\u9fa5]{2,4}$/.test(n) || /^(张|王|李|赵|刘|陈|杨|黄|周|吴|徐|孙|马|朱|胡|郭|何|罗|高|林|郑|梁|谢|宋|唐|许|韩|冯|邓|曹|彭|曾|萧|田|董|袁|潘|蒋|蔡|余|杜|叶|程|苏|魏|吕|丁|任|沈|姚|卢|姜|崔|钟|谭|陆|汪|范|金|石|廖|贾|夏|韦|付|方|白|邹|孟|熊|秦|邱|江|尹|薛|闫|段|雷|侯|龙|史|陶|黎|贺|顾|毛|郝|龚|邵|万|钱|严|覃|武|戴|莫|孔|向|汤)\S{0,2}$/.test(n);
  }

  /**
   * 主入口
   * @param {object} ds { data, meta }
   * @param {object} opt { thresholds, period, whitelist, fraudTypes }
   */
  RISK.run = function (ds, opt) {
    opt = opt || {};
    var data = ds.data || ds;
    var meta = ds.meta || {};
    var th = opt.thresholds || Object.assign({}, App.config.DEFAULT_THRESHOLDS);
    var whitelist = (opt.whitelist || []).map(function (w) { return String(w).trim(); }).filter(Boolean);
    var focusTypes = opt.fraudTypes && opt.fraudTypes.length ? opt.fraudTypes : App.config.FRAUD_TYPES.map(function (f) { return f.code; });
    var period = opt.period || { start: '', end: '' };

    var warnings = [];       // 结果校验提示
    var caliberNotes = [];   // 口径说明
    var t0 = Date.now();

    var txns = (data.bank_transactions || []).slice();
    var entries = data.gl_voucher_entries || [];
    var vouchers = data.gl_vouchers || [];
    var employees = data.employees || [];
    var whitelistHit = [];

    /* ---------- 0. 口径校验 ---------- */
    if (!txns.length) {
      return { ok: false, error: '未读取到银行流水数据（bank_transactions 为空），请先到「数据汇总」接入数据。', rules: RULES, signals: [], stats: null, warnings: [], caliberNotes: [] };
    }
    var empNames = {};
    employees.forEach(function (e) { empNames[e.employee_name] = 1; });

    /* 期间过滤 */
    txns = txns.filter(function (t) {
      var d = U.fmtDate(t.txn_date);
      if (!d) return false;
      if (period.start && d < period.start) return false;
      if (period.end && d > period.end) return false;
      return true;
    });
    caliberNotes.push('统计期间：' + ((period.start || period.end) ? ((period.start || '—') + ' ~ ' + (period.end || '—')) : '全量（' + U.fmtDate(txns[0] && txns[0].txn_date) + ' ~ ' + U.fmtDate(txns[txns.length - 1] && txns[txns.length - 1].txn_date) + '）'));
    caliberNotes.push('科目范围：全科目（银行流水全量 + 凭证分录全量）');
    caliberNotes.push('币种/单位：CNY / 元');

    /* 白名单过滤 */
    if (whitelist.length) {
      var before = txns.length;
      txns = txns.filter(function (t) {
        var hit = whitelist.some(function (w) { return String(t.counterparty_name || '').indexOf(w) >= 0; });
        if (hit) whitelistHit.push(t.counterparty_name);
        return !hit;
      });
      caliberNotes.push('已应用对手方白名单 ' + whitelist.length + ' 项，过滤 ' + (before - txns.length) + ' 笔');
    }

    var amounts = txns.map(function (t) { return Math.abs(U.num(t.amount)); });
    var baseline = S.baseline(amounts, th);

    /* ---------- 1. 统计离群筛查 ---------- */
    var statHits = 0;
    var signals = [];
    var cpAgg = {}; // 对手方聚合

    /* 预建对手方统计 */
    txns.forEach(function (t) {
      var cp = String(t.counterparty_name || '未署名');
      var a = cpAgg[cp] || (cpAgg[cp] = { name: cp, count: 0, amount: 0, months: {}, dates: [], txns: [] });
      a.count++; a.amount += Math.abs(U.num(t.amount));
      var m = U.fmtMonth(t.txn_date);
      a.months[m] = (a.months[m] || 0) + 1;
      a.txns.push(t);
    });

    /* R06 历史月均基线（排除单月最大值后的月均值，避免单月异常拉高基线） */
    function cpMonthBaseline(cp) {
      var months = Object.keys(cpAgg[cp].months);
      var counts = months.map(function (m) { return cpAgg[cp].months[m]; });
      if (counts.length < 3) return null;
      var max = Math.max.apply(null, counts);
      var rest = counts.filter(function (c) { return c !== max; });
      return { months: counts.length, max: max, avg: rest.length ? U.sum(rest) / rest.length : 0, all: counts };
    }

    /* R03 拆分检测：同对手方窗口内多笔小额 */
    var splitGroups = [];
    Object.keys(cpAgg).forEach(function (cpName) {
      var list = cpAgg[cpName].txns.slice().sort(function (a, b) { return U.parseDate(a.txn_date) - U.parseDate(b.txn_date); });
      var win = U.num(th.R03_split_window_days, 7), totalLimit = U.num(th.R03_split_total, 200000), singleMax = U.num(th.R03_split_single_max, 50000);
      var i = 0;
      while (i < list.length) {
        var base = U.parseDate(list[i].txn_date);
        if (!base) { i++; continue; }
        var group = [];
        var j = i;
        while (j < list.length) {
          var dt = U.daysBetween(base, list[j].txn_date);
          if (dt > win) break;
          var amt = Math.abs(U.num(list[j].amount));
          if (amt < singleMax && amt > 0) group.push(list[j]);
          j++;
        }
        var tot = U.sum(group, function (g) { return Math.abs(U.num(g.amount)); });
        if (group.length >= 3 && tot >= totalLimit) {
          splitGroups.push({ counterparty: cpName, days: win, count: group.length, total: tot, txns: group });
        }
        i = Math.max(j, i + 1);
      }
    });
    var splitTxnIds = {};
    splitGroups.forEach(function (g) { g.txns.forEach(function (t) { splitTxnIds[t.txn_id] = g; }); });

    /* R07 双向对冲检测：同对手方短期收付近似相等 */
    var hedgePairs = {};
    Object.keys(cpAgg).forEach(function (cpName) {
      var list = cpAgg[cpName].txns.slice().sort(function (a, b) { return U.parseDate(a.txn_date) - U.parseDate(b.txn_date); });
      var win = U.num(th.R07_hedge_days, 15), ratio = U.num(th.R07_hedge_ratio, 0.10);
      for (var i = 0; i < list.length; i++) {
        var A = list[i];
        var aAmt = Math.abs(U.num(A.amount));
        if (aAmt < 10000) continue;
        for (var j = i + 1; j < list.length; j++) {
          var B = list[j];
          if (U.daysBetween(A.txn_date, B.txn_date) > win) break;
          if (A.direction === B.direction) continue;
          var bAmt = Math.abs(U.num(B.amount));
          if (!bAmt) continue;
          var diff = Math.abs(aAmt - bAmt) / Math.max(aAmt, bAmt);
          if (diff <= ratio) {
            var key = A.txn_id;
            hedgePairs[A.txn_id] = { peer: B, ratio: diff, days: U.daysBetween(A.txn_date, B.txn_date) };
            hedgePairs[B.txn_id] = { peer: A, ratio: diff, days: U.daysBetween(A.txn_date, B.txn_date) };
            break;
          }
        }
      }
    });

    /* R09 业务支撑对照索引 */
    var voucherByNo = {};
    vouchers.forEach(function (v) { voucherByNo[v.voucher_no] = v; });
    var voucherIds = {};
    vouchers.forEach(function (v) { voucherIds[v.voucher_id] = v; });

    /* 逐笔判定 */
    txns.forEach(function (t) {
      var amt = Math.abs(U.num(t.amount));
      var hits = [];   // {code, detail, evidence}
      var txnDate = U.parseDate(t.txn_date);
      var cp = String(t.counterparty_name || '未署名');

      /* --- 统计离群 --- */
      var ev = S.evalValue(amt, baseline);
      var statHit = ev.hit;

      /* --- R01 大额 --- */
      if (amt >= U.num(th.R01_large_amount, 500000)) {
        hits.push({ code: 'R01', detail: '单笔 ' + U.money(amt) + ' ≥ 阈值 ' + U.money(th.R01_large_amount), evidence: '金额 ' + U.moneyRaw(amt) + ' 元' });
      }
      /* --- R02 整数 --- */
      var roundBase = U.num(th.R02_round_amount, 100000);
      if (roundBase > 0 && amt >= roundBase && amt % roundBase === 0) {
        hits.push({ code: 'R02', detail: '金额为 ' + (roundBase / 10000) + ' 万整数倍且 ≥ ' + U.money(roundBase), evidence: '金额 ' + U.moneyRaw(amt) + ' 元 = ' + (amt / roundBase) + ' × ' + U.money(roundBase) });
      }
      /* --- R03 拆分 --- */
      if (splitTxnIds[t.txn_id]) {
        var g = splitTxnIds[t.txn_id];
        hits.push({ code: 'R03', detail: '与同对手方 ' + g.days + ' 日内 ' + g.count + ' 笔小额累计 ' + U.money(g.total) + ' ≥ ' + U.money(th.R03_split_total), evidence: '组内笔数 ' + g.count + '，单笔均 < ' + U.money(th.R03_split_single_max) });
      }
      /* --- R04 期末突击 --- */
      var dte = U.daysToMonthEnd(txnDate);
      var peDays = U.num(th.R04_period_end_days, 5);
      var peAmt = U.num(th.R04_period_end_amount, 200000);
      if (dte <= peDays && amt >= peAmt) {
        hits.push({ code: 'R04', detail: '发生于会计期间最后 ' + dte + ' 天（≤' + peDays + ' 天）且金额 ≥ ' + U.money(peAmt), evidence: '距月末 ' + dte + ' 天，金额 ' + U.money(amt) });
      }
      /* --- R05 个人卡 --- */
      if (th.R05_personal_card !== false) {
        var purpose = String(t.purpose || '');
        var isSalary = U.containsAny(purpose, App.config.PERSONAL_PURPOSE_OK);
        if (isPersonName(cp, U.num(t.counterparty_is_person) === 1, empNames) && !isSalary) {
          var isEmp = !!empNames[cp];
          hits.push({ code: 'R05', detail: '对手方「' + cp + '」为自然人' + (isEmp ? '（本单位员工）' : '') + '，用途「' + (purpose || '未注明') + '」非工资/报销', evidence: isEmp ? '姓名命中员工档案' : '名称符合自然人特征且非工资/报销用途' });
        }
      }
      /* --- R06 高频 --- */
      var mb = cpMonthBaseline(cp);
      if (mb && mb.avg > 0) {
        var thisMonth = U.fmtMonth(t.txn_date);
        var thisCount = mb.all ? cpAgg[cp].months[thisMonth] : 0;
        var multiple = U.num(th.R06_freq_multiple, 3);
        if (thisCount > mb.avg * multiple) {
          hits.push({ code: 'R06', detail: cp + ' 本月 ' + thisCount + ' 笔 > 历史月均 ' + U.round(mb.avg, 2) + ' 笔 × ' + multiple, evidence: '月份 ' + thisMonth + '，历史月均（剔除峰值）' + U.round(mb.avg, 2) + ' 笔' });
        }
      }
      /* --- R07 双向对冲 --- */
      if (hedgePairs[t.txn_id]) {
        var hp = hedgePairs[t.txn_id];
        hits.push({ code: 'R07', detail: '与同对手方 ' + hp.days + ' 日内反向交易金额差异仅 ' + (hp.ratio * 100).toFixed(1) + '%', evidence: '配对交易 ' + hp.peer.txn_id + '（' + hp.peer.direction + ' ' + U.money(hp.peer.amount) + ' / ' + U.fmtDate(hp.peer.txn_date) + '）' });
      }
      /* --- R08 非工作时间 --- */
      var hour = U.hourOf(t.txn_time);
      var ns = U.num(th.R08_night_start, 22), ne = U.num(th.R08_night_end, 6);
      var isNight = hour !== null && (hour >= ns || hour < ne);
      var isWeekend = U.isWeekend(txnDate);
      if (isNight || isWeekend) {
        hits.push({ code: 'R08', detail: (isNight ? '记账时间 ' + (hour < 10 ? '0' + hour : hour) + ':xx 处于夜间时段' : '') + (isNight && isWeekend ? '，' : '') + (isWeekend ? '交易发生于非工作日' : ''), evidence: '时间 ' + (t.txn_time || '未知') + '，日期 ' + U.fmtDate(txnDate) + (isWeekend ? '（周末）' : '') });
      }
      /* --- R09 无业务支撑 --- */
      if (th.R09_require_voucher !== false) {
        var noVoucher = !t.voucher_no || !voucherByNo[t.voucher_no];
        var matchedOff = U.num(t.matched, 1) === 0;
        if (noVoucher && matchedOff) {
          hits.push({ code: 'R09', detail: '流水无对应记账凭证且未勾对银企对账', evidence: 'voucher_no=' + (t.voucher_no || '空') + '，matched=0' });
        } else if (!t.contract_no || !t.invoice_no) {
          /* 缺少合同号或发票号，作为弱支撑提示（仅在同时命中其他规则时计入） */
          hits.push({ code: 'R09', detail: '缺少' + (!t.contract_no ? '合同号' : '') + (!t.contract_no && !t.invoice_no ? '与' : '') + (!t.invoice_no ? '发票号' : '') + '，四流支撑不完整', evidence: 'contract_no=' + (t.contract_no || '空') + '，invoice_no=' + (t.invoice_no || '空'), weak: true });
        }
      }

      var strongHits = hits.filter(function (h) { return !h.weak; });
      if (!statHit && !strongHits.length) return;

      /* --- 舞弊类型映射 --- */
      var fraudScore = {};
      strongHits.forEach(function (h) {
        (RULE_TO_FRAUD[h.code] || []).forEach(function (ft) {
          if (focusTypes.indexOf(ft) < 0) return;
          fraudScore[ft] = (fraudScore[ft] || 0) + 1;
        });
      });
      var fraudTypes = Object.keys(fraudScore).sort(function (a, b) { return fraudScore[b] - fraudScore[a]; });
      var primary = fraudTypes[0] || (statHit ? 'fake_transaction' : 'fake_transaction');

      /* --- 参考风险等级：规则种类 + 统计离群 + 金额规模 ---
       * 说明：此为"参考等级"，仅用于排定人工复核顺序，不构成异常定性。 */
      var ruleKinds = U.uniq(strongHits.map(function (h) { return h.code; }));
      var lvl = 0;
      if (statHit) lvl += 1;
      if (ruleKinds.length >= 2) lvl += 1;
      if (ruleKinds.length >= 3) lvl += 1;
      if (ruleKinds.length >= 4) lvl += 1;
      /* 结构性规则（拆分/对冲/无业务支撑/个人卡）权重大于单纯金额大 */
      if (ruleKinds.indexOf('R03') >= 0 || ruleKinds.indexOf('R07') >= 0) lvl += 1;
      if (ruleKinds.indexOf('R09') >= 0) lvl += 1;
      if (ruleKinds.indexOf('R05') >= 0) lvl += 1;
      /* 仅命中 R08（非工作时间）或 R01（大额）这类单因素规则时，不单独升级为高 */
      var softOnly = ruleKinds.every(function (c) { return c === 'R08' || c === 'R01' || c === 'R06'; });
      if (softOnly) lvl = Math.min(lvl, 3);
      var level = lvl >= 5 ? 'high' : lvl >= 3 ? 'mid' : 'low';

      if (statHit) statHits++;
      signals.push({
        id: 'SIG-' + signals.length.toString().padStart(4, '0'),
        txn_id: t.txn_id,
        txn_date: U.fmtDate(t.txn_date),
        txn_time: t.txn_time,
        account_id: t.account_id,
        account_no: t.account_no,
        counterparty: cp,
        counterparty_is_person: U.num(t.counterparty_is_person) === 1,
        direction: t.direction,
        amount: amt,
        purpose: t.purpose || '',
        voucher_no: t.voucher_no || '',
        matched: U.num(t.matched, 1),
        statHit: statHit,
        statReasons: ev.reasons,
        statZ: U.round(ev.z, 2),
        statMadZ: U.round(ev.madZ, 2),
        devScore: U.round(ev.devScore, 2),
        rules: strongHits,
        weakRules: hits.filter(function (h) { return h.weak; }),
        ruleCodes: ruleKinds,
        fraudTypes: fraudTypes,
        primaryFraud: primary,
        riskLevel: level,
        riskLabel: RISK_LEVELS[level],
        _order: lvl * 1000 + Math.min(999, amt / 10000)
      });
    });

    /* 排序：风险等级 → 规则种类数 → 统计偏离度 → 金额 */
    signals.sort(function (a, b) {
      if (b._order !== a._order) return b._order - a._order;
      return b.devScore - a.devScore;
    });
    signals.forEach(function (s, i) { s.id = 'SIG-' + (i + 1).toString().padStart(4, '0'); });

    /* ---------- 2. 规则命中统计 ---------- */
    var ruleStats = Object.keys(RULES).map(function (code) {
      var list = signals.filter(function (s) { return s.ruleCodes.indexOf(code) >= 0; });
      return {
        code: code, name: RULES[code].name, desc: RULES[code].desc,
        count: list.length,
        amount: U.sum(list, function (s) { return s.amount; }),
        txnIds: list.map(function (s) { return s.txn_id; })
      };
    });

    /* ---------- 3. 舞弊类型分布 ---------- */
    var fraudDist = App.config.FRAUD_TYPES.map(function (ft) {
      var list = signals.filter(function (s) { return s.fraudTypes.indexOf(ft.code) >= 0; });
      return {
        code: ft.code, name: ft.name,
        count: list.length,
        amount: U.sum(list, function (s) { return s.amount; }),
        highCount: list.filter(function (s) { return s.riskLevel === 'high'; }).length
      };
    });

    /* ---------- 4. 时间分布（按月） ---------- */
    var monthDist = {};
    signals.forEach(function (s) {
      var m = s.txn_date.slice(0, 7);
      var g = monthDist[m] || (monthDist[m] = { month: m, count: 0, amount: 0, high: 0 });
      g.count++; g.amount += s.amount; if (s.riskLevel === 'high') g.high++;
    });
    var monthSeries = Object.keys(monthDist).sort().map(function (k) { return monthDist[k]; });

    /* ---------- 5. 数据质量校验提示 ---------- */
    if (baseline.n < 30) warnings.push('样本量偏小（' + baseline.n + ' 笔），统计离群结果参考价值有限，建议扩大统计期间。');
    if (!baseline.usable && baseline.reason) warnings.push('统计离群检测降级：' + baseline.reason + '，本次以规则异常为主。');
    var emptyAmt = txns.filter(function (t) { return !U.num(t.amount); }).length;
    if (emptyAmt) warnings.push('存在 ' + emptyAmt + ' 笔金额为空或为 0 的流水，已排除出统计基线。');
    var nullCp = txns.filter(function (t) { return !t.counterparty_name; }).length;
    if (nullCp) warnings.push('存在 ' + nullCp + ' 笔对手方为空的流水，相关规则（R03/R05/R06/R07）无法完整判定。');
    var months = U.uniq(txns.map(function (t) { return U.fmtMonth(t.txn_date); }));
    if (months.length > 1) warnings.push('数据跨 ' + months.length + ' 个会计期间（' + months[0] + ' ~ ' + months[months.length - 1] + '），期末指标已按月分别计算，未跨期混算。');
    var noTime = txns.filter(function (t) { return U.hourOf(t.txn_time) === null; }).length;
    if (noTime) warnings.push('存在 ' + noTime + ' 笔缺少记账时间的流水，R08 非工作时间规则对其不生效。');
    if (whitelistHit.length) warnings.push('白名单已过滤 ' + whitelistHit.length + ' 笔流水（对手方：' + U.uniq(whitelistHit).slice(0, 5).join('、') + '），如需全量筛查请在设置中调整白名单。');
    if (App.memory && App.memory.changedSinceLast({ thresholds: th, period: period, fraudTypes: focusTypes, whitelist: whitelist })) {
      warnings.push('口径已变更，与历史分析结果不可直接比较。');
    }

    var byLevel = {
      high: signals.filter(function (s) { return s.riskLevel === 'high'; }).length,
      mid: signals.filter(function (s) { return s.riskLevel === 'mid'; }).length,
      low: signals.filter(function (s) { return s.riskLevel === 'low'; }).length
    };

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      caliberEcho: (App.memory ? App.memory.describe({ thresholds: th, period: period, fraudTypes: focusTypes, whitelist: whitelist }) : ''),
      caliberNotes: caliberNotes,
      baseline: baseline,
      totals: {
        txnCount: txns.length,
        signalCount: signals.length,
        signalRatio: txns.length ? signals.length / txns.length : 0,
        signalAmount: U.sum(signals, function (s) { return s.amount; }),
        statHitCount: statHits,
        byLevel: byLevel
      },
      signals: signals,
      rules: RULES,
      ruleStats: ruleStats,
      fraudDist: fraudDist,
      monthSeries: monthSeries,
      splitGroups: splitGroups.map(function (g) {
        return { counterparty: g.counterparty, count: g.count, total: g.total, days: g.days, txnIds: g.txns.map(function (t) { return t.txn_id; }), dates: g.txns.map(function (t) { return U.fmtDate(t.txn_date); }) };
      }),
      warnings: warnings,
      thresholdsUsed: th,
      periodUsed: period
    };
  };

  /* 按规则检索的信号（供行内展开/导出用） */
  RISK.byRule = function (result, code) {
    if (!result || !result.ok) return [];
    return result.signals.filter(function (s) { return s.ruleCodes.indexOf(code) >= 0; });
  };

  App.riskAlert = RISK;
  App.rules = RULES;
  App.ruleToFraud = RULE_TO_FRAUD;
  App.isPersonName = isPersonName;
})(typeof window !== 'undefined' ? window : globalThis);
