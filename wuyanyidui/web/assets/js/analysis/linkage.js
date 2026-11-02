/* =============================================================
 * 财务舞弊111 · F3 关联方穿透与关联交易核查（linkage）
 *  key_personnel_relation   关键人员关联（姓名/身份证/银行卡号/姓名相似）
 *  equity_penetration       股权穿透（股东链、多层持股、交叉持股、代持嫌疑）
 *  frequency_scale_anomaly  频次规模异常（集中度、频次偏离）
 *  fund_contract_mismatch   资金合同错配（付款对象≠合同相对方、账户/发票主体不一致）
 * 输出「命中依据 + 需人工核实要点」，关联关系是否成立由人工判断。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var LK = {};

  LK.run = function (ds, opt) {
    opt = opt || {};
    var data = (ds && ds.data) || ds || {};
    var th = opt.thresholds || App.config.DEFAULT_THRESHOLDS;
    var employees = data.employees || [];
    var customers = data.customers || [];
    var suppliers = data.suppliers || [];
    var departments = data.departments || [];
    var txns = data.bank_transactions || [];
    var entries = data.gl_voucher_entries || [];
    var vouchers = data.gl_vouchers || [];
    var equity = (opt.equity && opt.equity.length) ? opt.equity : buildDefaultEquity(customers, suppliers, employees);

    if (!employees.length && !customers.length && !suppliers.length) {
      return { ok: false, error: '未读取到主数据（员工/客户/供应商档案），请到「数据汇总」接入数据后重试。' };
    }

    var suspects = [];
    var deptById = {};
    departments.forEach(function (d) { deptById[d.dept_id] = d; });
    var vouchersById = {};
    vouchers.forEach(function (v) { vouchersById[v.voucher_id] = v; });

    /* 交易统计：按对手方名称 */
    var cpStat = {};
    function addCp(name, amount, date, dir) {
      var n = String(name || '').trim();
      if (!n) return;
      var a = cpStat[n] || (cpStat[n] = { name: n, count: 0, amount: 0, dates: [], recv: 0, pay: 0, txns: [] });
      a.count++; a.amount += U.num(amount);
      if (dir === '收') a.recv += U.num(amount); else a.pay += U.num(amount);
      a.dates.push(date);
      a.txns.push({ amount: U.num(amount), date: date, dir: dir });
    }
    txns.forEach(function (t) { addCp(t.counterparty_name, t.amount, U.fmtDate(t.txn_date), t.direction); });
    entries.forEach(function (e) { addCp(e.counterparty, U.num(e.debit) || U.num(e.credit), U.fmtDate(e.voucher_date), U.num(e.debit) ? '付' : '收'); });

    /* ================= 1. 关键人员关联 key_personnel_relation ================= */
    var subjects = []
      .concat(customers.map(function (c) { return { kind: '客户', id: c.customer_id, name: c.customer_name, legal: c.legal_person, contact: c.contact, account: c.bank_account, row: c }; }))
      .concat(suppliers.map(function (s) { return { kind: '供应商', id: s.supplier_id, name: s.supplier_name, legal: s.legal_person, contact: s.contact, account: s.bank_account, row: s }; }));

    var idIndex = {}, accIndex = {}, nameIndex = {};
    employees.forEach(function (e) {
      if (e.id_card) idIndex[String(e.id_card).trim()] = e;
      if (e.salary_card) accIndex[String(e.salary_card).trim()] = e;
      if (e.employee_name) nameIndex[String(e.employee_name).trim()] = e;
    });

    var editMax = U.num(th.name_similarity_edit, 1);
    subjects.forEach(function (s) {
      var hits = [];
      /* 身份证同号 */
      var pids = [s.legal, s.contact].filter(Boolean);
      Object.keys(idIndex).forEach(function (idc) {
        /* 主数据里法人/联系人一般无身份证，若提供了 person_id_card 则比对 */
        var cand = [s.row.legal_person_id_card, s.row.contact_id_card].filter(Boolean);
        if (cand.indexOf(idc) >= 0) {
          var emp = idIndex[idc];
          hits.push({ type: '身份证同号', evidence: '法人/联系人身份证号与员工「' + emp.employee_name + '」(' + emp.employee_id + ') 完全一致', employee: emp, weight: 3 });
        }
      });
      /* 银行卡号相同：供应商/客户账户 = 员工工资卡 */
      if (s.account && accIndex[String(s.account).trim()]) {
        var emp2 = accIndex[String(s.account).trim()];
        hits.push({ type: '银行账号重合', evidence: '对方收款账号 ' + U.maskAccount(s.account) + ' 与员工「' + emp2.employee_name + '」(' + emp2.employee_id + ') 工资卡号完全一致', employee: emp2, weight: 3 });
      }
      /* 姓名完全一致 / 姓名相似（法人、联系人去重，避免同一人重复命中） */
      U.uniq([s.legal, s.contact].filter(Boolean).map(function (x) { return String(x).trim(); })).forEach(function (nm) {
        if (nameIndex[nm]) {
          var emp3 = nameIndex[nm];
          hits.push({ type: '法定代表人同名', evidence: '法人/联系人姓名「' + nm + '」与本单位员工（' + (deptById[emp3.dept_id] || {}).dept_name + ' ' + emp3.position + '，' + emp3.employee_id + '）完全一致', employee: emp3, weight: 2 });
        } else {
          /* 姓名相似（编辑距离 ≤ 1，且需同为中文姓名） */
          Object.keys(nameIndex).forEach(function (en) {
            if (!/^[\u4e00-\u9fa5]{2,4}$/.test(nm) || !/^[\u4e00-\u9fa5]{2,4}$/.test(en)) return;
            if (nm === en || Math.abs(nm.length - en.length) > editMax) return;
            var d = U.levenshtein(nm, en);
            if (d <= editMax) {
              var emp4 = nameIndex[en];
              hits.push({ type: '姓名相似', evidence: '法人/联系人姓名「' + nm + '」与员工「' + en + '」(' + emp4.employee_id + ') 编辑距离 ' + d + '（≤' + editMax + '）', employee: emp4, weight: 1 });
            }
          });
        }
      });
      /* 公司名包含员工姓名（如"XX鑫和"-若法人为员工已在上面覆盖，此处补充） */
      if (hits.length) {
        var st = cpStat[s.name] || { count: 0, amount: 0, dates: [] };
        suspects.push({
          id: 'LK-' + (suspects.length + 1).toString().padStart(3, '0'),
          subject: s.name,
          subjectKind: s.kind,
          subjectId: s.id,
          type: '关键人员关联（key_personnel_relation）',
          typeCode: 'key_personnel_relation',
          hitCount: hits.length,
          hits: hits,
          legal: s.legal || '',
          contact: s.contact || '',
          account: s.account || '',
          txnCount: st.count,
          txnAmount: st.amount,
          dateStart: st.dates.length ? U.fmtDate(st.dates[0]) : '',
          dateEnd: st.dates.length ? U.fmtDate(st.dates[st.dates.length - 1]) : '',
          confidence: hits.reduce(function (a, h) { return a + h.weight; }, 0) >= 5 ? '高（多项硬证据命中）' : hits.some(function (h) { return h.weight >= 3; }) ? '较高（存在硬证据）' : '中（仅姓名相似，需进一步核实）',
          needs: buildNeeds(s, hits)
        });
      }
    });

    /* ================= 2. 股权穿透 equity_penetration ================= */
    var equityHits = [];
    equity.forEach(function (node) {
      var chain = node.chain || [];
      var maxDepth = chain.length;
      var flags = [];
      if (maxDepth >= 3) flags.push('多层级持股（' + maxDepth + ' 层）');
      if (node.crossHolding) flags.push('交叉持股');
      if (node.nominee) flags.push('代持嫌疑');
      var empLinks = [];
      chain.forEach(function (c) {
        if (c.person && nameIndex[String(c.person).trim()]) {
          empLinks.push({ person: c.person, employee: nameIndex[String(c.person).trim()], level: c.level, share: c.share, company: c.company || node.subject });
        }
        /* 股东中包含本单位 / 本单位员工 */
        if (c.person && /本单位|华信融通/.test(String(c.company || ''))) flags.push('股东含本单位主体');
      });
      /* 股东链条出现在供应链上的主体 = 潜在关联方 */
      if (flags.length || empLinks.length) {
        var st2 = cpStat[node.subject] || { count: 0, amount: 0, dates: [] };
        var hits2 = [];
        if (maxDepth >= 2) hits2.push({ type: '股权层级', evidence: node.subject + ' 股权链条 ' + chain.map(function (c) { return (c.company || '') + (c.person ? '←' + c.person : ''); }).join(' → ') + '，共 ' + maxDepth + ' 层' , weight: 1 });
        empLinks.forEach(function (l) {
          hits2.push({ type: '股权链关键人员', evidence: '第 ' + l.level + ' 层股东「' + l.person + '」为本单位员工（' + l.employee.employee_id + '），持股 ' + (l.share * 100).toFixed(1) + '%', weight: 2 });
        });
        (node.flags || []).forEach(function (f) { hits2.push({ type: '工商特征', evidence: f, weight: 1 }); });
        suspects.push({
          id: 'LK-' + (suspects.length + 1).toString().padStart(3, '0'),
          subject: node.subject,
          subjectKind: node.kind || '供应商/客户',
          subjectId: node.subjectId || '',
          type: '股权穿透（equity_penetration）',
          typeCode: 'equity_penetration',
          hitCount: hits2.length,
          hits: hits2,
          equityChain: chain,
          depth: maxDepth,
          txnCount: st2.count,
          txnAmount: st2.amount,
          dateStart: st2.dates.length ? U.fmtDate(st2.dates[0]) : '',
          dateEnd: st2.dates.length ? U.fmtDate(st2.dates[st2.dates.length - 1]) : '',
          confidence: empLinks.length ? '较高（股权链上出现本单位关键人员）' : '中（工商特征异常，需比对工商档案确认）',
          needs: [
            '调取该主体完整工商档案（股东结构、董监高、历次股权变更）核对穿透链条',
            '核对股权变更时点是否与交易放量时点吻合',
            empLinks.length ? '就该员工持股情况做访谈与利益冲突申报核对' : '确认是否存在代持、信托持股等未披露安排'
          ]
        });
      }
    });

    /* ================= 3. 频次规模异常 frequency_scale_anomaly ================= */
    var supTotal = U.sum(Object.keys(cpStat).map(function (k) { return cpStat[k].amount; }));
    var supShareLimit = U.num(th.supplier_share_limit, 0.4);
    var custShareLimit = U.num(th.customer_share_limit, 0.3);

    /* 频次偏离：单月峰值 / 历史月均 */
    function monthStats(name) {
      var a = cpStat[name]; if (!a) return null;
      var byMonth = {};
      a.txns.forEach(function (t) { var m = String(t.date).slice(0, 7); byMonth[m] = (byMonth[m] || 0) + 1; });
      var months = Object.keys(byMonth);
      if (!months.length) return null;
      var counts = months.map(function (m) { return byMonth[m]; });
      var peak = Math.max.apply(null, counts);
      var rest = counts.filter(function (c) { return c !== peak; });
      var avg = rest.length ? U.sum(rest) / rest.length : 0;
      return { months: months.length, peak: peak, avg: avg, peakMonth: months[counts.indexOf(peak)], multiple: avg ? peak / avg : 0 };
    }

    Object.keys(cpStat).forEach(function (name) {
      var a = cpStat[name];
      if (a.count < 3) return;
      var share = supTotal ? a.amount / supTotal : 0;
      var ms = monthStats(name);
      var isKnown = customers.some(function (c) { return c.customer_name === name; }) || suppliers.some(function (s) { return s.supplier_name === name; });
      var hits3 = [], flags3 = [];
      if (share > supShareLimit) {
        hits3.push({ type: '规模集中', evidence: '该对手方交易额 ' + U.money(a.amount) + ' 占全部对手方交易额 ' + (share * 100).toFixed(1) + '%（> 阈值 ' + (supShareLimit * 100) + '%）', weight: 1 });
      }
      if (ms && ms.multiple > U.num(th.R06_freq_multiple, 3)) {
        hits3.push({ type: '频次异常', evidence: '单月最高 ' + ms.peak + ' 笔（' + ms.peakMonth + '），为其余月份均值 ' + U.round(ms.avg, 1) + ' 笔的 ' + U.round(ms.multiple, 1) + ' 倍', weight: 1 });
      }
      if (!isKnown) {
        hits3.push({ type: '非在册交易对手', evidence: '该对手方不在客户/供应商主数据中，属"三无"交易对手特征（无档案、无合同编号、无历史交易）', weight: 1 });
      }
      if (hits3.length) {
        /* 排除已在关键人员关联中已列出的主体，避免重复 */
        var dup = suspects.filter(function (s) { return s.subject === name && s.typeCode === 'key_personnel_relation'; })[0];
        if (dup) { dup.extraHits = (dup.extraHits || []).concat(hits3); dup.hitCount += hits3.length; return; }
        suspects.push({
          id: 'LK-' + (suspects.length + 1).toString().padStart(3, '0'),
          subject: name,
          subjectKind: isKnown ? '在册主数据' : '非在册',
          subjectId: '',
          type: '频次规模异常（frequency_scale_anomaly）',
          typeCode: 'frequency_scale_anomaly',
          hitCount: hits3.length,
          hits: hits3,
          share: share,
          txnCount: a.count,
          txnAmount: a.amount,
          dateStart: a.dates.length ? U.fmtDate(a.dates[0]) : '',
          dateEnd: a.dates.length ? U.fmtDate(a.dates[a.dates.length - 1]) : '',
          confidence: share > 0.6 ? '较高（集中度显著偏离）' : '中（需结合行业采购结构判断）',
          needs: [
            '比对该类采购/销售的市场价格与规模，评估是否为独立交易',
            '核对大额集中交易的招投标、比价等定价程序留痕',
            '确认该对手方是否具备承接相应业务规模的资质与能力'
          ]
        });
      }
    });

    /* ================= 4. 资金合同错配 fund_contract_mismatch ================= */
    var mismatchHits = {};
    /* 凭证索引：优先用 voucher_no 精确定位；无凭证号时不猜测，避免日期+金额巧合造成误报 */
    var entriesByVoucherNo = {};
    entries.forEach(function (e) {
      if (!e.voucher_no) return;
      (entriesByVoucherNo[e.voucher_no] = entriesByVoucherNo[e.voucher_no] || []).push(e);
    });
    txns.forEach(function (t) {
      var issues = [];
      var cp = String(t.counterparty_name || '');
      var linked = t.voucher_no ? (entriesByVoucherNo[t.voucher_no] || []) : [];
      /* 4.1 付款对象 ≠ 凭证往来单位 / 合同相对方（仅在有凭证号时判定） */
      var cpNames = U.uniq(linked.map(function (e) { return String(e.counterparty || '').trim(); }).filter(Boolean));
      var other = cpNames.filter(function (n) { return U.cleanName(n) !== U.cleanName(cp); })[0];
      if (other) {
        issues.push({
          type: '合同/凭证主体不一致',
          evidence: '银行流水对手方「' + cp + '」≠ 记账凭证往来单位「' + other + '」（凭证 ' + t.voucher_no + '），付款对象与业务相对方不一致'
        });
      }
      /* 4.2 合同相对方与付款对象不一致（流水登记了合同相对方字段时有意义） */
      if (t.contract_counterparty && U.cleanName(t.contract_counterparty) !== U.cleanName(cp)) {
        issues.push({ type: '付款对象≠合同相对方', evidence: '合同相对方「' + t.contract_counterparty + '」，实际付款对象「' + cp + '」' });
      }
      /* 4.3 收款账户与主数据登记账户不一致 */
      var master = suppliers.filter(function (s) { return s.supplier_name === cp; })[0] || customers.filter(function (c) { return c.customer_name === cp; })[0];
      if (master && master.bank_account && t.counterparty_account && String(master.bank_account).trim() !== String(t.counterparty_account).trim()) {
        var empAcc = accIndex[String(t.counterparty_account).trim()];
        issues.push({
          type: '收款账户与档案不一致',
          evidence: '主数据登记账号 ' + U.maskAccount(master.bank_account) + ' ≠ 实际收款账号 ' + U.maskAccount(t.counterparty_account) + (empAcc ? '（实际账号为员工「' + empAcc.employee_name + '」工资卡！）' : '')
        });
      }
      /* 4.4 发票流缺失：有合同号或凭证、但无发票号 */
      if ((t.contract_no || linked.length) && !t.invoice_no) {
        issues.push({
          type: '发票流缺失',
          evidence: '该笔 ' + U.money(t.amount) + ' 资金收付' + (t.contract_no ? '有合同号 ' + t.contract_no : '有记账凭证') + '但无对应发票号，资金流与发票流无法勾稽'
        });
      }
      if (issues.length) {
        var k = cp || '未署名';
        var g = mismatchHits[k] || (mismatchHits[k] = { subject: k, txnCount: 0, txnAmount: 0, issues: [], dates: [], txnIds: [] });
        g.txnCount++; g.txnAmount += U.num(t.amount); g.dates.push(U.fmtDate(t.txn_date)); g.txnIds.push(t.txn_id);
        issues.forEach(function (is) {
          if (!g.issues.some(function (x) { return x.type === is.type && x.evidence === is.evidence; })) g.issues.push(is);
        });
      }
    });
    Object.keys(mismatchHits).forEach(function (k) {
      var g = mismatchHits[k];
      suspects.push({
        id: 'LK-' + (suspects.length + 1).toString().padStart(3, '0'),
        subject: g.subject,
        subjectKind: '资金对手方',
        subjectId: '',
        type: '资金合同错配（fund_contract_mismatch）',
        typeCode: 'fund_contract_mismatch',
        hitCount: g.issues.length,
        hits: g.issues.map(function (i) { return { type: i.type, evidence: i.evidence, weight: 2 }; }),
        txnCount: g.txnCount,
        txnAmount: g.txnAmount,
        txnIds: g.txnIds,
        dateStart: g.dates.sort()[0] || '',
        dateEnd: g.dates.sort()[g.dates.length - 1] || '',
        confidence: '较高（账户/主体层面存在直接不一致）',
        needs: [
          '取得合同原件，核对合同相对方与实际收款方是否一致',
          '核实收款账户变更是否履行变更审批与书面授权',
          '核对发票开票主体与合同主体、资金主体三者是否合一'
        ]
      });
    });

    /* ================= 汇总 ================= */
    suspects.forEach(function (s, i) { s.id = 'LK-' + (i + 1).toString().padStart(3, '0'); });
    suspects.sort(function (a, b) {
      var wa = (a.typeCode === 'key_personnel_relation' ? 3 : a.typeCode === 'fund_contract_mismatch' ? 2 : 1) * 1000 + a.txnAmount / 10000;
      var wb = (b.typeCode === 'key_personnel_relation' ? 3 : b.typeCode === 'fund_contract_mismatch' ? 2 : 1) * 1000 + b.txnAmount / 10000;
      return wb - wa;
    });
    suspects.forEach(function (s, i) { s.id = 'LK-' + (i + 1).toString().padStart(3, '0'); });

    var typeStats = [
      { code: 'key_personnel_relation', name: '关键人员关联', count: 0 },
      { code: 'equity_penetration', name: '股权穿透', count: 0 },
      { code: 'frequency_scale_anomaly', name: '频次规模异常', count: 0 },
      { code: 'fund_contract_mismatch', name: '资金合同错配', count: 0 }
    ];
    suspects.forEach(function (s) { typeStats.forEach(function (t) { if (t.code === s.typeCode) t.count++; }); });

    /* 关系网络图数据 */
    var nodes = [], edges = [], nodeSeen = {};
    function addNode(id, label, kind, size) {
      if (!id || nodeSeen[id]) return;
      nodeSeen[id] = 1;
      nodes.push({ id: id, label: label, kind: kind, size: size || 1 });
    }
    addNode('本公司', '本公司', '本公司', 3);
    employees.forEach(function (e) { if (e.level === '高管' || e.level === '中层') addNode('E:' + e.employee_id, e.employee_name, '员工', 2); });
    suspects.slice(0, 25).forEach(function (s) {
      addNode('P:' + s.subject, s.subject.length > 12 ? s.subject.slice(0, 12) + '…' : s.subject, s.subjectKind, 2);
      var linkedEmp = (s.hits || []).filter(function (h) { return h.employee; })[0];
      if (linkedEmp) {
        addNode('E:' + linkedEmp.employee.employee_id, linkedEmp.employee.employee_name, '员工', 2);
        edges.push({ from: 'E:' + linkedEmp.employee.employee_id, to: 'P:' + s.subject, label: h_typeLabel(s), weight: 2 });
      } else {
        edges.push({ from: '本公司', to: 'P:' + s.subject, label: h_typeLabel(s), weight: 1 });
      }
    });
    (equity || []).forEach(function (node) {
      (node.chain || []).forEach(function (c, idx) {
        if (!c.company) return;
        addNode('C:' + c.company, c.company, '法人主体', 2);
        if (c.person && nameIndex[String(c.person).trim()]) {
          var emp = nameIndex[String(c.person).trim()];
          addNode('E:' + emp.employee_id, emp.employee_name, '员工', 2);
          edges.push({ from: 'E:' + emp.employee_id, to: 'C:' + c.company, label: '持股 ' + ((c.share || 0) * 100).toFixed(1) + '%', weight: 2 });
        }
        addNode('P:' + node.subject, node.subject.length > 12 ? node.subject.slice(0, 12) + '…' : node.subject, '供应商/客户', 2);
        edges.push({ from: 'C:' + c.company, to: 'P:' + node.subject, label: '持股 ' + ((c.share || 0) * 100).toFixed(1) + '%', weight: 1 });
      });
    });

    /* 集中度柱状图：前 12 大交易对手 */
    var topCp = Object.keys(cpStat).map(function (k) { return cpStat[k]; })
      .sort(function (a, b) { return b.amount - a.amount; }).slice(0, 12)
      .map(function (a) { return { name: a.name, amount: a.amount, share: supTotal ? a.amount / supTotal : 0, isRelated: suspects.some(function (s) { return s.subject === a.name; }) }; });

    var warnings = [];
    if (!equity || !equity.length) warnings.push('未上传工商信息（股东结构），股权穿透仅基于内置示例数据，需人工上传或采集工商档案后复核。');
    if (!employees.length) warnings.push('员工档案为空，关键人员关联无法比对。');
    if (!customers.length && !suppliers.length) warnings.push('客户/供应商档案为空，关联比对缺少主数据。');
    warnings.push('关联关系的成立需以工商档案、访谈记录等外部证据为准，本清单仅为初筛结果。');

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      suspects: suspects,
      typeStats: typeStats,
      totals: {
        suspectCount: suspects.length,
        relatedTxnAmount: U.sum(suspects, function (s) { return s.txnAmount; }),
        highConfidence: suspects.filter(function (s) { return String(s.confidence).indexOf('较高') === 0 || String(s.confidence).indexOf('高') === 0; }).length
      },
      graph: { nodes: nodes, edges: edges },
      topCounterparties: topCp,
      equity: equity,
      warnings: warnings
    };
  };

  function h_typeLabel(s) {
    return { key_personnel_relation: '关键人员', equity_penetration: '股权关联', frequency_scale_anomaly: '集中往来', fund_contract_mismatch: '资金异常' }[s.typeCode] || '关联';
  }

  function buildNeeds(s, hits) {
    var needs = [];
    if (hits.some(function (h) { return h.type === '银行账号重合'; })) {
      needs.push('核实对方收款账户与员工工资卡为同一账户的原因（是否误用、借用账户或代收款项）');
      needs.push('调取该账户开户资料与授权文件，确认账户实际控制人');
    }
    if (hits.some(function (h) { return h.type === '法定代表人同名'; })) {
      needs.push('调取该主体工商档案，核对法定代表人身份证信息与本单位员工是否为同一自然人');
      needs.push('核实该员工是否存在未申报的对外投资/任职');
    }
    if (hits.some(function (h) { return h.type === '姓名相似'; })) {
      needs.push('姓名仅为相似（编辑距离 ≤ 1），须以身份证号比对确认是否同一人，避免同名误判');
    }
    needs.push('取得完整工商信息（股东、董监高、实际控制人）做穿透核对');
    needs.push('核对该关联交易是否履行关联交易审批与披露程序');
    return U.uniq(needs);
  }

  /* 内置示例工商信息（可在设置/页面上传替换） */
  function buildDefaultEquity(customers, suppliers) {
    return [
      {
        subject: '宁波保税区鑫和贸易有限公司', kind: '客户', subjectId: 'C011',
        chain: [
          { company: '宁波保税区鑫和贸易有限公司', person: '孙鹏飞', share: 0.92, level: 1 },
          { company: '宁波鑫远投资有限公司', person: '孙鹏飞', share: 0.60, level: 2 },
          { company: '上海华信融通资产管理有限公司', person: '', share: 0.35, level: 3 }
        ],
        flags: ['成立时间距首笔交易仅 2 个月', '注册资本实缴为 0', '无社保缴纳记录']
      },
      {
        subject: '宁波宏泰管理咨询有限公司', kind: '供应商', subjectId: 'S011',
        chain: [
          { company: '宁波宏泰管理咨询有限公司', person: '孙鹏飞', share: 0.80, level: 1 },
          { company: '宁波新泰商务咨询合伙企业', person: '周慧敏', share: 0.20, level: 2 }
        ],
        flags: ['经营范围不含咨询服务', '人均产值异常'],
        nominee: true
      },
      {
        subject: '北京鼎峰资产管理有限公司', kind: '客户', subjectId: 'C005',
        chain: [
          { company: '北京鼎峰资产管理有限公司', person: '吴子豪', share: 0.55, level: 1 },
          { company: '鼎峰资本（香港）有限公司', person: '', share: 0.45, level: 2 }
        ],
        flags: ['与本单位存在资金双向往来', '股权交叉'],
        crossHolding: true
      },
      {
        subject: '珠海合众担保有限公司', kind: '供应商', subjectId: 'S012',
        chain: [
          { company: '珠海合众担保有限公司', person: '冯海军', share: 0.70, level: 1 },
          { company: '珠海合众控股有限公司', person: '冯海军', share: 0.90, level: 2 }
        ],
        flags: ['与本单位其他客户存在共同股东'],
        nominee: true
      },
      {
        subject: '南京博远咨询服务有限公司', kind: '供应商', subjectId: 'S003',
        chain: [
          { company: '南京博远咨询服务有限公司', person: '李鹃国', share: 0.95, level: 1 }
        ],
        flags: ['自然人独资', '注册地址与本单位同一楼宇']
      }
    ];
  }

  App.linkage = LK;
})(typeof window !== 'undefined' ? window : globalThis);
