/* =============================================================
 * 财务舞弊111 · 核心配置
 * 所有默认阈值、口径、权重集中在此，便于审计与人工确认。
 * 阈值口径 = statistical_outlier_threshold（3σ + IQR 双阈值）
 * ============================================================= */
(function (global) {
  'use strict';

  var FRAUD_TYPES = [
    { code: 'fake_transaction',        name: '虚构交易',     short: '虚交', desc: '无真实业务背景的交易、虚增收入与利润' },
    { code: 'fund_misappropriation',   name: '资金挪用',     short: '挪用', desc: '资金被挪用、占用、体外循环' },
    { code: 'related_party_tunneling', name: '关联方利益输送', short: '关联', desc: '通过关联方转移利益' },
    { code: 'illegal_guarantee',       name: '违规担保',     short: '担保', desc: '表外担保、抽屉协议、担保圈' },
    { code: 'insider_trading',         name: '内幕交易',     short: '内幕', desc: '利用未公开信息交易、敏感期异常' },
    { code: 'expense_fraud',           name: '费用舞弊',     short: '费用', desc: '虚假报销、费用套取、发票异常' },
    { code: 'asset_stripping',         name: '资产侵占',     short: '侵占', desc: '低价处置、资产转移、往来长期挂账' }
  ];

  /* ---- 规则引擎默认阈值（R01–R09），全部可被设置页覆盖并记忆 ---- */
  var DEFAULT_THRESHOLDS = {
    sigma: 3,                    // 3σ 倍数
    iqrK: 1.5,                   // IQR 系数
    madZ: 3.5,                   // MAD 修正 Z 阈值
    R01_large_amount: 500000,    // R01 单笔大额
    R02_round_amount: 100000,    // R02 整数（10 万整数倍且 ≥ 该值）
    R03_split_window_days: 7,    // R03 拆分窗口（日）
    R03_split_total: 200000,     // R03 窗口内累计阈值
    R03_split_single_max: 50000, // R03 单笔均低于此值
    R04_period_end_days: 5,      // R04 期末最后 N 个自然日
    R04_period_end_amount: 200000, // R04 金额门槛
    R05_personal_card: true,     // R05 个人卡收款
    R06_freq_multiple: 3,        // R06 单月笔数超过历史月均倍数
    R07_hedge_ratio: 0.10,       // R07 双向对冲金额近似容差
    R07_hedge_days: 15,          // R07 对冲观察窗口（日）
    R08_night_start: 22,         // R08 夜间起点
    R08_night_end: 6,            // R08 夜间终点
    R09_require_voucher: true,   // R09 无合同/无发票支撑
    /* 线索优先级权重（金额 40 + 规则种类 30 + 关联方 20 + 链路 10） */
    clueWeight_amount: 40,
    clueWeight_rules: 30,
    clueWeight_related: 20,
    clueWeight_chain: 10,
    /* 关联方频次规模异常 */
    supplier_share_limit: 0.40,  // 单个供应商占同类采购比例
    customer_share_limit: 0.30,  // 单一客户收入占比
    name_similarity_edit: 1      // 姓名相似度编辑距离
  };

  /* ---- 判断是否"个人卡/非工资报销用途"的关键词 ---- */
  var NON_PERSONAL_PURPOSE = ['工资', '薪资', '报销', '薪', '社保', '公积金', '个税', '奖金', '差旅', '福利', '劳务', '代扣'];
  /* ---- 工资/报销白名单用途 ---- */
  var PERSONAL_PURPOSE_OK = NON_PERSONAL_PURPOSE;

  /* ---- 七类舞弊 × 评分维度默认权重（合计 100） ---- */
  var SCORE_CARD = {
    fake_transaction: {
      name: '虚构交易', dims: [
        { key: 'no_support_ratio',  label: '无业务支撑比例', weight: 30 },
        { key: 'cp_concentration',  label: '对手方集中度',   weight: 25 },
        { key: 'four_flow_gap',     label: '四流缺口数',     weight: 25 },
        { key: 'period_end_count',  label: '期末突击笔数',   weight: 20 }
      ]
    },
    fund_misappropriation: {
      name: '资金挪用', dims: [
        { key: 'personal_card',     label: '个人卡收款',     weight: 30 },
        { key: 'refund_flow',       label: '资金回流',       weight: 30 },
        { key: 'offtime_transfer',  label: '非工作时间转账', weight: 20 },
        { key: 'approval_gap',      label: '审批缺口',       weight: 20 }
      ]
    },
    related_party_tunneling: {
      name: '关联方利益输送', dims: [
        { key: 'key_person_hit',    label: '关键人员关联命中', weight: 30 },
        { key: 'equity_depth',      label: '股权穿透层级',     weight: 25 },
        { key: 'price_deviation',   label: '价格偏离度',       weight: 25 },
        { key: 'freq_anomaly',      label: '频次异常',         weight: 20 }
      ]
    },
    illegal_guarantee: {
      name: '违规担保', dims: [
        { key: 'offbook_trace',     label: '表外承诺痕迹',   weight: 30 },
        { key: 'margin_flow',       label: '保证金往来异常', weight: 25 },
        { key: 'guarantee_circle',  label: '担保圈识别',     weight: 25 },
        { key: 'disclosure_gap',    label: '报表披露缺口',   weight: 20 }
      ]
    },
    insider_trading: {
      name: '内幕交易', dims: [
        { key: 'sensitive_window',  label: '敏感期交易',   weight: 30 },
        { key: 'insider_account',   label: '知情人账户',   weight: 30 },
        { key: 'account_focus',     label: '账户集中度',   weight: 20 },
        { key: 'timing_anomaly',    label: '时点异常',     weight: 20 }
      ]
    },
    expense_fraud: {
      name: '费用舞弊', dims: [
        { key: 'expense_ratio',     label: '费用率异常',   weight: 30 },
        { key: 'claim_focus',       label: '报销集中度',   weight: 20 },
        { key: 'invoice_seq',       label: '发票连号',     weight: 25 },
        { key: 'cross_period',      label: '跨期列支',     weight: 25 }
      ]
    },
    asset_stripping: {
      name: '资产侵占', dims: [
        { key: 'impair_anomaly',    label: '资产减值异常',   weight: 30 },
        { key: 'disposal_deviation',label: '处置价格偏离',   weight: 25 },
        { key: 'inventory_loss',    label: '盘亏频次',       weight: 25 },
        { key: 'aged_receivable',   label: '往来长期挂账',   weight: 20 }
      ]
    }
  };

  /* ---- 参考区间：助理只给参考区间，定级由人工作出 ---- */
  var SCORE_BANDS = [
    { min: 0,  max: 29,  level: 'low',  label: '信号较弱', text: '信号较弱，建议常规关注（需人工复核后定级）',                          advice: '维持常规监控，无需专项核查（需人工复核后定级）' },
    { min: 30, max: 59,  level: 'mid',  label: '信号中等', text: '信号中等，建议纳入核查范围（需人工复核后定级）',                      advice: '纳入本次核查范围，按线索台账顺序安排（需人工复核后定级）' },
    { min: 60, max: 79,  level: 'high', label: '信号较强', text: '信号较强，建议优先人工复核（需人工复核后定级）',                      advice: '列为优先核查项，安排人员先行核对原始凭证（需人工复核后定级）' },
    { min: 80, max: 100, level: 'crit', label: '信号集中', text: '信号集中，建议立即人工复核并评估是否启动正式调查（需人工复核后定级）', advice: '建议立即人工复核，由岗位人员评估是否启动正式调查（需人工复核后定级）' }
  ];

  /* ---- 后端业务数据库十张表（表名 → 中文名/主键/关键字段） ---- */
  var TABLES = {
    customers:           { cn: '客户档案',   pk: 'customer_id',  keys: ['customer_name', 'legal_person', 'contact', 'bank_account'] },
    subjects:            { cn: '会计科目',   pk: 'subject_code', keys: ['subject_name', 'parent_code', 'level', 'direction'] },
    suppliers:           { cn: '供应商档案', pk: 'supplier_id',  keys: ['supplier_name', 'legal_person', 'contact', 'bank_account'] },
    departments:         { cn: '部门档案',   pk: 'dept_id',      keys: ['dept_name', 'manager'] },
    employees:           { cn: '员工档案',   pk: 'employee_id',  keys: ['employee_name', 'id_card', 'salary_card', 'dept_id', 'position'] },
    bank_accounts:       { cn: '银行账户',   pk: 'account_id',   keys: ['account_no', 'account_name', 'bank_name', 'account_type'] },
    gl_ledger:           { cn: '总账余额',   pk: 'ledger_id',    keys: ['period', 'subject_code', 'opening_balance', 'debit_amount', 'credit_amount', 'closing_balance'] },
    gl_vouchers:         { cn: '记账凭证',   pk: 'voucher_id',   keys: ['voucher_no', 'voucher_date', 'prepared_by', 'approved_by', 'status'] },
    gl_voucher_entries:  { cn: '凭证分录',   pk: 'entry_id',     keys: ['voucher_id', 'subject_code', 'debit', 'credit', 'summary', 'counterparty'] },
    bank_transactions:   { cn: '银行流水',   pk: 'txn_id',       keys: ['txn_date', 'txn_time', 'account_id', 'counterparty_name', 'amount', 'direction', 'purpose', 'matched', 'voucher_no'] }
  };

  /* ---- 强制声明（不可编辑、不可删除） ---- */
  var MANDATORY_DISCLAIMER =
    '本报告由 AI 助理基于现有数据自动生成，为辅助分析材料，不替代调查结论。' +
    '报告中的风险等级、可能性评估、线索优先级均为参考值，须由调查人员复核确认。' +
    '本报告不构成对任何单位或个人的舞弊认定。';

  var DIVISION_BAR = '本页输出为辅助材料，最终判断由调查人员作出';

  var FORBIDDEN_PATTERNS = [
    /构成舞弊/,
    /存在舞弊行为/,
    /建议立案/,
    /建议处理[某该]\S{0,6}/,
    /(此人|该人|该员工|该负责人)(存在|涉嫌|确有)\S{0,8}(舞弊|犯罪|违法)/,
    /认定为舞弊/,
    /确定(为|系)舞弊/
  ];

  var App = global.App = global.App || {};
  App.config = {
    VERSION: '1.0.0',
    APP_NAME: '财务舞弊111',
    FRAUD_TYPES: FRAUD_TYPES,
    DEFAULT_THRESHOLDS: DEFAULT_THRESHOLDS,
    SCORE_CARD: SCORE_CARD,
    SCORE_BANDS: SCORE_BANDS,
    TABLE_ORDER: ['bank_transactions', 'gl_voucher_entries', 'gl_vouchers', 'gl_ledger', 'subjects', 'employees', 'departments', 'customers', 'suppliers', 'bank_accounts'],
    TABLES: TABLES,
    MANDATORY_DISCLAIMER: MANDATORY_DISCLAIMER,
    DIVISION_BAR: DIVISION_BAR,
    FORBIDDEN_PATTERNS: FORBIDDEN_PATTERNS,
    NON_PERSONAL_PURPOSE: NON_PERSONAL_PURPOSE,
    PERSONAL_PURPOSE_OK: PERSONAL_PURPOSE_OK
  };
})(typeof window !== 'undefined' ? window : globalThis);
