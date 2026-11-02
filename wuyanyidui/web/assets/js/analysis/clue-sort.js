/* =============================================================
 * 财务舞弊111 · F2 可疑交易线索梳理（clue_sort）
 *  - 以「对手方 + 事项 + 时间窗口」聚合信号为线索
 *  - fund_chain_tracing：资金链路追踪（完整 / 断点 / 疑似回流）
 *  - fund_business_crosscheck：资金—业务交叉核对
 *  - four_flow_check：四流（合同流/发票流/资金流/货物流）合一检查
 *  - 参考优先级 = 金额 40% + 规则种类 30% + 关联方 20% + 链路完整性 10%
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var CLUE = {};

  /* 事项关键词归一（把用途聚成"事项"） */
  var MATTER_MAP = [
    { kw: ['咨询', '服务费', '顾问'], matter: '咨询服务费' },
    { kw: ['广告', '宣传', '推广'], matter: '广告宣传费' },
    { kw: ['担保', '保证金', '代偿'], matter: '担保及保证金' },
    { kw: ['往来', '暂借', '备用金', '借款'], matter: '往来款' },
    { kw: ['投资', '理财', '资管', '申赎'], matter: '投资理财' },
    { kw: ['处置', '报废', '清理'], matter: '资产处置' },
    { kw: ['运费', '物流', '运输'], matter: '物流运费' },
    { kw: ['货款', '采购', '销货'], matter: '购销货款' },
    { kw: ['招待', '差旅', '报销', '办公'], matter: '费用报销' },
    { kw: ['薪', '工资', '社保'], matter: '职工薪酬' }
  ];
  function toMatter(purpose) {
    var p = String(purpose || '');
    for (var i = 0; i < MATTER_MAP.length; i++) {
      if (MATTER_MAP[i].kw.some(function (k) { return p.indexOf(k) >= 0; })) return MATTER_MAP[i].matter;
    }
    return p || '未注明事项';
  }

  /**
   * @param {object} riskResult F1 结果
   * @param {object} ds {data, meta}
   * @param {object} opt { thresholds, linkage(可选 F3 结果) }
   */
  CLUE.run = function (riskResult, ds, opt) {
    opt = opt || {};
    if (!riskResult || !riskResult.ok) {
      return { ok: false, error: '请先完成「风险信号识别」，再生成线索台账。' };
    }
    var th = opt.thresholds || riskResult.thresholdsUsed || App.config.DEFAULT_THRESHOLDS;
    var tiebreak = opt.tiebreak || 'weight'; // weight=分值优先（辅助参考）| amount=金额优先
    var data = (ds && ds.data) || ds || {};
    var entries = data.gl_voucher_entries || [];
    var vouchers = data.gl_vouchers || [];
    var employees = data.employees || [];
    var txnsById = {};
    (data.bank_transactions || []).forEach(function (t) { txnsById[t.txn_id] = t; });
    var empByName = {};
    employees.forEach(function (e) { empByName[e.employee_name] = e; });

    /* 关联方命中集合（来自 F3，可用于线索的"关联方命中标志"） */
    var relatedSet = {};
    if (opt.linkage && opt.linkage.ok) {
      (opt.linkage.suspects || []).forEach(function (s) { relatedSet[s.subject] = s; });
    }

    /* 凭证 → 分录 索引 */
    var entriesByVoucher = U.groupBy(entries, function (e) { return e.voucher_no || e.voucher_id; });
    var entriesByCounterparty = U.groupBy(entries, function (e) { return String(e.counterparty || '').trim(); });
    var voucherByNo = {};
    vouchers.forEach(function (v) { voucherByNo[v.voucher_no] = v; });

    /* ---------- 1. 聚合为线索 ---------- */
    var groups = {};
    riskResult.signals.forEach(function (s) {
      var matter = toMatter(s.purpose);
      var key = s.counterparty + '|' + matter;
      var g = groups[key];
      if (!g) {
        g = groups[key] = {
          key: key, counterparty: s.counterparty, matter: matter,
          signals: [], txns: [], ruleCodes: {}, fraudTypes: {}
        };
      }
      g.signals.push(s);
      g.txns.push(txnsById[s.txn_id] || { txn_id: s.txn_id, txn_date: s.txn_date, amount: s.amount, direction: s.direction, purpose: s.purpose, voucher_no: s.voucher_no, matched: s.matched });
      s.ruleCodes.forEach(function (c) { g.ruleCodes[c] = (g.ruleCodes[c] || 0) + 1; });
      s.fraudTypes.forEach(function (f) { g.fraudTypes[f] = (g.fraudTypes[f] || 0) + 1; });
    });

    /* 分值归一化所需的极值 */
    var rawGroups = Object.keys(groups).map(function (k) { return groups[k]; });
    var amounts = rawGroups.map(function (g) { return U.sum(g.signals, function (s) { return s.amount; }); });
    var maxAmount = Math.max.apply(null, amounts.concat([1]));

    var clues = rawGroups.map(function (g, idx) {
      var sigs = g.signals;
      var amount = U.sum(sigs, function (s) { return s.amount; });
      var dates = sigs.map(function (s) { return s.txn_date; }).filter(Boolean).sort();
      var ruleKinds = Object.keys(g.ruleCodes);
      var fraudTypes = Object.keys(g.fraudTypes).sort(function (a, b) { return g.fraudTypes[b] - g.fraudTypes[a]; });
      var subjects = U.uniq(sigs.map(function (s) { return s.counterparty; }));
      var related = relatedSet[g.counterparty];
      var isPerson = sigs.some(function (s) { return s.counterparty_is_person; });

      /* ---- 资金链路追踪 fund_chain_tracing ---- */
      var chain = traceChain(g, txnsById, entriesByCounterparty, voucherByNo, entriesByVoucher, employees);
      /* ---- 资金—业务交叉核对 fund_business_crosscheck ---- */
      var cross = crossCheck(g, txnsById, voucherByNo, entriesByVoucher, entriesByCounterparty);
      /* ---- 四流合一检查 four_flow_check ---- */
      var fourFlow = fourFlowCheck(g, txnsById, voucherByNo, entriesByVoucher, entriesByCounterparty);

      /* ---- 参考优先级（可解释） ---- */
      var wAmt = U.num(th.clueWeight_amount, 40), wRule = U.num(th.clueWeight_rules, 30),
        wRel = U.num(th.clueWeight_related, 20), wChain = U.num(th.clueWeight_chain, 10);
      var wSum = wAmt + wRule + wRel + wChain || 100;
      var amtScore = Math.min(1, amount / maxAmount);
      var ruleScore = Math.min(1, ruleKinds.length / 5);
      var relScore = related ? Math.min(1, 0.5 + (related.hitCount || 1) * 0.15) : 0;
      var chainScore = chain.status === '疑似回流' ? 1 : chain.status === '断点' ? 0.6 : 0.25;
      var priority = Math.round(100 * (amtScore * wAmt + ruleScore * wRule + relScore * wRel + chainScore * wChain) / wSum);

      var reasons = [];
      reasons.push('累计金额 ' + U.money(amount) + '（占本次最高金额线索 ' + (amtScore * 100).toFixed(0) + '%，权重 ' + wAmt + '%）');
      reasons.push('命中 ' + ruleKinds.length + ' 类规则（' + ruleKinds.join('/') + '，权重 ' + wRule + '%）');
      reasons.push(related ? '关联方核查命中：' + related.type + '（权重 ' + wRel + '%）' : '未命中关联方核查（权重 ' + wRel + '%）');
      reasons.push('资金链路状态：' + chain.status + '（权重 ' + wChain + '%）');
      if (cross.gaps.length) reasons.push('业务支撑缺口：' + cross.gaps.length + ' 项（' + cross.gaps.slice(0, 3).join('、') + '）');

      /* 建议核查方向（调查方向建议，非处置建议） */
      var directions = suggestDirections(g, chain, cross, fourFlow, related, isPerson);

      return {
        id: '',
        counterparty: g.counterparty,
        matter: g.matter,
        isPerson: isPerson,
        relatedHit: !!related,
        relatedType: related ? related.type : '',
        subjects: subjects,
        txnCount: sigs.length,
        amount: amount,
        dateStart: dates[0] || '',
        dateEnd: dates[dates.length - 1] || '',
        spanDays: dates.length > 1 ? U.daysBetween(dates[0], dates[dates.length - 1]) : 0,
        ruleCodes: ruleKinds,
        ruleDetail: g.ruleCodes,
        fraudTypes: fraudTypes.slice(0, 3),
        primaryFraud: fraudTypes[0] || 'fake_transaction',
        chain: chain,
        cross: cross,
        fourFlow: fourFlow,
        priority: priority,
        priorityLevel: priority >= 70 ? 'high' : priority >= 40 ? 'mid' : 'low',
        reasons: reasons,
        directions: directions,
        txnIds: sigs.map(function (s) { return s.txn_id; }),
        vouchers: U.uniq(sigs.map(function (s) { return s.voucher_no; }).filter(Boolean)),
        maxRiskLevel: sigs.some(function (s) { return s.riskLevel === 'high'; }) ? 'high' : sigs.some(function (s) { return s.riskLevel === 'mid'; }) ? 'mid' : 'low',
        highSignalCount: sigs.filter(function (s) { return s.riskLevel === 'high'; }).length
      };
    });

    /* ---------- 2. 去重与合并（同一对手方跨事项合并提示） ---------- */
    clues.sort(function (a, b) {
      if (tiebreak === 'amount') return b.amount - a.amount;
      return b.priority - a.priority;
    });
    clues.forEach(function (c, i) { c.id = 'CL-' + String(i + 1).padStart(3, '0'); });

    /* 同对手方多线索 → 合并提示 */
    var byCp = U.groupBy(clues, function (c) { return c.counterparty; });
    var mergeNotes = [];
    Object.keys(byCp).forEach(function (cp) {
      if (byCp[cp].length > 1) {
        mergeNotes.push({
          counterparty: cp,
          clueIds: byCp[cp].map(function (c) { return c.id; }),
          matters: byCp[cp].map(function (c) { return c.matter; }),
          totalAmount: U.sum(byCp[cp], function (c) { return c.amount; }),
          note: '同一对手方涉及 ' + byCp[cp].length + ' 个事项，建议合并核查该对手方整体交易背景'
        });
      }
    });

    /* ---------- 3. 台账统计 ---------- */
    var chainStats = { '完整': 0, '断点': 0, '疑似回流': 0 };
    var crossStats = { has_biz_no_fund: 0, has_fund_no_biz: 0, amount_mismatch: 0, ok: 0 };
    clues.forEach(function (c) {
      chainStats[c.chain.status] = (chainStats[c.chain.status] || 0) + 1;
      if (c.cross.status === '有业务无资金') crossStats.has_biz_no_fund++;
      else if (c.cross.status === '有资金无业务') crossStats.has_fund_no_biz++;
      else if (c.cross.status === '金额不匹配') crossStats.amount_mismatch++;
      else crossStats.ok++;
    });

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      clues: clues,
      mergeNotes: mergeNotes,
      totals: {
        clueCount: clues.length,
        totalAmount: U.sum(clues, function (c) { return c.amount; }),
        highPriority: clues.filter(function (c) { return c.priorityLevel === 'high'; }).length,
        midPriority: clues.filter(function (c) { return c.priorityLevel === 'mid'; }).length,
        lowPriority: clues.filter(function (c) { return c.priorityLevel === 'low'; }).length,
        relatedHit: clues.filter(function (c) { return c.relatedHit; }).length
      },
      chainStats: chainStats,
      crossStats: crossStats,
      weights: { amount: th.clueWeight_amount, rules: th.clueWeight_rules, related: th.clueWeight_related, chain: th.clueWeight_chain },
      tiebreak: tiebreak
    };
  };

  /* ---------- 资金链路追踪 ---------- */
  function traceChain(g, txnsById, entriesByCp, voucherByNo, entriesByVoucher, employees) {
    var nodes = [], edges = [], status = '完整', notes = [];
    var cp = g.counterparty;
    var accs = {};
    g.txns.forEach(function (t) {
      var acc = t.account_id || '未知账户';
      accs[acc] = accs[acc] || { in: 0, out: 0, count: 0 };
      if (t.direction === '收') accs[acc].in += U.num(t.amount); else accs[acc].out += U.num(t.amount);
      accs[acc].count++;
    });
    nodes.push({ id: cp, label: cp, kind: /^\d{12,}$/.test(cp) ? '对手方' : '对手方', main: true });
    Object.keys(accs).forEach(function (a) {
      nodes.push({ id: a, label: a === 'A001' ? '基本户' : a === 'A002' ? '一般户' : a === 'A003' ? '专项户' : a, kind: '本方账户' });
      edges.push({ from: accs[a].out > accs[a].in ? a : cp, to: accs[a].out > accs[a].in ? cp : a, label: '资金流', weight: U.round(accs[a].in + accs[a].out, 2), direction: accs[a].out > accs[a].in ? '付' : '收', count: accs[a].count });
    });

    /* 凭证链：是否有对应分录，分录是否进入成本/费用/往来 */
    var vouchers = U.uniq(g.txns.map(function (t) { return t.voucher_no; }).filter(Boolean));
    var linkedEntries = [];
    vouchers.forEach(function (vn) {
      (entriesByVoucher[vn] || []).forEach(function (e) { linkedEntries.push(e); });
    });
    var noVoucher = g.txns.filter(function (t) { return !t.voucher_no || !voucherByNo[t.voucher_no]; });
    if (noVoucher.length) {
      nodes.push({ id: '断点-' + cp, label: '凭证断点', kind: '断点' });
      edges.push({ from: cp, to: '断点-' + cp, label: noVoucher.length + ' 笔无凭证', weight: U.sum(noVoucher, function (t) { return U.num(t.amount); }), dashed: true });
      status = '断点';
      notes.push(noVoucher.length + ' 笔资金流转无对应记账凭证，链路在此中断');
    }

    /* 回流识别：同一对手方收付双向且金额接近（对冲/退回） */
    var recv = U.sum(g.txns.filter(function (t) { return t.direction === '收'; }), function (t) { return U.num(t.amount); });
    var pay = U.sum(g.txns.filter(function (t) { return t.direction === '付'; }), function (t) { return U.num(t.amount); });
    if (recv > 0 && pay > 0) {
      var ratio = Math.min(recv, pay) / Math.max(recv, pay);
      if (ratio >= 0.7) {
        status = '疑似回流';
        nodes.push({ id: '回流-' + cp, label: '疑似资金回流', kind: '回流' });
        edges.push({ from: cp, to: '回流-' + cp, label: '回流', weight: U.round(Math.min(recv, pay), 2), dashed: true });
        notes.push('该对手方收付双向金额接近（收 ' + U.money(recv) + ' / 付 ' + U.money(pay) + '，匹配度 ' + (ratio * 100).toFixed(0) + '%），存在资金回流特征');
      } else {
        notes.push('该对手方存在双向资金往来（收 ' + U.money(recv) + ' / 付 ' + U.money(pay) + '），匹配度 ' + (ratio * 100).toFixed(0) + '%');
      }
    }

    /* 是否为店内员工（个人卡路径） */
    if (employees.some(function (e) { return e.employee_name === cp; })) {
      notes.push('对手方为本单位员工，资金链路指向个人账户，需核实款项性质（是否为工资/报销）');
      nodes.push({ id: '个人-' + cp, label: '员工个人账户', kind: '个人账户' });
      edges.push({ from: cp, to: '个人-' + cp, label: '个人卡', weight: U.round(recv + pay, 2) });
      if (status === '完整') status = '断点';
    }

    if (!notes.length) notes.push('资金链路与本方账户、凭证分录可对应，未发现明显断点（仍需人工核对原始回单）');

    return {
      status: status,
      completeness: status === '完整' ? 100 : status === '断点' ? 45 : 30,
      nodes: nodes,
      edges: edges,
      notes: notes,
      inflow: recv, outflow: pay,
      voucherCount: vouchers.length,
      noVoucherCount: noVoucher.length,
      linkedEntryCount: linkedEntries.length
    };
  }

  /* ---------- 资金—业务交叉核对 ---------- */
  function crossCheck(g, txnsById, voucherByNo, entriesByVoucher, entriesByCp) {
    var gaps = [], notes = [];
    var cpEntries = entriesByCp[g.counterparty] || [];
    var fundTxns = g.txns;
    var fundAmount = U.sum(fundTxns, function (t) { return U.num(t.amount); });
    /* 业务金额 = 线索内流水所对应的凭证分录金额（而非该对手方全部分录，避免与本线索无关的交易被混入） */
    var linkedEntries = [];
    U.uniq(fundTxns.map(function (t) { return t.voucher_no; }).filter(Boolean)).forEach(function (vn) {
      (entriesByVoucher[vn] || []).forEach(function (e) { linkedEntries.push(e); });
    });
    var bizAmount = U.sum(linkedEntries, function (e) { return U.num(e.debit) || U.num(e.credit); });
    var withVoucher = fundTxns.filter(function (t) { return t.voucher_no && voucherByNo[t.voucher_no]; });
    var without = fundTxns.filter(function (t) { return !t.voucher_no || !voucherByNo[t.voucher_no]; });

    var status = '基本匹配';
    if (fundTxns.length && bizAmount === 0) {
      status = '有资金无业务';
      gaps.push('该对手方存在资金收付 ' + U.money(fundAmount) + '，但凭证分录中无可对应的业务记录');
      notes.push('资金流有、业务流缺，属四流不合一的典型缺口，需核实合同与业务实质');
    } else if (bizAmount > 0 && fundTxns.length === 0) {
      status = '有业务无资金';
      gaps.push('该对手方存在业务记录 ' + U.money(bizAmount) + '，但银行流水中无对应资金收付');
    } else if (without.length) {
      status = '金额不匹配';
      gaps.push(without.length + ' 笔资金收付无对应记账凭证（' + U.money(U.sum(without, function (t) { return U.num(t.amount); })) + '）');
    }
    if (fundTxns.length && bizAmount > 0) {
      var diff = Math.abs(fundAmount - bizAmount) / Math.max(fundAmount, bizAmount);
      /* 含税差异（≤14%）视为合理结算波动，不计为缺口 */
      if (diff > 0.2) {
        if (status === '基本匹配') status = '金额不匹配';
        gaps.push('资金金额 ' + U.money(fundAmount) + ' 与凭证金额 ' + U.money(bizAmount) + ' 差异 ' + (diff * 100).toFixed(0) + '%，需核对是否为部分结算或含税额差异');
      } else {
        notes.push('资金金额与凭证金额差异 ' + (diff * 100).toFixed(0) + '%，在含税结算波动范围内（仍需人工确认）');
      }
    }

    return {
      status: status,
      fundAmount: fundAmount,
      bizAmount: bizAmount,
      fundCount: fundTxns.length,
      bizCount: linkedEntries.length,
      counterpartyEntryCount: cpEntries.length,
      withVoucherCount: withVoucher.length,
      withoutVoucherCount: without.length,
      gaps: gaps,
      notes: notes
    };
  }

  /* ---------- 四流合一 ---------- */
  function fourFlowCheck(g, txnsById, voucherByNo, entriesByVoucher, entriesByCp) {
    var flows = [
      { key: 'contract', name: '合同流', ok: 0, miss: 0, note: '' },
      { key: 'invoice', name: '发票流', ok: 0, miss: 0, note: '' },
      { key: 'fund', name: '资金流', ok: 0, miss: 0, note: '' },
      { key: 'goods', name: '货物流', ok: 0, miss: 0, note: '' }
    ];
    var fo = flows[0], fi = flows[1], ff = flows[2], fg = flows[3];
    g.txns.forEach(function (t) {
      if (t.contract_no) fo.ok++; else fo.miss++;
      if (t.invoice_no) fi.ok++; else fi.miss++;
      ff.ok++; // 有流水即视为资金流存在
    });
    /* 货物流：以凭证分录是否进入库存商品/成本且带业务摘要近似判定 */
    var cpEntries = entriesByCp[g.counterparty] || [];
    var goodsEntries = cpEntries.filter(function (e) {
      return /^1405|^6401|^1123/.test(String(e.subject_code)) || /货|采购|入库|出库|验收/.test(String(e.summary || ''));
    });
    fg.ok = goodsEntries.length; fg.miss = cpEntries.length ? Math.max(0, g.txns.length - goodsEntries.length) : g.txns.length;

    var missing = [];
    if (fo.miss) missing.push('合同流（' + fo.miss + '/' + g.txns.length + ' 笔无合同号）');
    if (fi.miss) missing.push('发票流（' + fi.miss + '/' + g.txns.length + ' 笔无发票号）');
    if (fg.miss) missing.push('货物流（无入库/验收/成本结转等业务记录支撑）');
    var score = Math.round(100 * (fo.ok + fi.ok + ff.ok + fg.ok) / Math.max(1, (fo.ok + fo.miss) + (fi.ok + fi.miss) + ff.ok + (fg.ok + fg.miss)));
    return {
      flows: flows,
      score: U.clamp(score, 0, 100),
      missing: missing,
      conclusion: missing.length ? '存在 ' + missing.length + ' 类流向缺口（证据缺口清单，不代表证据链已闭合）' : '四流要素基本齐全（仍需人工核验原始单据真实性）'
    };
  }

  /* ---------- 建议核查方向 ---------- */
  function suggestDirections(g, chain, cross, fourFlow, related, isPerson) {
    var d = [];
    var codes = Object.keys(g.ruleCodes);
    if (codes.indexOf('R09') >= 0 || cross.status === '有资金无业务') d.push('调取该笔资金对应的合同、发票、验收单等原始单据，核实业务真实性');
    if (codes.indexOf('R03') >= 0) d.push('核查是否存在人为拆分以规避审批额度，比对审批记录与实际付款笔数');
    if (codes.indexOf('R07') >= 0 || chain.status === '疑似回流') d.push('追踪对手方收款后的资金去向，核实是否存在资金回流至本方关联方');
    if (codes.indexOf('R05') >= 0 || isPerson) d.push('核实个人账户收款的性质与审批依据，比对工资/报销发放清单');
    if (codes.indexOf('R04') >= 0) d.push('关注期末集中确认的交易，核对收入/成本的截止性（cut-off）');
    if (codes.indexOf('R08') >= 0) d.push('核查非工作时间操作的审批留痕与操作人权限');
    if (codes.indexOf('R02') >= 0) d.push('关注整数金额定价依据，比对同类交易价格是否偏离');
    if (related) d.push('核实与该关联方的关系认定（工商信息、股权结构、人员任职），确认交易是否履行关联交易审批程序');
    if (fourFlow.missing.length) d.push('就' + fourFlow.missing.join('、') + '做补充取证，形成完整证据缺口清单');
    if (!d.length) d.push('按常规程序核对该对手方交易背景与业务单据');
    return U.uniq(d).slice(0, 6);
  }

  App.clueSort = CLUE;
  App.matterOf = toMatter;
})(typeof window !== 'undefined' ? window : globalThis);
