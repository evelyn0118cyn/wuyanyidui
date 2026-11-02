/* =============================================================
 * 财务舞弊111 · F6 舞弊调查分析报告起草（report_draft / chart_report）
 *  汇总 F1–F5 结果 → 按固定十节结构成文 → 生成可打印的独立 HTML
 *  强制声明不可删除、不可编辑；结论段留空由岗位人员填写。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var RPT = {};

  /**
   * 组装报告数据模型
   * @param {object} ctx {riskAlert, clueSort, linkage, aggregation, scorecard, data, meta}
   * @param {object} opt {template:{title,orgName,reviewer,includeCharts,includeScorecard,includeQuality}, llmNarrative}
   */
  RPT.build = function (ctx, opt) {
    opt = opt || {};
    var tpl = opt.template || {};
    var risk = ctx.riskAlert, clue = ctx.clueSort, link = ctx.linkage, agg = ctx.aggregation, sc = ctx.scorecard;
    var meta = ctx.meta || {};
    var now = new Date();
    var reportNo = 'FR-' + U.fmtDateCompact(now) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

    var missing = [];
    if (!risk || !risk.ok) missing.push('风险信号识别');
    if (!clue || !clue.ok) missing.push('线索台账');
    if (!link || !link.ok) missing.push('关联方核查');
    if (!agg || !agg.ok) missing.push('数据汇总');
    if (!sc || !sc.ok) missing.push('评分评估');

    /* ---------- 一、背景与范围 ---------- */
    var section1 = {
      title: '一、调查背景与范围',
      orgName: tpl.orgName || meta.company || '（未填写被调查单位）',
      dataSource: meta.label || meta.source || '预设演示数据',
      period: (risk && risk.periodUsed && (risk.periodUsed.start || risk.periodUsed.end))
        ? (risk.periodUsed.start || '—') + ' ~ ' + (risk.periodUsed.end || '—')
        : (meta.periodStart ? meta.periodStart + ' ~ ' + meta.periodEnd : (agg && agg.ok ? agg.caliber.periodRange : '—')),
      caliber: agg && agg.ok ? [
        '统计期间：' + agg.caliber.periodRange + '（' + agg.caliber.periodCount + ' 个会计期间）',
        '科目范围：全科目，一级至末级共 ' + agg.caliber.subjectCount + ' 个科目（末级 ' + agg.caliber.leafCount + ' 个，' + agg.caliber.levelCount + ' 级）',
        '币种与单位：' + agg.caliber.currency + ' / ' + agg.caliber.unit,
        '汇总口径：' + agg.caliber.aggregation,
        '余额规则：' + agg.caliber.balanceRule
      ] : ['（未执行数据汇总，口径说明缺失，本报告结论可靠性受限）'],
      scope: [
        '本次分析覆盖银行流水 ' + ((risk && risk.totals) ? risk.totals.txnCount : 0) + ' 笔，凭证 ' + ((ctx.data && ctx.data.gl_vouchers) ? ctx.data.gl_vouchers.length : 0) + ' 张，分录 ' + ((ctx.data && ctx.data.gl_voucher_entries) ? ctx.data.gl_voucher_entries.length : 0) + ' 条。',
        '分析对象为交易数据与主数据（客户、供应商、员工、账户、科目），不包含访谈、函证等外部取证程序。',
        '本报告所有结论性判断均留空，由调查人员填写。'
      ]
    };

    /* ---------- 二、分析方法 ---------- */
    var section2 = {
      title: '二、分析方法',
      methods: [
        { name: '统计离群筛查', detail: '对金额列计算均值、标准差、四分位距与中位数绝对偏差，采用 ' + (risk && risk.baseline ? risk.baseline.sigma + 'σ + IQR×' + risk.baseline.iqrK + ' + MAD>' + risk.baseline.madZ : '3σ + IQR + MAD') + ' 三口径并行判定（口径：statistical_outlier_threshold）。' },
        { name: '规则异常筛查', detail: 'R01 大额、R02 整数、R03 拆分、R04 期末突击、R05 个人卡、R06 高频、R07 双向对冲、R08 非工作时间、R09 无业务支撑，共 9 类规则逐笔打标签。' },
        { name: '资金链路追踪', detail: '以单笔资金为起点追踪本方账户—对手方—凭证分录链路，标注「完整 / 断点 / 疑似回流」（fund_chain_tracing）。' },
        { name: '资金业务交叉核对', detail: '将银行流水与凭证分录比对，识别「有资金无业务 / 有业务无资金 / 金额不匹配」（fund_business_crosscheck）。' },
        { name: '四流合一检查', detail: '合同流、发票流、资金流、货物流四项要素逐项核对，输出证据缺口清单（four_flow_check），不宣称证据链闭合。' },
        { name: '关联方穿透', detail: '关键人员关联（姓名/身份证/账号/姓名相似）、股权穿透、频次规模异常、资金合同错配四类核查（linkage）。' },
        { name: '全科目汇总', detail: '按科目树逐级汇总发生额与余额，执行借贷平衡校验与数据质量检查（account_full_aggregation）。' },
        { name: '加权评分卡', detail: '七类舞弊 × 四维指标（0–5 分）加权为 0–100 参考分值，映射为参考区间（weighted_scorecard），权重可人工调整。' }
      ]
    };

    /* ---------- 三、主要发现 ---------- */
    var findings = [];
    if (risk && risk.ok) {
      var highSigs = risk.signals.filter(function (s) { return s.riskLevel === 'high'; });
      var peakCounterparty = aggregateTop(risk.signals);
      if (highSigs.length) {
        findings.push({
          no: findings.length + 1,
          title: '高风险信号交易 ' + highSigs.length + ' 笔，涉及金额 ' + U.money(U.sum(highSigs, function (s) { return s.amount; })),
          basis: highSigs.slice(0, 3).map(function (s) {
            return s.txn_date + ' ' + s.direction + ' ' + U.money(s.amount) + '，对手方「' + s.counterparty + '」，命中 ' + s.ruleCodes.join('/');
          }).join('；'),
          rule: '参考等级：高（参考值，需人工复核）',
          detail: '上述交易的共性特征为：' + describeCommon(highSigs) + '。'
        });
      }
      if (peakCounterparty.count >= 3) {
        findings.push({
          no: findings.length + 1,
          title: '对手方「' + peakCounterparty.name + '」集中出现 ' + peakCounterparty.count + ' 条风险信号，累计 ' + U.money(peakCounterparty.amount),
          basis: '规则命中：' + peakCounterparty.rules.join('/') + '；时间跨度 ' + peakCounterparty.dateStart + ' ~ ' + peakCounterparty.dateEnd,
          rule: '涉及规则 ' + peakCounterparty.rules.length + ' 类',
          detail: '该对手方交易在多个维度同时触发信号，建议优先核实其业务实质与关联关系。'
        });
      }
      var byRule = risk.ruleStats.filter(function (r) { return r.count > 0; }).sort(function (a, b) { return b.count - a.count; });
      findings.push({
        no: findings.length + 1,
        title: '规则命中分布：共 ' + risk.totals.signalCount + ' 条风险信号（占全部流水 ' + (risk.totals.signalRatio * 100).toFixed(1) + '%），其中参考高风险 ' + risk.totals.byLevel.high + ' 条、中 ' + risk.totals.byLevel.mid + ' 条',
        basis: byRule.slice(0, 6).map(function (r) { return r.code + r.name + ' ' + r.count + ' 条（' + U.money(r.amount) + '）'; }).join('；'),
        rule: '统计离群命中 ' + risk.totals.statHitCount + ' 条',
        detail: '规则命中仅代表信号，是否构成异常及异常原因须由调查人员结合业务背景判断。'
      });
    }
    if (link && link.ok && link.suspects.length) {
      var kp = link.suspects.filter(function (s) { return s.typeCode === 'key_personnel_relation'; })[0];
      if (kp) {
        findings.push({
          no: findings.length + 1,
          title: '关联方可疑主体 ' + link.totals.suspectCount + ' 个，涉及交易金额 ' + U.money(link.totals.relatedTxnAmount),
          basis: '代表性命中：' + kp.subject + ' — ' + kp.hits.map(function (h) { return h.type; }).join('、') + '（' + kp.hits[0].evidence + '）',
          rule: '关键人员关联 ' + link.typeStats[0].count + ' 个；股权穿透 ' + link.typeStats[1].count + ' 个；频次规模异常 ' + link.typeStats[2].count + ' 个；资金合同错配 ' + link.typeStats[3].count + ' 个',
          detail: '关联关系是否成立须以工商档案、访谈记录等外部证据为准，本报告仅提供初筛清单。'
        });
      }
    }
    if (clue && clue.ok && clue.clues.length) {
      var topClue = clue.clues[0];
      findings.push({
        no: findings.length + 1,
        title: '梳理线索 ' + clue.totals.clueCount + ' 条，参考优先级高 ' + clue.totals.highPriority + ' 条、中 ' + clue.totals.midPriority + ' 条',
        basis: '参考优先级最高：' + topClue.id + '「' + topClue.counterparty + ' / ' + topClue.matter + '」，' + topClue.txnCount + ' 笔、' + U.money(topClue.amount) + '，命中 ' + topClue.ruleCodes.join('/'),
        rule: '资金链路 ' + clue.chainStats['疑似回流'] + ' 条疑似回流、' + clue.chainStats['断点'] + ' 条断点；业务支撑缺口 ' + (clue.crossStats.has_fund_no_biz + clue.crossStats.amount_mismatch) + ' 条',
        detail: '优先级仅用于安排核查顺序，线索价值与核查顺序由调查人员决定。'
      });
    }
    if (agg && agg.ok && agg.quality.length) {
      findings.push({
        no: findings.length + 1,
        title: '数据质量问题 ' + agg.qualityTotals.issueTypes + ' 类、' + agg.qualityTotals.issueCount + ' 项',
        basis: agg.quality.slice(0, 4).map(function (q) { return q.type + ' ' + q.count + ' 条'; }).join('；'),
        rule: '借贷平衡：借方 ' + U.money(agg.balance.totalDebit) + ' / 贷方 ' + U.money(agg.balance.totalCredit) + (agg.balance.balanced ? '（平衡）' : '（差额 ' + U.moneyRaw(agg.balance.diff) + '）'),
        detail: '上述问题可能影响分析结果的可靠性，建议先完成数据整改再作定性判断。'
      });
    }
    if (!findings.length) {
      findings.push({ no: 1, title: '本次分析未产生可列示的发现', basis: '（数据不足或未完成前序分析）', rule: '—', detail: '建议先完成风险信号识别与线索梳理。' });
    }

    /* ---------- 四、线索台账摘要 ---------- */
    var section4 = {
      title: '四、线索台账摘要',
      headers: ['线索编号', '线索摘要', '涉及主体', '笔数', '累计金额', '时间跨度', '命中规则', '资金链路', '业务支撑', '参考优先级'],
      rows: (clue && clue.ok ? clue.clues.slice(0, 30) : []).map(function (c) {
        return [c.id, c.counterparty + ' / ' + c.matter, c.subjects.join('、'), c.txnCount, U.money(c.amount), c.dateStart + '~' + c.dateEnd, c.ruleCodes.join('/'), c.chain.status, c.cross.status, c.priority + '（' + (c.priorityLevel === 'high' ? '高' : c.priorityLevel === 'mid' ? '中' : '低') + '）'];
      }),
      note: '上表为参考优先级排序结果（权重：金额 40%、规则种类 30%、关联方命中 20%、链路完整性 10%），排序不代表线索价值判断。'
    };

    /* ---------- 五、关联方核查摘要 ---------- */
    var section5 = {
      title: '五、关联方核查摘要',
      headers: ['主体', '关联类型', '命中依据', '置信提示', '涉及笔数', '累计金额'],
      rows: (link && link.ok ? link.suspects.slice(0, 30) : []).map(function (s) {
        return [s.subject, s.type, (s.hits[0] ? s.hits[0].evidence : ''), s.confidence, s.txnCount, U.money(s.txnAmount)];
      }),
      typeStats: link && link.ok ? link.typeStats : [],
      note: '关联关系认定需人工核实工商信息与访谈确认。'
    };

    /* ---------- 六、评分评估 ---------- */
    var section6 = {
      title: '六、舞弊可能性参考评估',
      cards: (sc && sc.ok) ? sc.cards : [],
      overall: sc && sc.ok ? sc.overall : 0,
      overallText: sc && sc.ok ? sc.overallText : '（未执行评分）',
      disclaimer: '以上分值与区间为参考值，需人工复核后定级。'
    };

    /* ---------- 七、证据缺口与待核实事项 ---------- */
    var evidenceGaps = [];
    if (clue && clue.ok) {
      clue.clues.forEach(function (c) {
        (c.cross.gaps || []).forEach(function (g) { evidenceGaps.push({ source: c.id + ' ' + c.counterparty, gap: g, type: '业务支撑' }); });
        (c.fourFlow.missing || []).forEach(function (g) { evidenceGaps.push({ source: c.id + ' ' + c.counterparty, gap: g, type: '四流缺口' }); });
        (c.chain.notes || []).forEach(function (n) { if (/断点|回流|无对应/.test(n)) evidenceGaps.push({ source: c.id + ' ' + c.counterparty, gap: n, type: '资金链路' }); });
      });
    }
    var dedupGaps = [];
    var seenGap = {};
    evidenceGaps.forEach(function (g) {
      var k = g.type + '|' + g.gap;
      if (seenGap[k]) { seenGap[k].count++; seenGap[k].sources.push(g.source); return; }
      seenGap[k] = g; g.count = 1; g.sources = [g.source]; dedupGaps.push(g);
    });
    dedupGaps.sort(function (a, b) { return b.count - a.count; });
    var section7 = {
      title: '七、证据缺口与待核实事项清单',
      gaps: dedupGaps.slice(0, 25),
      verify: buildVerifyList(risk, link, clue),
      note: '本清单为「证据缺口清单」，不代表证据链已闭合。缺口的性质（单据瑕疵或舞弊迹象）须由调查人员判断。'
    };

    /* ---------- 八、进一步核查建议 ---------- */
    var suggestions = [];
    var seenSug = {};
    (clue && clue.ok ? clue.clues.slice(0, 10) : []).forEach(function (c) {
      (c.directions || []).forEach(function (d) { if (!seenSug[d]) { seenSug[d] = 1; suggestions.push({ dir: d, from: c.id }); } });
    });
    if (risk && risk.ok) {
      var topRules = risk.ruleStats.filter(function (r) { return r.count > 0; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
      topRules.forEach(function (r) {
        var d = { R01: '对全部大额交易执行原始凭证与合同抽检', R02: '核查整数金额定价依据与同类交易比价', R03: '比对各层级审批额度与实际付款笔数，核查是否存在规避审批的拆分', R04: '对期末集中确认交易执行截止性测试', R05: '比对个人卡收付对象与工资/报销发放清单', R06: '分析高频对手方的交易必要性与其成立时间、经营规模', R07: '调取对冲交易双方流水，核实资金是否实质回流', R08: '核查非工作时间操作的审批留痕与系统日志', R09: '对无业务支撑流水开展函证与原始单据调取' }[r.code];
        if (d && !seenSug[d]) { seenSug[d] = 1; suggestions.push({ dir: d, from: '规则 ' + r.code }); }
      });
    }
    if (link && link.ok && link.suspects.length) {
      var d2 = '对关联方可疑主体调取完整工商档案（股东、董监高、变更记录）并核对关联交易审批与披露程序';
      if (!seenSug[d2]) { seenSug[d2] = 1; suggestions.push({ dir: d2, from: '关联方核查' }); }
    }
    if (agg && agg.ok && agg.quality.length) {
      var d3 = '先完成数据质量整改（' + agg.quality.map(function (q) { return q.type; }).slice(0, 3).join('、') + '），再据以复核分析结论';
      if (!seenSug[d3]) { seenSug[d3] = 1; suggestions.push({ dir: d3, from: '数据质量' }); }
    }
    suggestions.push({ dir: '结合访谈与函证程序验证上述数据异常背后的业务实质', from: '通用程序' });
    var section8 = {
      title: '八、进一步核查建议',
      items: suggestions.slice(0, 12),
      note: '以上仅为调查方向建议，不构成处置建议。是否启动正式调查、是否上报、是否移送由岗位人员依职权决定。'
    };

    /* ---------- 九、数据质量与局限性 ---------- */
    var section9 = {
      title: '九、数据质量与局限性说明',
      quality: (agg && agg.ok) ? agg.quality : [],
      balanced: agg && agg.ok ? agg.balance : null,
      limits: [
        '本报告基于结构化交易与账务数据，不含访谈、函证、现场核查等外部证据，无法据此确认业务真实性。',
        (risk && risk.baseline && risk.baseline.n ? '统计离群分析的样本量为 ' + risk.baseline.n + ' 笔' + (risk.baseline.usable ? '，满足基本要求' : '，样本量不足，结论稳定性有限') + '。' : ''),
        '规则阈值采用默认口径（可由人工调整），不同阈值会显著改变命中数量，阈值本身不代表监管标准。',
        '资金链路追踪仅覆盖本方账户可见流水，对手方后续流向需借助外部协查，本报告标注的「疑似回流」仅为特征提示。',
        '关联方初筛仅基于可获取的主数据与内置工商信息示例，未接入外部工商数据库时穿透深度有限。',
        '评分卡权重带有主观性，分值与区间用于分配注意力，不等于舞弊概率。',
        '若数据质量检查发现的问题未先行整改，全部指标均可能失真。'
      ]
    };

    /* ---------- 十、声明 ---------- */
    var section10 = {
      title: '十、声明',
      text: App.config.MANDATORY_DISCLAIMER,
      extra: [
        '本报告不包含对任何单位或个人的处置建议；涉及合规制度的判断需人工对照现行制度确认。',
        '本报告为初稿，结论段（见「结论（由调查人员填写）」）与签署栏留空，须由岗位人员完成定稿与签发。'
      ]
    };

    return {
      ok: true,
      reportNo: reportNo,
      title: tpl.title || '舞弊调查分析报告（初稿）',
      orgName: tpl.orgName || meta.company || '',
      reviewer: tpl.reviewer || '',
      generatedAt: U.fmtDateTime(now),
      generatedAtISO: now.toISOString(),
      missingModules: missing,
      sections: {
        s1: section1, s2: section2,
        s3: { title: '三、主要发现', findings: findings },
        s4: section4, s5: section5, s6: section6,
        s7: section7, s8: section8, s9: section9, s10: section10
      },
      disclaimer: App.config.MANDATORY_DISCLAIMER,
      conclusionPlaceholder: '（此处由调查人员填写调查结论、责任认定与处置意见；AI 助理不提供结论）',
      includeCharts: tpl.includeCharts !== false,
      includeScorecard: tpl.includeScorecard !== false,
      includeQuality: tpl.includeQuality !== false,
      llmNarrative: opt.llmNarrative || '',
      sources: {
        riskAlert: !!(risk && risk.ok),
        clueSort: !!(clue && clue.ok),
        linkage: !!(link && link.ok),
        aggregation: !!(agg && agg.ok),
        scorecard: !!(sc && sc.ok)
      }
    };
  };

  function aggregateTop(signals) {
    var byCp = {};
    signals.forEach(function (s) {
      var g = byCp[s.counterparty] || (byCp[s.counterparty] = { name: s.counterparty, count: 0, amount: 0, rules: {}, dates: [] });
      g.count++; g.amount += s.amount; g.dates.push(s.txn_date);
      s.ruleCodes.forEach(function (c) { g.rules[c] = 1; });
    });
    var list = Object.keys(byCp).map(function (k) { return byCp[k]; }).sort(function (a, b) { return b.count - a.count; });
    if (!list.length) return { name: '', count: 0, amount: 0, rules: [], dateStart: '', dateEnd: '' };
    var t = list[0];
    var ds = t.dates.slice().sort();
    return { name: t.name, count: t.count, amount: t.amount, rules: Object.keys(t.rules), dateStart: ds[0], dateEnd: ds[ds.length - 1] };
  }

  function describeCommon(sigs) {
    var cnt = {};
    sigs.forEach(function (s) { s.ruleCodes.forEach(function (c) { cnt[c] = (cnt[c] || 0) + 1; }); });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 3);
    var names = { R01: '单笔金额显著偏大', R02: '金额呈整数倍特征', R03: '存在拆分支付特征', R04: '集中在会计期末发生', R05: '对手方为自然人', R06: '交易频次异常偏高', R07: '短期收付金额近似（对冲特征）', R08: '发生于夜间或非工作日', R09: '无业务凭证支撑' };
    return top.map(function (c) { return names[c] || c; }).join('、') || '多项规则共同命中';
  }

  function buildVerifyList(risk, link, clue) {
    var list = [];
    if (link && link.ok) {
      link.suspects.slice(0, 6).forEach(function (s) {
        (s.needs || []).slice(0, 2).forEach(function (n) { list.push({ subject: s.subject, item: n, type: '关联方' }); });
      });
    }
    if (clue && clue.ok) {
      clue.clues.slice(0, 6).forEach(function (c) {
        if (c.cross.gaps.length) list.push({ subject: c.counterparty, item: '核实：' + c.cross.gaps[0], type: '业务真实性' });
      });
    }
    if (risk && risk.ok) {
      var r09 = risk.signals.filter(function (s) { return s.ruleCodes.indexOf('R09') >= 0; }).slice(0, 3);
      r09.forEach(function (s) { list.push({ subject: s.counterparty, item: '调取 ' + s.txn_date + ' ' + U.money(s.amount) + ' 资金对应的合同、发票与交付凭证', type: '原始单据' }); });
    }
    return list.slice(0, 15);
  }

  /* ---------- 生成可打印 HTML（独立文件，双击可开） ---------- */
  RPT.toHTML = function (rep, charts) {
    var s = rep.sections;
    var esc = U.escapeHtml;
    var css = [
      'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1F1B2E;background:#fff;margin:0;font-size:13px;line-height:1.75;}',
      '.page{max-width:900px;margin:0 auto;padding:48px 56px 64px;}',
      'h1{font-size:22px;color:#4B2FD6;margin:0 0 6px;letter-spacing:.5px;}',
      '.sub{color:#6B6780;font-size:12px;margin-bottom:4px;}',
      '.meta{border:1px solid #E7E3F5;border-radius:8px;padding:12px 16px;background:#F7F5FF;margin:18px 0 26px;font-size:12px;}',
      '.meta b{color:#4B2FD6;}',
      'h2{font-size:15px;color:#4B2FD6;border-left:3px solid #6D4AFF;padding-left:9px;margin:26px 0 10px;}',
      'table{border-collapse:collapse;width:100%;font-size:11.5px;margin:8px 0 12px;}',
      'th{background:#EFEAFF;color:#4B2FD6;font-weight:600;text-align:left;padding:6px 8px;border:1px solid #E7E3F5;}',
      'td{padding:6px 8px;border:1px solid #E7E3F5;vertical-align:top;}',
      'tr:nth-child(even) td{background:#FCFBFF;}',
      '.fx{border:1px solid #E7E3F5;border-radius:8px;padding:10px 14px;margin:10px 0;background:#fff;}',
      '.fx .t{font-weight:600;color:#1F1B2E;}',
      '.fx .b{color:#6B6780;font-size:12px;margin-top:4px;}',
      '.tag{display:inline-block;background:#EFEAFF;color:#4B2FD6;border-radius:4px;padding:1px 7px;font-size:11px;margin-right:6px;}',
      '.warn{background:#FFF7E6;border:1px solid #FFE0A3;border-radius:8px;padding:10px 14px;font-size:12px;color:#8A5A00;margin:10px 0;}',
      '.danger{background:#EFEAFF;border:1px solid #6D4AFF;border-radius:8px;padding:12px 16px;font-size:12.5px;color:#4B2FD6;margin:16px 0;font-weight:500;}',
      '.sign{margin-top:26px;border-top:1px dashed #E7E3F5;padding-top:14px;font-size:12px;color:#6B6780;}',
      '.sign span{display:inline-block;width:230px;}',
      '.concl{border:1px dashed #6D4AFF;border-radius:8px;padding:16px;color:#6B6780;font-style:italic;background:#FCFBFF;min-height:70px;}',
      'ul,ol{margin:6px 0 12px;padding-left:22px;} li{margin:3px 0;}',
      '.foot{color:#9C99AB;font-size:11px;margin-top:32px;border-top:1px solid #E7E3F5;padding-top:10px;}',
      '@media print{.page{padding:0;} h2{page-break-after:avoid;} table{page-break-inside:auto;} tr{page-break-inside:avoid;} .no-print{display:none;}}'
    ].join('\n');

    var h = [];
    h.push('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(rep.title) + ' ' + esc(rep.reportNo) + '</title>');
    h.push('<style>' + css + '</style></head><body><div class="page">');
    h.push('<h1>' + esc(rep.title) + '</h1>');
    h.push('<div class="sub">报告编号：' + esc(rep.reportNo) + '　｜　生成时间：' + esc(rep.generatedAt) + '　｜　生成方式：AI 助理辅助生成（初稿）</div>');
    h.push('<div class="sub">被调查单位：' + esc(rep.orgName || '（未填写）') + '　｜　复核人：' + esc(rep.reviewer || '（待填写）') + '</div>');
    h.push('<div class="danger">⚠ 强制声明：' + esc(rep.disclaimer) + '</div>');

    if (rep.missingModules && rep.missingModules.length) {
      h.push('<div class="warn">本报告缺少以下模块的结果：' + esc(rep.missingModules.join('、')) + '。相关章节内容为空，结论可靠性受限，请补全后重新生成。</div>');
    }

    /* 一 */
    h.push('<h2>' + esc(s.s1.title) + '</h2>');
    h.push('<div class="meta"><b>被调查单位</b>：' + esc(s.s1.orgName) + '<br><b>数据来源</b>：' + esc(s.s1.dataSource) + '<br><b>统计期间</b>：' + esc(s.s1.period) + '<br><b>分析范围</b>：' + esc(s.s1.scope[0]) + '</div>');
    h.push('<b>口径说明</b><ul>' + s.s1.caliber.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>');
    h.push('<ul>' + s.s1.scope.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>');

    /* 二 */
    h.push('<h2>' + esc(s.s2.title) + '</h2><table><thead><tr><th style="width:130px">方法</th><th>说明</th></tr></thead><tbody>');
    s.s2.methods.forEach(function (m) { h.push('<tr><td>' + esc(m.name) + '</td><td>' + esc(m.detail) + '</td></tr>'); });
    h.push('</tbody></table>');

    /* 三 */
    h.push('<h2>' + esc(s.s3.title) + '</h2>');
    s.s3.findings.forEach(function (f) {
      h.push('<div class="fx"><div class="t">' + f.no + '. ' + esc(f.title) + '</div>');
      h.push('<div class="b"><span class="tag">数据依据</span>' + esc(f.basis) + '</div>');
      h.push('<div class="b"><span class="tag">命中规则</span>' + esc(f.rule) + '</div>');
      h.push('<div class="b">' + esc(f.detail) + '</div></div>');
    });
    if (rep.llmNarrative) {
      h.push('<h2 style="font-size:14px">主要发现（大模型辅助叙述）</h2><div class="fx"><div class="b" style="white-space:pre-wrap">' + esc(rep.llmNarrative) + '</div></div>');
      h.push('<div class="warn">上段文字由大模型基于本报告结构化结果生成，仅供文字参考，数据以本报告表格为准。</div>');
    }

    /* 四 */
    h.push('<h2>' + esc(s.s4.title) + '</h2>');
    if (s.s4.rows.length) {
      h.push('<table><thead><tr>' + s.s4.headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>');
      s.s4.rows.forEach(function (r) { h.push('<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'); });
      h.push('</tbody></table>');
    } else { h.push('<div class="warn">未生成线索台账。</div>'); }
    h.push('<div class="sub">' + esc(s.s4.note) + '</div>');

    /* 五 */
    h.push('<h2>' + esc(s.s5.title) + '</h2>');
    if (s.s5.rows.length) {
      h.push('<table><thead><tr>' + s.s5.headers.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>');
      s.s5.rows.forEach(function (r) { h.push('<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'); });
      h.push('</tbody></table>');
    } else { h.push('<div class="warn">未执行关联方核查，或未发现可疑关联主体。</div>'); }
    h.push('<div class="sub">' + esc(s.s5.note) + '</div>');

    /* 六 */
    h.push('<h2>' + esc(s.s6.title) + '</h2>');
    if (rep.includeScorecard && s.s6.cards.length) {
      h.push('<table><thead><tr><th>舞弊类型</th><th>维度得分（0–5）</th><th>参考分值</th><th>参考区间</th></tr></thead><tbody>');
      s.s6.cards.forEach(function (c) {
        h.push('<tr><td>' + esc(c.name) + '</td><td>' + c.dims.map(function (d) { return esc(d.label + ' ' + d.score + '/' + d.weight + '%'); }).join('；') + '</td><td><b>' + c.total + '</b></td><td>' + esc(c.band.text) + '</td></tr>');
      });
      h.push('</tbody></table>');
      h.push('<div class="warn">综合参考分值 <b>' + s.s6.overall + '</b> —— ' + esc(s.s6.overallText) + '。' + esc(s.s6.disclaimer) + '</div>');
    } else { h.push('<div class="warn">未执行评分评估。</div>'); }

    /* 七 */
    h.push('<h2>' + esc(s.s7.title) + '</h2>');
    if (s.s7.gaps.length) {
      h.push('<table><thead><tr><th style="width:90px">类型</th><th>证据缺口</th><th style="width:70px">出现次数</th></tr></thead><tbody>');
      s.s7.gaps.forEach(function (g) { h.push('<tr><td>' + esc(g.type) + '</td><td>' + esc(g.gap) + '</td><td>' + g.count + '</td></tr>'); });
      h.push('</tbody></table>');
    } else { h.push('<div class="sub">未识别到明确的证据缺口（仍需人工核验原始单据）。</div>'); }
    if (s.s7.verify.length) {
      h.push('<b>待核实事项</b><ol>' + s.s7.verify.map(function (v) { return '<li>' + esc(v.subject) + '：' + esc(v.item) + '</li>'; }).join('') + '</ol>');
    }
    h.push('<div class="sub">' + esc(s.s7.note) + '</div>');

    /* 八 */
    h.push('<h2>' + esc(s.s8.title) + '</h2>');
    h.push('<ol>' + s.s8.items.map(function (x) { return '<li>' + esc(x.dir) + ' <span class="sub">（来源：' + esc(x.from) + '）</span></li>'; }).join('') + '</ol>');
    h.push('<div class="sub">' + esc(s.s8.note) + '</div>');

    /* 九 */
    if (rep.includeQuality) {
      h.push('<h2>' + esc(s.s9.title) + '</h2>');
      if (s.s9.quality.length) {
        h.push('<table><thead><tr><th style="width:120px">问题类型</th><th style="width:60px">条数</th><th>明细</th><th>影响提示</th></tr></thead><tbody>');
        s.s9.quality.forEach(function (q) { h.push('<tr><td>' + esc(q.type) + '</td><td>' + q.count + '</td><td>' + esc(q.detail) + '</td><td>' + esc(q.impact || '') + '</td></tr>'); });
        h.push('</tbody></table>');
      }
      if (s.s9.balanced) {
        h.push('<div class="meta"><b>借贷平衡校验</b>：借方发生额 ' + U.moneyRaw(s.s9.balanced.totalDebit) + ' 元 / 贷方发生额 ' + U.moneyRaw(s.s9.balanced.totalCredit) + ' 元，差异 ' + U.moneyRaw(s.s9.balanced.diff) + ' 元 —— ' + (s.s9.balanced.balanced ? '平衡' : '不平衡，需先整改') + '</div>');
      }
      h.push('<b>局限性说明</b><ul>' + s.s9.limits.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
    }

    /* 结论（留空） */
    h.push('<h2>结论（由调查人员填写）</h2>');
    h.push('<div class="concl">' + esc(rep.conclusionPlaceholder) + '</div>');

    /* 十 */
    h.push('<h2>' + esc(s.s10.title) + '</h2>');
    h.push('<div class="danger">' + esc(s.s10.text) + '</div>');
    h.push('<ul>' + s.s10.extra.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
    h.push('<div class="sign"><span>调查人员（签字）：____________</span><span>复核人（签字）：____________</span><br><br><span>签发日期：________年____月____日</span><span>报告编号：' + esc(rep.reportNo) + '</span></div>');
    h.push('<div class="foot">本页由「财务舞弊111」AI 助理生成 · 报告编号 ' + esc(rep.reportNo) + ' · 生成时间 ' + esc(rep.generatedAt) + ' · 强制声明不可删除、不可编辑</div>');
    h.push('</div></body></html>');
    return h.join('\n');
  };

  /* ---------- 导出 Markdown ---------- */
  RPT.toMarkdown = function (rep) {
    var s = rep.sections, L = [];
    L.push('# ' + rep.title);
    L.push('');
    L.push('- 报告编号：' + rep.reportNo);
    L.push('- 生成时间：' + rep.generatedAt);
    L.push('- 被调查单位：' + (rep.orgName || '（未填写）'));
    L.push('- 复核人：' + (rep.reviewer || '（待填写）'));
    L.push('');
    L.push('> ⚠ **强制声明**：' + rep.disclaimer);
    L.push('');
    L.push('## ' + s.s1.title);
    L.push('- 数据来源：' + s.s1.dataSource);
    L.push('- 统计期间：' + s.s1.period);
    s.s1.caliber.forEach(function (c) { L.push('- ' + c); });
    s.s1.scope.forEach(function (c) { L.push('- ' + c); });
    L.push('');
    L.push('## ' + s.s2.title);
    s.s2.methods.forEach(function (m) { L.push('- **' + m.name + '**：' + m.detail); });
    L.push('');
    L.push('## ' + s.s3.title);
    s.s3.findings.forEach(function (f) {
      L.push('### ' + f.no + '. ' + f.title);
      L.push('- 数据依据：' + f.basis);
      L.push('- 命中规则：' + f.rule);
      L.push('- ' + f.detail);
      L.push('');
    });
    L.push('## ' + s.s4.title);
    if (s.s4.rows.length) {
      L.push('| ' + s.s4.headers.join(' | ') + ' |');
      L.push('|' + s.s4.headers.map(function () { return '---'; }).join('|') + '|');
      s.s4.rows.forEach(function (r) { L.push('| ' + r.join(' | ') + ' |'); });
    } else L.push('未生成线索台账。');
    L.push('');
    L.push('## ' + s.s5.title);
    if (s.s5.rows.length) {
      L.push('| ' + s.s5.headers.join(' | ') + ' |');
      L.push('|' + s.s5.headers.map(function () { return '---'; }).join('|') + '|');
      s.s5.rows.forEach(function (r) { L.push('| ' + r.join(' | ') + ' |'); });
    } else L.push('未执行关联方核查。');
    L.push('');
    L.push('## ' + s.s6.title);
    if (s.s6.cards.length) {
      L.push('| 舞弊类型 | 参考分值 | 参考区间 |');
      L.push('|---|---|---|');
      s.s6.cards.forEach(function (c) { L.push('| ' + c.name + ' | ' + c.total + ' | ' + c.band.text + ' |'); });
      L.push('');
      L.push('综合参考分值 **' + s.s6.overall + '** —— ' + s.s6.overallText + '。' + s.s6.disclaimer);
    }
    L.push('');
    L.push('## ' + s.s7.title);
    if (s.s7.gaps.length) s.s7.gaps.forEach(function (g) { L.push('- [' + g.type + '] ' + g.gap + '（出现 ' + g.count + ' 次）'); });
    else L.push('未识别到明确的证据缺口。');
    if (s.s7.verify.length) { L.push(''); L.push('**待核实事项**'); s.s7.verify.forEach(function (v, i) { L.push((i + 1) + '. ' + v.subject + '：' + v.item); }); }
    L.push('');
    L.push('## ' + s.s8.title);
    s.s8.items.forEach(function (x) { L.push('- ' + x.dir + '（来源：' + x.from + '）'); });
    L.push('');
    if (rep.includeQuality) {
      L.push('## ' + s.s9.title);
      if (s.s9.quality.length) {
        L.push('| 问题类型 | 条数 | 明细 | 影响提示 |');
        L.push('|---|---|---|---|');
        s.s9.quality.forEach(function (q) { L.push('| ' + q.type + ' | ' + q.count + ' | ' + String(q.detail).replace(/\|/g, '/') + ' | ' + (q.impact || '') + ' |'); });
      }
      s.s9.limits.forEach(function (x) { L.push('- ' + x); });
      L.push('');
    }
    L.push('## 结论（由调查人员填写）');
    L.push('');
    L.push('> ' + rep.conclusionPlaceholder);
    L.push('');
    L.push('## ' + s.s10.title);
    L.push('> ' + s.s10.text);
    L.push('');
    s.s10.extra.forEach(function (x) { L.push('- ' + x); });
    L.push('');
    L.push('调查人员（签字）：____________　　复核人（签字）：____________　　签发日期：____年__月__日');
    return L.join('\n');
  };

  App.report = RPT;
})(typeof window !== 'undefined' ? window : globalThis);
