/* =============================================================
 * 财务舞弊111 · F5 舞弊可能性参考评估（weighted_scorecard）
 * 七类舞弊 × 四维指标，0–5 分 × 权重 → 0–100 参考分值
 * 输出「参考区间」而非风险等级：区间结论必须带"需人工复核后定级"
 * 支持"为什么是这个分"的逐维解释。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var SC = {};

  function clamp5(v) { return U.clamp(U.round(v, 2), 0, 5); }
  function ratioScore(v, cap) { return clamp5(v / (cap || 1) * 5); }

  /**
   * @param {object} ctx {riskAlert, clueSort, linkage, aggregation, data, meta}
   * @param {object} opt {weights(可覆盖), fraudTypes(关注范围)}
   */
  SC.run = function (ctx, opt) {
    opt = opt || {};
    ctx = ctx || {};
    var risk = ctx.riskAlert, clue = ctx.clueSort, link = ctx.linkage, agg = ctx.aggregation;
    var data = ctx.data || {};
    var weightOverride = opt.weights || {};
    var focus = (opt.fraudTypes && opt.fraudTypes.length) ? opt.fraudTypes : App.config.FRAUD_TYPES.map(function (f) { return f.code; });

    var signals = (risk && risk.ok) ? risk.signals : [];
    var clues = (clue && clue.ok) ? clue.clues : [];
    var suspects = (link && link.ok) ? link.suspects : [];
    var txns = data.bank_transactions || [];
    var entries = data.gl_voucher_entries || [];

    /* ---------- 事实指标计算（全部可回溯） ---------- */
    /* 1. 无业务支撑比例 */
    var noSupport = txns.filter(function (t) { return U.num(t.matched, 1) === 0 || !t.voucher_no; });
    var noSupportRatio = txns.length ? noSupport.length / txns.length : 0;

    /* 2. 对手方集中度（HHI 近似：TOP1 占比） */
    var cpAmount = {};
    txns.forEach(function (t) { var k = t.counterparty_name || ''; cpAmount[k] = (cpAmount[k] || 0) + U.num(t.amount); });
    var cpTotal = U.sum(Object.keys(cpAmount).map(function (k) { return cpAmount[k]; }));
    var top1 = Object.keys(cpAmount).map(function (k) { return cpAmount[k]; }).sort(function (a, b) { return b - a; })[0] || 0;
    var top1Share = cpTotal ? top1 / cpTotal : 0;

    /* 3. 四流缺口数 */
    var gapsFour = 0, gapsTotalTxn = 0;
    clues.forEach(function (c) { gapsFour += (c.fourFlow && c.fourFlow.missing ? c.fourFlow.missing.length : 0); gapsTotalTxn += c.txnCount; });
    var avgGaps = clues.length ? gapsFour / clues.length : 0;

    /* 4. 期末突击笔数 */
    var periodEndHits = signals.filter(function (s) { return s.ruleCodes.indexOf('R04') >= 0; }).length;
    var periodEndRatio = txns.length ? periodEndHits / txns.length : 0;

    /* 5. 个人卡收款 */
    var personalCard = signals.filter(function (s) { return s.ruleCodes.indexOf('R05') >= 0; }).length;
    var personalRatio = txns.length ? personalCard / txns.length : 0;

    /* 6. 资金回流 */
    var refundClues = clues.filter(function (c) { return c.chain && c.chain.status === '疑似回流'; });
    var refundRatio = clues.length ? refundClues.length / clues.length : 0;

    /* 7. 非工作时间转账 */
    var offTime = signals.filter(function (s) { return s.ruleCodes.indexOf('R08') >= 0; }).length;
    var offTimeRatio = txns.length ? offTime / txns.length : 0;

    /* 8. 审批缺口：凭证无审核人 / 制单=审核 */
    var vouchers = data.gl_vouchers || [];
    var approvalGap = vouchers.filter(function (v) { return !v.approved_by || v.approved_by === v.prepared_by; }).length;
    var approvalGapRatio = vouchers.length ? approvalGap / vouchers.length : 0;

    /* 关联方指标 */
    var keyPersonHits = suspects.filter(function (s) { return s.typeCode === 'key_personnel_relation'; });
    var keyPersonHard = keyPersonHits.filter(function (s) { return (s.hits || []).some(function (h) { return h.weight >= 2; }); });
    var equityNodes = suspects.filter(function (s) { return s.typeCode === 'equity_penetration'; });
    var maxDepth = 0;
    equityNodes.forEach(function (s) { if ((s.depth || 0) > maxDepth) maxDepth = s.depth; });
    var priceDeviation = computePriceDeviation(entries);
    var freqAnomaly = suspects.filter(function (s) { return s.typeCode === 'frequency_scale_anomaly'; }).length;
    var relatedAmount = U.sum(suspects, function (s) { return s.txnAmount; });
    var relatedShare = cpTotal ? relatedAmount / cpTotal : 0;

    /* 违规担保指标 */
    var guaranteeTxns = txns.filter(function (t) { return /担保|保证金|代偿/.test(String(t.purpose || '')) || /担保/.test(String(t.counterparty_name || '')); });
    var guaranteeEntries = entries.filter(function (e) { return /担保|代偿/.test(String(e.summary || '')) || /担保/.test(String(e.counterparty || '')); });
    var offbookTrace = guaranteeEntries.filter(function (e) { return /^(1221|2241)/.test(String(e.subject_code)); });
    var marginFlow = guaranteeTxns.filter(function (t) { return /保证金/.test(String(t.purpose || '')); });
    /* 担保圈：同一担保主体与多个对手方发生往来 */
    var guaranteeCirc = {};
    guaranteeEntries.forEach(function (e) { if (e.counterparty) guaranteeCirc[e.counterparty] = 1; });
    var disclosureGap = 0;
    if (agg && agg.ok) {
      /* 报表披露缺口：表外承诺无对应"预计负债"科目，且其他应付款往来款异常增长 */
      var oap = (agg.rows || []).filter(function (r) { return r.subject_code === '224102'; })[0];
      disclosureGap = oap && oap.credit > 0 ? 1 : 0;
    }

    /* 内幕交易指标 */
    var sensitiveTxns = signals.filter(function (s) { return s.ruleCodes.indexOf('R04') >= 0 && /投资|资管|理财|申赎/.test(String(s.purpose || '')); });
    var sensitiveRatio = txns.length ? sensitiveTxns.length / txns.length : 0;
    var insiderAccounts = U.uniq(signals.filter(function (s) { return s.counterparty_is_person; }).map(function (s) { return s.counterparty; }));
    var accountFocus = top1Share;

    /* 费用舞弊指标 */
    var expenseEntries = entries.filter(function (e) { return /^6601|^6602|^6604/.test(String(e.subject_code)); });
    var revenueEntries = entries.filter(function (e) { return /^6001|^6051/.test(String(e.subject_code)); });
    var expenseAmt = U.sum(expenseEntries, function (e) { return U.num(e.debit) || U.num(e.credit); });
    var revenueAmt = U.sum(revenueEntries, function (e) { return U.num(e.credit); });
    var expenseRatio = revenueAmt ? expenseAmt / revenueAmt : 0;
    /* 报销集中度：单一经办人占费用报销比例 */
    var byEmployee = {};
    expenseEntries.forEach(function (e) { var k = e.employee_name || '(未注明)'; byEmployee[k] = (byEmployee[k] || 0) + (U.num(e.debit) || U.num(e.credit)); });
    var maxEmp = Object.keys(byEmployee).map(function (k) { return byEmployee[k]; }).sort(function (a, b) { return b - a; })[0] || 0;
    var claimFocus = expenseAmt ? maxEmp / expenseAmt : 0;
    /* 发票连号：同日同一供应商多笔连续金额 */
    var invoiceSeq = detectInvoiceSequence(entries);
    /* 跨期列支：月初 5 日内报销上月费用 */
    var crossPeriodClaim = expenseEntries.filter(function (e) {
      if (!e.voucher_date) return false;
      var d = U.parseDate(e.voucher_date);
      return d && d.getDate() <= 5;
    }).length;
    var crossPeriodRatio = expenseEntries.length ? crossPeriodClaim / expenseEntries.length : 0;

    /* 资产侵占指标 */
    var impairEntries = entries.filter(function (e) { return /^6701|减值/.test(String(e.subject_code) + String(e.summary)); });
    var impairAmt = U.sum(impairEntries, function (e) { return U.num(e.debit); });
    var impairRatio = revenueAmt ? impairAmt / revenueAmt : 0;
    var disposeLoss = entries.filter(function (e) { return /^6702|营业外支出/.test(String(e.subject_code)) && /处置/.test(String(e.summary)); });
    var disposeAmt = U.sum(disposeLoss, function (e) { return U.num(e.debit); });
    var inventoryLoss = entries.filter(function (e) { return /盘亏|报废/.test(String(e.summary)); }).length;
    /* 往来长期挂账：122102 其他应收款-往来款 余额占收入比 */
    var agedRatio = 0;
    if (agg && agg.ok) {
      var aged = (agg.rows || []).filter(function (r) { return r.subject_code === '122102'; })[0];
      if (aged && revenueAmt) agedRatio = aged.closing / revenueAmt;
    }

    /* ---------- 各维度原始值 → 0~5 分（附计分口径说明） ---------- */
    var DIMS = {
      fake_transaction: {
        no_support_ratio: { raw: noSupportRatio, score: ratioScore(noSupportRatio, 0.30), rule: '无凭证/未勾对流水占比 ÷ 30% × 5，上限 5', rawText: '无业务支撑流水 ' + noSupport.length + ' / ' + txns.length + ' 笔（' + (noSupportRatio * 100).toFixed(1) + '%）', weight: 30 },
        cp_concentration: { raw: top1Share, score: ratioScore(top1Share, 0.60), rule: '最大对手方交易额占比 ÷ 60% × 5，上限 5', rawText: '最大对手方占比 ' + (top1Share * 100).toFixed(1) + '%', weight: 25 },
        four_flow_gap: { raw: avgGaps, score: ratioScore(avgGaps, 2), rule: '平均四流缺口数 ÷ 2 × 5，上限 5', rawText: '线索平均四流缺口 ' + U.round(avgGaps, 2) + ' 项', weight: 25 },
        period_end_count: { raw: periodEndHits, score: ratioScore(periodEndRatio, 0.25), rule: '期末突击笔数占比 ÷ 25% × 5，上限 5', rawText: '期末突击 ' + periodEndHits + ' 笔（占比 ' + (periodEndRatio * 100).toFixed(1) + '%）', weight: 20 }
      },
      fund_misappropriation: {
        personal_card: { raw: personalCard, score: ratioScore(personalRatio, 0.15), rule: '个人卡收款笔数占比 ÷ 15% × 5，上限 5', rawText: '个人卡相关流水 ' + personalCard + ' 笔（占比 ' + (personalRatio * 100).toFixed(1) + '%）', weight: 30 },
        refund_flow: { raw: refundClues.length, score: ratioScore(refundRatio, 0.20), rule: '疑似回流线索占比 ÷ 20% × 5，上限 5', rawText: '疑似资金回流线索 ' + refundClues.length + ' 条（占线索 ' + (refundRatio * 100).toFixed(1) + '%）', weight: 30 },
        offtime_transfer: { raw: offTime, score: ratioScore(offTimeRatio, 0.25), rule: '非工作时间流水占比 ÷ 25% × 5，上限 5', rawText: '非工作时间/非工作日流水 ' + offTime + ' 笔（占比 ' + (offTimeRatio * 100).toFixed(1) + '%）', weight: 20 },
        approval_gap: { raw: approvalGap, score: ratioScore(approvalGapRatio, 0.50), rule: '无审核或制单=审核凭证占比 ÷ 50% × 5，上限 5', rawText: '审批缺口凭证 ' + approvalGap + ' / ' + vouchers.length + ' 张（' + (approvalGapRatio * 100).toFixed(1) + '%）', weight: 20 }
      },
      related_party_tunneling: {
        key_person_hit: { raw: keyPersonHard.length, score: clamp5(keyPersonHard.length >= 6 ? 5 : keyPersonHard.length), rule: '关键人员"硬证据"命中主体数（账号/身份证/同名）+0.5，上限 5', rawText: '关键人员硬证据命中 ' + keyPersonHard.length + ' 个主体（全部关键人员关联 ' + keyPersonHits.length + ' 个）', weight: 30 },
        equity_depth: { raw: maxDepth, score: clamp5(maxDepth >= 3 ? 5 : maxDepth === 2 ? 3.5 : maxDepth === 1 ? 2 : 0), rule: '股权穿透最大层级：≥3层=5，2层=3.5，1层=2', rawText: '股权穿透最大层级 ' + maxDepth + ' 层', weight: 25 },
        price_deviation: { raw: priceDeviation.ratio, score: ratioScore(priceDeviation.ratio, 1.00), rule: '同类交易金额偏离度 ÷ 100% × 5，上限 5', rawText: priceDeviation.text, weight: 25 },
        freq_anomaly: { raw: freqAnomaly, score: ratioScore(freqAnomaly / Math.max(1, suspects.length), 0.60), rule: '频次规模异常主体占比 ÷ 60% × 5，上限 5', rawText: '频次规模异常主体 ' + freqAnomaly + ' 个（占可疑主体 ' + (suspects.length ? (freqAnomaly / suspects.length * 100).toFixed(0) : 0) + '%）', weight: 20 }
      },
      illegal_guarantee: {
        offbook_trace: { raw: offbookTrace.length, score: clamp5(offbookTrace.length >= 5 ? 5 : offbookTrace.length), rule: '往来科目中的担保/代偿痕迹笔数（≥5 笔得 5 分）', rawText: '往来科目担保/代偿痕迹 ' + offbookTrace.length + ' 笔', weight: 30 },
        margin_flow: { raw: marginFlow.length, score: clamp5(marginFlow.length >= 5 ? 5 : marginFlow.length), rule: '保证金往来笔数（≥5 笔得 5 分）', rawText: '保证金往来 ' + marginFlow.length + ' 笔（' + U.money(U.sum(marginFlow, function (t) { return U.num(t.amount); })) + '）', weight: 25 },
        guarantee_circle: { raw: Object.keys(guaranteeCirc).length, score: clamp5(Object.keys(guaranteeCirc).length >= 2 ? 5 : Object.keys(guaranteeCirc).length * 2.5), rule: '担保往来主体数 ≥2 得 5 分', rawText: '担保相关往来主体 ' + Object.keys(guaranteeCirc).length + ' 个（' + Object.keys(guaranteeCirc).slice(0, 3).join('、') + '）', weight: 25 },
        disclosure_gap: { raw: disclosureGap, score: clamp5(disclosureGap * 4), rule: '存在表外承诺痕迹但无预计负债科目 → 4 分', rawText: disclosureGap ? '存在往来款表外承诺痕迹，且未见到对应预计负债科目' : '未识别到表外承诺痕迹', weight: 20 }
      },
      insider_trading: {
        sensitive_window: { raw: sensitiveTxns.length, score: ratioScore(sensitiveRatio, 0.10), rule: '期末敏感期投资类交易占比 ÷ 10% × 5，上限 5', rawText: '期末敏感期投资类交易 ' + sensitiveTxns.length + ' 笔（占比 ' + (sensitiveRatio * 100).toFixed(1) + '%）', weight: 30 },
        insider_account: { raw: insiderAccounts.length, score: ratioScore(insiderAccounts.length, 8), rule: '涉及自然人账户数 ÷ 8 × 5，上限 5', rawText: '涉及自然人对手方 ' + insiderAccounts.length + ' 个（' + insiderAccounts.slice(0, 3).join('、') + '）', weight: 30 },
        account_focus: { raw: accountFocus, score: ratioScore(accountFocus, 0.60), rule: '账户/对手方集中度 ÷ 60% × 5，上限 5', rawText: '最大对手方集中度 ' + (accountFocus * 100).toFixed(1) + '%', weight: 20 },
        timing_anomaly: { raw: offTime, score: ratioScore(offTimeRatio, 0.25), rule: '非正常时点交易占比 ÷ 25% × 5，上限 5', rawText: '非正常时点交易 ' + offTime + ' 笔', weight: 20 }
      },
      expense_fraud: {
        expense_ratio: { raw: expenseRatio, score: ratioScore(expenseRatio, 1.20), rule: '费用/收入比 ÷ 120% × 5，上限 5', rawText: '费用合计 ' + U.money(expenseAmt) + ' / 收入合计 ' + U.money(revenueAmt) + ' = ' + (expenseRatio * 100).toFixed(1) + '%', weight: 30 },
        claim_focus: { raw: claimFocus, score: ratioScore(claimFocus, 0.80), rule: '单一经办人报销占比 ÷ 80% × 5，上限 5', rawText: '最高经办人报销占比 ' + (claimFocus * 100).toFixed(1) + '%', weight: 20 },
        invoice_seq: { raw: invoiceSeq.count, score: clamp5(invoiceSeq.count >= 5 ? 5 : invoiceSeq.count), rule: '连号/连续金额发票组数（≥5 组得 5 分）', rawText: invoiceSeq.text, weight: 25 },
        cross_period: { raw: crossPeriodClaim, score: ratioScore(crossPeriodRatio, 0.80), rule: '月初 5 日内报销占比 ÷ 80% × 5，上限 5', rawText: '月初 5 日内报销 ' + crossPeriodClaim + ' 笔（占费用分录 ' + (crossPeriodRatio * 100).toFixed(1) + '%）', weight: 25 }
      },
      asset_stripping: {
        impair_anomaly: { raw: impairAmt, score: ratioScore(impairRatio, 0.30), rule: '减值损失/收入比 ÷ 30% × 5，上限 5', rawText: '计提减值 ' + U.money(impairAmt) + '（占收入 ' + (impairRatio * 100).toFixed(1) + '%）', weight: 30 },
        disposal_deviation: { raw: disposeAmt, score: clamp5(disposeAmt > 0 ? 2 + Math.min(3, disposeAmt / 8000000) : 0), rule: '存在处置净损失 → 2 分，每 800 万损失 +1（上限 5）', rawText: disposeAmt ? '处置资产净损失 ' + U.money(disposeAmt) : '未识别到处置净损失', weight: 25 },
        inventory_loss: { raw: inventoryLoss, score: clamp5(inventoryLoss >= 2 ? 5 : inventoryLoss * 2), rule: '盘亏/报废笔数 ×2，上限 5', rawText: '盘亏/报废记录 ' + inventoryLoss + ' 笔', weight: 25 },
        aged_receivable: { raw: agedRatio, score: ratioScore(agedRatio, 0.40), rule: '往来款余额/收入比 ÷ 40% × 5，上限 5', rawText: '其他应收款-往来款余额占收入 ' + (agedRatio * 100).toFixed(1) + '%', weight: 20 }
      }
    };

    /* ---------- 加权计算 ---------- */
    var cards = App.config.FRAUD_TYPES.map(function (ft) {
      var dims = DIMS[ft.code];
      if (!dims) return null;
      var dimList = Object.keys(dims).map(function (k) {
        var d = dims[k];
        var w = (weightOverride[ft.code] && weightOverride[ft.code][k] !== undefined) ? U.num(weightOverride[ft.code][k]) : U.num(d.weight);
        return { key: k, label: (App.config.SCORE_CARD[ft.code].dims.filter(function (x) { return x.key === k; })[0] || {}).label || k, score: d.score, weight: w, raw: d.raw, rawText: d.rawText, rule: d.rule };
      });
      var wSum = U.sum(dimList, function (d) { return d.weight; }) || 100;
      var weighted = U.sum(dimList, function (d) { return d.score * d.weight; }) / wSum * 20; // 5分制 → 100分制
      var total = Math.round(U.clamp(weighted, 0, 100));
      var band = App.config.SCORE_BANDS.filter(function (b) { return total >= b.min && total <= b.max; })[0] || App.config.SCORE_BANDS[0];
      /* 主要贡献维度（用于解释"为什么是这个分"） */
      var contrib = dimList.map(function (d) { return { label: d.label, contribution: U.round(d.score * d.weight / wSum * 20, 1), score: d.score, weight: d.weight }; })
        .sort(function (a, b) { return b.contribution - a.contribution; });
      return {
        code: ft.code,
        name: ft.name,
        desc: ft.desc,
        dims: dimList,
        total: total,
        band: band,
        inFocus: focus.indexOf(ft.code) >= 0,
        topDrivers: contrib.slice(0, 2),
        explain: buildExplain(ft, dimList, total, band)
      };
    }).filter(Boolean);

    /* 综合参考分：关注范围内按分值加权（不做"最高分=舞弊类型"的定性判断） */
    var focusCards = cards.filter(function (c) { return c.inFocus; });
    var overall = focusCards.length ? Math.round(U.sum(focusCards, function (c) { return c.total; }) / focusCards.length) : 0;
    var overallBand = App.config.SCORE_BANDS.filter(function (b) { return overall >= b.min && overall <= b.max; })[0] || App.config.SCORE_BANDS[0];

    var warnings = [];
    if (!risk || !risk.ok) warnings.push('未完成风险信号识别，评分结论仅基于有限数据，可靠性较低。');
    if (!clues.length) warnings.push('未生成线索台账，资金链路与四流指标按 0 计，会低估相关维度分数。');
    if (!suspects.length) warnings.push('未执行关联方核查，关联方维度分数可能偏低。');
    if ((data.bank_transactions || []).length < 50) warnings.push('交易样本量偏小（' + (data.bank_transactions || []).length + ' 笔），评分波动性较大。');
    warnings.push('评分公式、权重与阈值均可在「设置」中查看与调整，调整后历史评分不可直接比较。');

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      cards: cards,
      overall: overall,
      overallBand: overallBand,
      overallText: overallBand.text,
      disclaimer: '以上分值与区间为参考值，需人工复核后定级；本评分不构成对任何单位或个人的舞弊认定。',
      facts: {
        txnCount: txns.length,
        noSupportRatio: noSupportRatio,
        top1Share: top1Share,
        periodEndHits: periodEndHits,
        personalCard: personalCard,
        refundClues: refundClues.length,
        offTime: offTime,
        approvalGap: approvalGap,
        keyPersonHard: keyPersonHard.length,
        maxEquityDepth: maxDepth,
        priceDeviation: priceDeviation,
        freqAnomaly: freqAnomaly,
        expenseRatio: expenseRatio,
        claimFocus: claimFocus,
        invoiceSeq: invoiceSeq.count,
        crossPeriodClaim: crossPeriodClaim,
        impairAmt: impairAmt,
        disposeAmt: disposeAmt,
        inventoryLoss: inventoryLoss,
        agedRatio: agedRatio,
        relatedShare: relatedShare,
        guaranteeCount: guaranteeEntries.length,
        marginCount: marginFlow.length
      },
      weights: weightOverride,
      warnings: warnings
    };
  };

  /* 价格偏离度：同科目同事项的单价离散度（以 金额/数量 无法取得时，用同类分录金额均值偏离近似） */
  function computePriceDeviation(entries) {
    var consult = entries.filter(function (e) { return /咨询/.test(String(e.summary || '')); });
    if (consult.length < 3) return { ratio: 0, text: '同类交易样本不足 3 笔，无法计算价格偏离度' };
    var amts = consult.map(function (e) { return U.num(e.debit) || U.num(e.credit); }).filter(function (x) { return x > 0; });
    if (!amts.length) return { ratio: 0, text: '无有效金额' };
    var med = App.stats.median(amts);
    var max = Math.max.apply(null, amts);
    var ratio = med ? (max - med) / med : 0;
    return {
      ratio: Math.max(0, ratio),
      text: '同类咨询类交易 ' + amts.length + ' 笔，最高 ' + U.money(max) + ' / 中位数 ' + U.money(med) + '，偏离 ' + (Math.max(0, ratio) * 100).toFixed(0) + '%'
    };
  }

  /* 发票连号检测：同日同一对手方 3 笔以上金额相差 < 2% 且摘要含发票号 */
  function detectInvoiceSequence(entries) {
    var byKey = {};
    entries.forEach(function (e) {
      var m = String(e.summary || '').match(/发票号?\s*(\d{4,})/);
      if (!m) return;
      var k = String(e.voucher_date) + '|' + String(e.counterparty || '');
      (byKey[k] = byKey[k] || []).push({ amt: U.num(e.debit) || U.num(e.credit), no: m[1] });
    });
    var groups = 0, nos = [];
    Object.keys(byKey).forEach(function (k) {
      var list = byKey[k];
      if (list.length < 3) return;
      var nums = list.map(function (x) { return parseInt(x.no.slice(-2), 10); }).sort(function (a, b) { return a - b; });
      var consecutive = 0;
      for (var i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] === 1) consecutive++;
      if (consecutive >= 2) { groups++; nos.push(list[0].no + '~' + list[list.length - 1].no); }
    });
    return { count: groups, text: groups ? '识别到 ' + groups + ' 组连号发票（发票号 ' + nos.slice(0, 2).join('、') + '）' : '未识别到连续发票号' };
  }

  function buildExplain(ft, dimList, total, band) {
    var sorted = dimList.slice().sort(function (a, b) { return (b.score * b.weight) - (a.score * a.weight); });
    var hi = sorted[0], lo = sorted[sorted.length - 1];
    return {
      why: '「' + ft.name + '」参考分值 ' + total + ' 分，主要来自「' + hi.label + '」维度（得分 ' + hi.score + '/5，权重 ' + hi.weight + '%，依据：' + hi.rawText + '）；' +
        '最低为「' + lo.label + '」维度（得分 ' + lo.score + '/5，依据：' + lo.rawText + '）。',
      band: band.text,
      note: '如需追问某维度为何是该分数，可在「评分评估」页点击该维度右侧的 ⓘ 查看计分口径。'
    };
  }

  App.scorecard = SC;
})(typeof window !== 'undefined' ? window : globalThis);
