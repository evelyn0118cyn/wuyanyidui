/* =============================================================
 * 财务舞弊111 · 预置演示数据（合成数据，非真实企业数据）
 * 内置 10 张业务表，并刻意植入"风险信号"用于演示与回归测试：
 *   虚构交易 / 资金挪用 / 关联方利益输送 / 违规担保 / 内幕交易 / 费用舞弊 / 资产侵占
 * 生成过程完全确定性（固定随机种子），保证每次打开结果可复现。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  /* ---------- 确定性伪随机 ---------- */
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function int(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pad(n, w) { var s = String(n); while (s.length < (w || 2)) s = '0' + s; return s; }

  /**
   * @param {object} opt { start:'2025-01-01', end:'2025-12-31', scale:1 }
   */
  function build(opt) {
    opt = opt || {};
    var START = opt.start || '2025-01-01';
    var END = opt.end || '2025-12-31';
    var rng = makeRng(20251029);
    var d0 = U.parseDate(START), d1 = U.parseDate(END);

    /* 会计期间（月末） */
    var periods = [];
    (function () {
      var y = d0.getFullYear(), m = d0.getMonth() + 1;
      while (new Date(y, m - 1, 1) <= d1) {
        periods.push({ year: y, month: m, key: y + '-' + pad(m), last: new Date(y, m, 0) });
        m++; if (m > 12) { m = 1; y++; }
      }
    })();

    /* ================= 1. 部门 ================= */
    var departments = [
      { dept_id: 'D01', dept_name: '财务部', manager: '周慧敏', parent_dept: '' },
      { dept_id: 'D02', dept_name: '采购部', manager: '李建国', parent_dept: '' },
      { dept_id: 'D03', dept_name: '销售部', manager: '王振华', parent_dept: '' },
      { dept_id: 'D04', dept_name: '投资部', manager: '孙鹏飞', parent_dept: '' },
      { dept_id: 'D05', dept_name: '行政部', manager: '陈丽娜', parent_dept: '' },
      { dept_id: 'D06', dept_name: '资管部', manager: '吴子豪', parent_dept: '' },
      { dept_id: 'D07', dept_name: '风控合规部', manager: '郑雅琴', parent_dept: '' },
      { dept_id: 'D08', dept_name: '信息技术部', manager: '刘志远', parent_dept: '' }
    ];

    /* ================= 2. 员工（含关键人员，为关联方穿透埋点） ================= */
    /* id_card / salary_card 与客户/供应商档案中的法人、账号形成"关键人员关联" */
    var employees = [
      { employee_id: 'E001', employee_name: '孙鹏飞', id_card: '310101198503124417', salary_card: '6222021001008811221', dept_id: 'D04', position: '投资总监', hire_date: '2019-03-11', level: '高管' },
      { employee_id: 'E002', employee_name: '周慧敏', id_card: '310101198711092236', salary_card: '6222021001008822331', dept_id: 'D01', position: '财务总监', hire_date: '2018-06-01', level: '高管' },
      { employee_id: 'E003', employee_name: '李建国', id_card: '320102197912258813', salary_card: '6222021001008833442', dept_id: 'D02', position: '采购部经理', hire_date: '2017-09-15', level: '中层' },
      { employee_id: 'E004', employee_name: '王振华', id_card: '330106198202173316', salary_card: '6222021001008844553', dept_id: 'D03', position: '销售总监', hire_date: '2016-02-20', level: '高管' },
      { employee_id: 'E005', employee_name: '陈丽娜', id_card: '310104199008307726', salary_card: '6222021001008855664', dept_id: 'D05', position: '行政经理', hire_date: '2020-04-07', level: '中层' },
      { employee_id: 'E006', employee_name: '吴子豪', id_card: '440304198906112215', salary_card: '6222021001008866775', dept_id: 'D06', position: '资管部主管', hire_date: '2019-11-25', level: '中层' },
      { employee_id: 'E007', employee_name: '郑雅琴', id_card: '310110198609154423', salary_card: '6222021001008877886', dept_id: 'D07', position: '合规主管', hire_date: '2018-01-08', level: '中层' },
      { employee_id: 'E008', employee_name: '刘志远', id_card: '410105199201223318', salary_card: '6222021001008888997', dept_id: 'D08', position: 'IT 经理', hire_date: '2021-07-19', level: '中层' },
      { employee_id: 'E009', employee_name: '张明辉', id_card: '310115199403056631', salary_card: '6222021001008899008', dept_id: 'D01', position: '会计', hire_date: '2022-03-01', level: '员工' },
      { employee_id: 'E010', employee_name: '赵晓峰', id_card: '510107199507219912', salary_card: '6222021001008810119', dept_id: 'D01', position: '出纳', hire_date: '2022-08-15', level: '员工' },
      { employee_id: 'E011', employee_name: '钱永强', id_card: '320506198405172212', salary_card: '6222021001008811220', dept_id: 'D02', position: '采购专员', hire_date: '2020-10-12', level: '员工' },
      { employee_id: 'E012', employee_name: '许静雯', id_card: '350203199610084426', salary_card: '6222021001008812331', dept_id: 'D03', position: '销售经理', hire_date: '2021-05-06', level: '员工' },
      /* 故意植入：姓名与供应商法人"李鹃国"编辑距离 1 */
      { employee_id: 'E013', employee_name: '李鹃国', id_card: '320102197912258813', salary_card: '6222021001008813442', dept_id: 'D02', position: '采购主管', hire_date: '2020-02-10', level: '员工' },
      { employee_id: 'E014', employee_name: '冯海军', id_card: '610113198307091115', salary_card: '6222021001008814553', dept_id: 'D06', position: '投资经理', hire_date: '2021-09-01', level: '员工' },
      { employee_id: 'E015', employee_name: '韩雪', id_card: '310101199808063327', salary_card: '6222021001008815664', dept_id: 'D07', position: '风控专员', hire_date: '2023-02-13', level: '员工' },
      { employee_id: 'E016', employee_name: '曹敏', id_card: '440106199102224418', salary_card: '6222021001008816775', dept_id: 'D05', position: '行政专员', hire_date: '2022-11-28', level: '员工' },
      { employee_id: 'E017', employee_name: '邓伟', id_card: '510104198812034419', salary_card: '6222021001008817886', dept_id: 'D03', position: '客户经理', hire_date: '2020-06-22', level: '员工' },
      { employee_id: 'E018', employee_name: '罗静', id_card: '330104199312178823', salary_card: '6222021001008818997', dept_id: 'D01', position: '税务会计', hire_date: '2021-12-06', level: '员工' },
      { employee_id: 'E019', employee_name: '彭勇', id_card: '420106198704162213', salary_card: '6222021001008819008', dept_id: 'D02', position: '采购主管', hire_date: '2019-08-19', level: '员工' },
      { employee_id: 'E020', employee_name: '潘丽华', id_card: '350102199505073318', salary_card: '6222021001008820119', dept_id: 'D08', position: '运维工程师', hire_date: '2022-05-30', level: '员工' }
    ];

    /* ================= 3. 客户 ================= */
    var customers = [
      { customer_id: 'C001', customer_name: '上海鸿远贸易有限公司', legal_person: '何志强', contact: '何志强', bank_account: '6228481001001234567', credit_level: 'A', establish_date: '2015-04-10' },
      { customer_id: 'C002', customer_name: '江苏中成建材股份有限公司', legal_person: '徐国平', contact: '徐盈盈', bank_account: '6228481001001234568', credit_level: 'A', establish_date: '2012-07-19' },
      { customer_id: 'C003', customer_name: '深圳前海智联科技有限公司', legal_person: '马文涛', contact: '马文涛', bank_account: '6228481001001234569', credit_level: 'B', establish_date: '2018-03-05' },
      { customer_id: 'C004', customer_name: '浙江恒信供应链管理有限公司', legal_person: '陈建华', contact: '陈丽', bank_account: '6228481001001234570', credit_level: 'B', establish_date: '2016-11-23' },
      { customer_id: 'C005', customer_name: '北京鼎峰资产管理有限公司', legal_person: '吴子豪', contact: '吴子豪', bank_account: '6222021001008866775', credit_level: 'C', establish_date: '2019-09-12' },
      { customer_id: 'C006', customer_name: '广州瑞和实业有限公司', legal_person: '梁永生', contact: '梁晓萍', bank_account: '6228481001001234572', credit_level: 'B', establish_date: '2014-01-20' },
      { customer_id: 'C007', customer_name: '四川天府物流有限责任公司', legal_person: '罗天成', contact: '罗天成', bank_account: '6228481001001234573', credit_level: 'B', establish_date: '2013-06-18' },
      { customer_id: 'C008', customer_name: '山东鲁信机械制造有限公司', legal_person: '王德海', contact: '王慧', bank_account: '6228481001001234574', credit_level: 'A', establish_date: '2011-10-09' },
      { customer_id: 'C009', customer_name: '苏州云锦纺织有限公司', legal_person: '沈志明', contact: '沈佳', bank_account: '6228481001001234575', credit_level: 'B', establish_date: '2017-05-16' },
      { customer_id: 'C010', customer_name: '天津滨海物产有限公司', legal_person: '崔浩然', contact: '崔浩然', bank_account: '6228481001001234576', credit_level: 'C', establish_date: '2020-12-01' },
      /* 植入：法人姓名与员工"孙鹏飞"关联的壳公司，交易集中度高 */
      { customer_id: 'C011', customer_name: '宁波保税区鑫和贸易有限公司', legal_person: '孙鹏飞', contact: '孙鹏飞', bank_account: '6222021001008811221', credit_level: 'C', establish_date: '2024-08-15' }
    ];

    /* ================= 4. 供应商 ================= */
    var suppliers = [
      { supplier_id: 'S001', supplier_name: '上海远航信息技术有限公司', legal_person: '赵大勇', contact: '吴敏', bank_account: '6228482001002234567', category: '技术服务', credit_level: 'A' },
      { supplier_id: 'S002', supplier_name: '杭州星辰软件有限公司', legal_person: '钱文斌', contact: '钱文斌', bank_account: '6228482001002234568', category: '软件', credit_level: 'A' },
      { supplier_id: 'S003', supplier_name: '南京博远咨询服务有限公司', legal_person: '李鹃国', contact: '李鹃国', bank_account: '6222021001008813442', category: '咨询服务', credit_level: 'B' },
      { supplier_id: 'S004', supplier_name: '广东华南物流有限公司', legal_person: '黄志刚', contact: '黄秋燕', bank_account: '6228482001002234570', category: '物流', credit_level: 'A' },
      { supplier_id: 'S005', supplier_name: '北京金诚广告有限公司', legal_person: '孙鹏飞', contact: '刘丹', bank_account: '6228482001002234571', category: '广告宣传', credit_level: 'C' },
      { supplier_id: 'S006', supplier_name: '苏州精工设备有限公司', legal_person: '丁国庆', contact: '丁小月', bank_account: '6228482001002234572', category: '设备', credit_level: 'A' },
      { supplier_id: 'S007', supplier_name: '无锡宏达建筑装饰有限公司', legal_person: '顾长海', contact: '顾小峰', bank_account: '6228482001002234573', category: '工程', credit_level: 'B' },
      { supplier_id: 'S008', supplier_name: '厦门天成金融服务有限公司', legal_person: '林国栋', contact: '林小玲', bank_account: '6228482001002234574', category: '金融中介', credit_level: 'B' },
      { supplier_id: 'S009', supplier_name: '成都锦江办公用品有限公司', legal_person: '杜建华', contact: '杜娜', bank_account: '6228482001002234575', category: '办公用品', credit_level: 'B' },
      { supplier_id: 'S010', supplier_name: '青岛海纳人力资源有限公司', legal_person: '于明', contact: '于丽', bank_account: '6228482001002234576', category: '人力资源', credit_level: 'B' },
      /* 植入：空壳咨询供应商，采购集中度高、无实际服务、大额整数 */
      { supplier_id: 'S011', supplier_name: '宁波宏泰管理咨询有限公司', legal_person: '孙鹏飞', contact: '陈默', bank_account: '6228482001002234577', category: '咨询服务', credit_level: 'C' },
      { supplier_id: 'S012', supplier_name: '珠海合众担保有限公司', legal_person: '冯海军', contact: '冯海军', bank_account: '6222021001008814553', category: '金融中介', credit_level: 'C' }
    ];

    /* ================= 5. 银行账户 ================= */
    var bank_accounts = [
      { account_id: 'A001', account_no: '31050101001012345678', account_name: '华信融通投资控股有限公司', bank_name: '中国工商银行上海分行', account_type: '基本户', currency: 'CNY', open_date: '2014-05-06' },
      { account_id: 'A002', account_no: '31050101001012345679', account_name: '华信融通投资控股有限公司', bank_name: '中国建设银行上海分行', account_type: '一般户', currency: 'CNY', open_date: '2016-03-22' },
      { account_id: 'A003', account_no: '31050101001012345680', account_name: '华信融通投资控股有限公司', bank_name: '招商银行上海分行', account_type: '专项户', currency: 'CNY', open_date: '2019-08-14' },
      { account_id: 'A004', account_no: '31050101001012345681', account_name: '华信融通投资控股有限公司', bank_name: '中国银行上海分行', account_type: '外币户', currency: 'USD', open_date: '2015-11-30' },
      { account_id: 'A005', account_no: '31050101001012345682', account_name: '华信融通投资控股有限公司', bank_name: '交通银行上海分行', account_type: '一般户', currency: 'CNY', open_date: '2021-01-11' }
    ];

    /* ================= 6. 会计科目树 ================= */
    var subjectSrc = [
      ['1001', '库存现金', '', 1, '借'], ['1002', '银行存款', '', 1, '借'],
      ['100201', '银行存款-基本户', '1002', 2, '借'], ['100202', '银行存款-一般户', '1002', 2, '借'], ['100203', '银行存款-其他', '1002', 2, '借'],
      ['1122', '应收账款', '', 1, '借'], ['112201', '应收账款-货款', '1122', 2, '借'], ['112202', '应收账款-服务费', '1122', 2, '借'],
      ['1123', '预付账款', '', 1, '借'], ['112301', '预付账款-供应商', '1123', 2, '借'],
      ['1221', '其他应收款', '', 1, '借'], ['122101', '其他应收款-备用金', '1221', 2, '借'], ['122102', '其他应收款-往来款', '1221', 2, '借'],
      ['1405', '库存商品', '', 1, '借'],
      ['1601', '固定资产', '', 1, '借'], ['1602', '累计折旧', '', 1, '贷'], ['1606', '固定资产清理', '', 1, '借'],
      ['1701', '无形资产', '', 1, '借'],
      ['2202', '应付账款', '', 1, '贷'], ['220201', '应付账款-货款', '2202', 2, '贷'], ['220202', '应付账款-服务费', '2202', 2, '贷'],
      ['2211', '应付职工薪酬', '', 1, '贷'],
      ['2221', '应交税费', '', 1, '贷'],
      ['2241', '其他应付款', '', 1, '贷'], ['224101', '其他应付款-保证金', '2241', 2, '贷'], ['224102', '其他应付款-往来款', '2241', 2, '贷'],
      ['2501', '长期借款', '', 1, '贷'],
      ['4001', '实收资本', '', 1, '贷'], ['4104', '利润分配', '', 1, '贷'],
      ['6001', '主营业务收入', '', 1, '贷'], ['600101', '主营业务收入-产品销售', '6001', 2, '贷'], ['600102', '主营业务收入-服务收入', '6001', 2, '贷'],
      ['6051', '其他业务收入', '', 1, '贷'],
      ['6401', '主营业务成本', '', 1, '借'], ['640101', '主营业务成本-商品', '6401', 2, '借'],
      ['6601', '销售费用', '', 1, '借'], ['660101', '销售费用-广告费', '6601', 2, '借'], ['660102', '销售费用-差旅费', '6601', 2, '借'], ['660103', '销售费用-业务招待费', '6601', 2, '借'],
      ['6602', '管理费用', '', 1, '借'], ['660201', '管理费用-咨询费', '6602', 2, '借'], ['660202', '管理费用-办公费', '6602', 2, '借'], ['660203', '管理费用-薪酬', '6602', 2, '借'], ['660204', '管理费用-折旧费', '6602', 2, '借'],
      ['6603', '财务费用', '', 1, '借'], ['660301', '财务费用-利息支出', '6603', 2, '借'], ['660302', '财务费用-手续费', '6603', 2, '借'],
      ['6604', '研发费用', '', 1, '借'],
      ['6701', '资产减值损失', '', 1, '借'], ['6702', '营业外支出', '', 1, '借'], ['6301', '营业外收入', '', 1, '贷'],
      ['6111', '投资收益', '', 1, '贷']
    ];
    var subjects = subjectSrc.map(function (r) {
      return { subject_code: r[0], subject_name: r[1], parent_code: r[2], level: r[3], direction: r[4], is_leaf: true };
    });
    var parentCodes = {};
    subjects.forEach(function (s) { if (s.parent_code) parentCodes[s.parent_code] = 1; });
    subjects.forEach(function (s) { if (parentCodes[s.subject_code]) s.is_leaf = false; });

    /* ================= 7. 凭证 + 分录 ================= */
    var vouchers = [], entries = [];
    var vSeq = 0, eSeq = 0;
    var approvers = ['周慧敏', '孙鹏飞', '郑雅琴'];

    function dayInPeriod(p, rng) {
      var dom = int(rng, 1, p.last.getDate());
      return new Date(p.year, p.month - 1, dom);
    }
    /* 正常业务只落在工作日，避免非工作日规则 R08 被正常交易刷屏 */
    function bizDay(p, rng) {
      var d = dayInPeriod(p, rng), guard = 0;
      while ((d.getDay() === 0 || d.getDay() === 6) && guard++ < 20) d = dayInPeriod(p, rng);
      return d;
    }
    function vdate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

    /**
     * 添加凭证及分录。lines: [{code, debit, credit, summary, counterparty}]
     */
    function addVoucher(p, date, lines, tag, opts) {
      opts = opts || {};
      vSeq++;
      var vno = 'PZ' + p.key.replace('-', '') + '-' + pad(vSeq % 10000, 4);
      var vid = 'V' + pad(vSeq, 6);
      var hour = opts.hour !== undefined ? opts.hour : int(rng, 9, 17);
      var preparer = opts.preparer || pick(rng, ['张明辉', '赵晓峰', '罗静']);
      vouchers.push({
        voucher_id: vid,
        voucher_no: vno,
        voucher_date: vdate(date),
        period: p.key,
        prepared_by: preparer,
        approved_by: opts.approved_by !== undefined ? opts.approved_by : pick(rng, approvers),
        status: opts.status || '已审核',
        create_time: vdate(date) + ' ' + pad(hour) + ':' + pad(int(rng, 0, 59)) + ':' + pad(int(rng, 0, 59)),
        summary: lines[0] ? lines[0].summary : '',
        tag: tag || ''
      });
      var debitSum = 0, creditSum = 0;
      lines.forEach(function (l) {
        eSeq++;
        debitSum += U.num(l.debit); creditSum += U.num(l.credit);
        entries.push({
          entry_id: 'VE' + pad(eSeq, 7),
          voucher_id: vid,
          voucher_no: vno,
          voucher_date: vdate(date),
          period: p.key,
          subject_code: l.code,
          subject_name: (subjectMap[l.code] || {}).subject_name || l.code,
          debit: U.round(U.num(l.debit), 2),
          credit: U.round(U.num(l.credit), 2),
          summary: l.summary || '',
          counterparty: l.counterparty || '',
          dept_id: l.dept || '',
          employee_name: l.employee || ''
        });
      });
      return { vid: vid, vno: vno, debit: debitSum, credit: creditSum };
    }
    var subjectMap = {};
    subjects.forEach(function (s) { subjectMap[s.subject_code] = s; });

    /* ---- 7.1 常规经营业务（每月） ---- */
    periods.forEach(function (p) {
      var monthScale = 1 + (p.month % 3 === 0 ? 0.15 : 0); // 季末略高
      /* 销售收入（正常，存在商业实质） */
      var salesCount = int(rng, 18, 26);
      for (var i = 0; i < salesCount; i++) {
        var amt = U.round(int(rng, 4, 40) * 10000 + rng() * 9999, 2);
        var cust = pick(rng, customers.slice(0, 10));
        var d = bizDay(p, rng);
        addVoucher(p, d, [
          { code: '112201', debit: amt, credit: 0, summary: '销售商品-' + cust.customer_name, counterparty: cust.customer_name },
          { code: '600101', debit: 0, credit: U.round(amt / 1.13, 2), summary: '销售商品-' + cust.customer_name, counterparty: cust.customer_name },
          { code: '2221', debit: 0, credit: U.round(amt - amt / 1.13, 2), summary: '销项税额', counterparty: cust.customer_name }
        ], 'normal_sale');
      }
      /* 收款 */
      var recvCount = int(rng, 14, 20);
      for (var r = 0; r < recvCount; r++) {
        var ramt = U.round(int(rng, 3, 35) * 10000 + rng() * 9999, 2);
        var rcust = pick(rng, customers.slice(0, 8));
        addVoucher(p, bizDay(p, rng), [
          { code: '100201', debit: ramt, credit: 0, summary: '收到货款-' + rcust.customer_name, counterparty: rcust.customer_name },
          { code: '112201', debit: 0, credit: ramt, summary: '收到货款-' + rcust.customer_name, counterparty: rcust.customer_name }
        ], 'normal_receipt');
      }
      /* 采购与付款 */
      var purCount = int(rng, 14, 20);
      for (var s = 0; s < purCount; s++) {
        var samt = U.round(int(rng, 2, 30) * 10000 + rng() * 9999, 2);
        var sup = pick(rng, suppliers.slice(0, 10));
        addVoucher(p, bizDay(p, rng), [
          { code: '640101', debit: U.round(samt / 1.13, 2), credit: 0, summary: '采购-' + sup.supplier_name, counterparty: sup.supplier_name },
          { code: '2221', debit: U.round(samt - samt / 1.13, 2), credit: 0, summary: '进项税额', counterparty: sup.supplier_name },
          { code: '220201', debit: 0, credit: samt, summary: '采购-' + sup.supplier_name, counterparty: sup.supplier_name }
        ], 'normal_purchase');
        addVoucher(p, bizDay(p, rng), [
          { code: '220201', debit: samt, credit: 0, summary: '支付货款-' + sup.supplier_name, counterparty: sup.supplier_name },
          { code: '100201', debit: 0, credit: samt, summary: '支付货款-' + sup.supplier_name, counterparty: sup.supplier_name }
        ], 'normal_payment');
      }
      /* 薪酬 */
      var payroll = U.round(1800000 * monthScale, 2);
      addVoucher(p, p.last, [
        { code: '660203', debit: payroll, credit: 0, summary: '计提本月职工薪酬' },
        { code: '2211', debit: 0, credit: payroll, summary: '计提本月职工薪酬' }
      ], 'normal_payroll', { hour: 16 });
      /* 费用（差旅/招待/办公） */
      var expCount = int(rng, 6, 10);
      for (var e2 = 0; e2 < expCount; e2++) {
        var eamt = U.round(int(rng, 3, 25) * 1000 + rng() * 999, 2);
        var subj = pick(rng, ['660102', '660103', '660202']);
        var emp = pick(rng, employees);
        addVoucher(p, bizDay(p, rng), [
          { code: subj, debit: eamt, credit: 0, summary: '费用报销-' + emp.employee_name, employee: emp.employee_name, dept: emp.dept_id },
          { code: '1001', debit: 0, credit: eamt, summary: '现金支付', employee: emp.employee_name, dept: emp.dept_id }
        ], 'normal_expense');
      }
      /* 折旧与利息 */
      addVoucher(p, p.last, [
        { code: '660204', debit: 520000, credit: 0, summary: '计提折旧' },
        { code: '1602', debit: 0, credit: 520000, summary: '计提折旧' }
      ], 'normal_depreciation');
      addVoucher(p, p.last, [
        { code: '660301', debit: 380000, credit: 0, summary: '计提借款利息' },
        { code: '2501', debit: 0, credit: 380000, summary: '计提借款利息' }
      ], 'normal_interest');
    });

    /* ---- 7.2 植入信号：虚构交易（无业务支撑、期末突击、大额整数） ---- */
    var planted = { fake: [], misap: [], related: [], guarantee: [], insider: [], expense: [], strip: [] };
    [0, 4, 7, 11].forEach(function (pi) {
      var p = periods[pi]; if (!p) return;
      var sup = suppliers[10]; // 宁波宏泰管理咨询
      var amt = 1000000; // 10万整数倍 + 大额
      /* 期末最后 3 天 */
      var d = new Date(p.year, p.month - 1, p.last.getDate() - int(rng, 0, 2));
      var v = addVoucher(p, d, [
        { code: '660201', debit: amt, credit: 0, summary: '咨询服务费-' + sup.supplier_name, counterparty: sup.supplier_name },
        { code: '100202', debit: 0, credit: amt, summary: '支付咨询服务费-' + sup.supplier_name, counterparty: sup.supplier_name }
      ], 'planted_fake_transaction', { hour: 21, approved_by: '周慧敏' });
      planted.fake.push({ voucher_no: v.vno, date: vdate(d), amount: amt, counterparty: sup.supplier_name });
    });
    /* 虚增收入：期末大额挂账 */
    [2, 5, 8, 11].forEach(function (pi) {
      var p = periods[pi]; if (!p) return;
      var cust = customers[10]; // 宁波鑫和贸易（孙鹏飞）
      var amt = 8000000;
      var d = new Date(p.year, p.month - 1, p.last.getDate() - 1);
      var v = addVoucher(p, d, [
        { code: '112202', debit: amt, credit: 0, summary: '服务收入-' + cust.customer_name, counterparty: cust.customer_name },
        { code: '600102', debit: 0, credit: U.round(amt / 1.06, 2), summary: '服务收入-' + cust.customer_name, counterparty: cust.customer_name },
        { code: '2221', debit: 0, credit: U.round(amt - amt / 1.06, 2), summary: '销项税额', counterparty: cust.customer_name }
      ], 'planted_fake_transaction', { hour: 22, approved_by: '周慧敏' });
      planted.fake.push({ voucher_no: v.vno, date: vdate(d), amount: amt, counterparty: cust.customer_name });
    });

    /* ---- 7.3 植入信号：关联方利益输送（关键人员关联 + 集中度 + 价格偏离） ---- */
    periods.forEach(function (p, pi) {
      var sup = suppliers[2]; // 南京博远咨询（法人李鹃国 ≈ 员工李鹃国 同身份证）
      var amt = U.round(int(rng, 30, 45) * 10000, 2);
      var d = new Date(p.year, p.month - 1, int(rng, 5, 20));
      var v = addVoucher(p, d, [
        { code: '660201', debit: amt, credit: 0, summary: '咨询服务费-' + sup.supplier_name, counterparty: sup.supplier_name },
        { code: '100202', debit: 0, credit: amt, summary: '支付咨询服务费-' + sup.supplier_name, counterparty: sup.supplier_name }
      ], 'planted_related_party', { approved_by: '孙鹏飞' });
      planted.related.push({ voucher_no: v.vno, date: vdate(d), amount: amt, counterparty: sup.supplier_name });
      /* 广告费给孙鹏飞法人的供应商 */
      var sup5 = suppliers[4];
      var amt5 = U.round(int(rng, 20, 30) * 10000, 2);
      var d5 = new Date(p.year, p.month - 1, int(rng, 3, 25));
      addVoucher(p, d5, [
        { code: '660101', debit: amt5, credit: 0, summary: '广告费-' + sup5.supplier_name, counterparty: sup5.supplier_name },
        { code: '100202', debit: 0, credit: amt5, summary: '支付广告费-' + sup5.supplier_name, counterparty: sup5.supplier_name }
      ], 'planted_related_party', { approved_by: '孙鹏飞' });
      /* 销售给关联客户（集中度高） */
      if (pi % 2 === 0) {
        var cust = customers[4]; // 北京鼎峰（法人吴子豪）
        var ca = U.round(int(rng, 50, 80) * 10000, 2);
        var cd = new Date(p.year, p.month - 1, int(rng, 8, 26));
        addVoucher(p, cd, [
          { code: '112201', debit: ca, credit: 0, summary: '销售-' + cust.customer_name, counterparty: cust.customer_name },
          { code: '600101', debit: 0, credit: U.round(ca / 1.13, 2), summary: '销售-' + cust.customer_name, counterparty: cust.customer_name },
          { code: '2221', debit: 0, credit: U.round(ca - ca / 1.13, 2), summary: '销项税额', counterparty: cust.customer_name }
        ], 'planted_related_party', { approved_by: '王振华' });
      }
    });

    /* ---- 7.4 植入信号：违规担保 / 表外承诺 / 保证金往来 ---- */
    periods.forEach(function (p, pi) {
      if (pi % 2 !== 0) return;
      var sup = suppliers[11]; // 珠海合众担保
      var amt = 300000;
      var d = new Date(p.year, p.month - 1, int(rng, 10, 25));
      addVoucher(p, d, [
        { code: '122102', debit: amt, credit: 0, summary: '担保保证金-' + sup.supplier_name, counterparty: sup.supplier_name },
        { code: '100203', debit: 0, credit: amt, summary: '支付担保保证金-' + sup.supplier_name, counterparty: sup.supplier_name }
      ], 'planted_guarantee', { approved_by: '孙鹏飞' });
      planted.guarantee.push({ date: vdate(d), amount: amt, counterparty: sup.supplier_name });
    });
    /* 表外承诺痕迹：其他应付款往来款 */
    [3, 6, 9, 11].forEach(function (pi) {
      var p = periods[pi]; if (!p) return;
      var amt = 5000000;
      var d = new Date(p.year, p.month - 1, int(rng, 12, 27));
      addVoucher(p, d, [
        { code: '122102', debit: amt, credit: 0, summary: '代偿担保款往来', counterparty: '珠海合众担保有限公司' },
        { code: '224102', debit: 0, credit: amt, summary: '代偿担保款往来', counterparty: '珠海合众担保有限公司' }
      ], 'planted_guarantee', { approved_by: '孙鹏飞' });
      planted.guarantee.push({ date: vdate(d), amount: amt, counterparty: '珠海合众担保有限公司' });
    });

    /* ---- 7.5 植入信号：资金挪用（个人卡、现金、非工作时间、无审批） ---- */
    periods.forEach(function (p, pi) {
      /* 转个人卡 */
      var emp = employees[0];
      var amt = U.round(int(rng, 45, 95) * 10000 + rng() * 999, 2);
      var d = new Date(p.year, p.month - 1, int(rng, 2, 28));
      addVoucher(p, d, [
        { code: '122102', debit: amt, credit: 0, summary: '往来款-备用金借款', employee: emp.employee_name, counterparty: emp.employee_name },
        { code: '100201', debit: 0, credit: amt, summary: '支付往来款-' + emp.employee_name, employee: emp.employee_name, counterparty: emp.employee_name }
      ], 'planted_misappropriation', { hour: 23, approved_by: '' });
      planted.misap.push({ date: vdate(d), amount: amt, counterparty: emp.employee_name });
      /* 深夜现金支取 */
      if (pi % 3 === 0) {
        var c2 = U.round(int(rng, 8, 22) * 10000, 2);
        var d2 = new Date(p.year, p.month - 1, int(rng, 1, 28));
        addVoucher(p, d2, [
          { code: '122101', debit: c2, credit: 0, summary: '备用金-现金', employee: employees[9].employee_name, counterparty: employees[9].employee_name },
          { code: '1001', debit: 0, credit: c2, summary: '提现备用金', employee: employees[9].employee_name, counterparty: employees[9].employee_name }
        ], 'planted_misappropriation', { hour: 2, approved_by: '' });
        planted.misap.push({ date: vdate(d2), amount: c2, counterparty: employees[9].employee_name });
      }
    });

    /* ---- 7.6 植入信号：费用舞弊（报销集中、整数、连号发票、跨期） ---- */
    periods.forEach(function (p, pi) {
      if (pi < 2) return;
      var emp = employees[4]; // 陈丽娜
      for (var k = 0; k < Math.min(6, Math.max(1, pi - 1)); k++) {
        var amt = 50000; // 整数
        var d = new Date(p.year, p.month - 1, int(rng, 1, 5)); // 上月初报销上月费用 → 跨期
        addVoucher(p, d, [
          { code: '660103', debit: amt, credit: 0, summary: '业务招待费报销', employee: emp.employee_name, dept: emp.dept_id, counterparty: emp.employee_name },
          { code: '1001', debit: 0, credit: amt, summary: '现金支付招待费', employee: emp.employee_name, dept: emp.dept_id, counterparty: emp.employee_name }
        ], 'planted_expense_fraud', { hour: 20, approved_by: emp.employee_name });
        planted.expense.push({ date: vdate(d), amount: amt, employee: emp.employee_name });
      }
      /* 连号发票：同一供应商同日多张近似金额 */
      if (pi % 2 === 0) {
        var sup = suppliers[8]; // 成都锦江办公
        for (var j = 0; j < 4; j++) {
          var a2 = U.round(98000 + j * 120, 2);
          var d3 = new Date(p.year, p.month - 1, 15);
          addVoucher(p, d3, [
            { code: '660202', debit: a2, credit: 0, summary: '办公用品采购（发票号0471' + (20 + j) + '）', counterparty: sup.supplier_name },
            { code: '100201', debit: 0, credit: a2, summary: '支付办公用品款', counterparty: sup.supplier_name }
          ], 'planted_expense_fraud', { hour: 19 });
          planted.expense.push({ date: vdate(d3), amount: a2, supplier: sup.supplier_name });
        }
      }
    });

    /* ---- 7.7 植入信号：资产侵占（低价处置、减值异常、往来长期挂账） ---- */
    [4, 9].forEach(function (pi) {
      var p = periods[pi]; if (!p) return;
      var amt = 3500000, book = 12000000;
      var d = new Date(p.year, p.month - 1, int(rng, 15, 25));
      addVoucher(p, d, [
        { code: '1606', debit: book, credit: 0, summary: '固定资产转入清理', counterparty: '上海鸿远贸易有限公司' },
        { code: '1601', debit: 0, credit: book, summary: '固定资产转出', counterparty: '上海鸿远贸易有限公司' }
      ], 'planted_asset_stripping', { approved_by: '孙鹏飞' });
      addVoucher(p, d, [
        { code: '100201', debit: amt, credit: 0, summary: '处置固定资产收款-' + '上海鸿远贸易有限公司', counterparty: '上海鸿远贸易有限公司' },
        { code: '1606', debit: 0, credit: amt, summary: '处置固定资产收款' , counterparty: '上海鸿远贸易有限公司' }
      ], 'planted_asset_stripping', { hour: 23, approved_by: '孙鹏飞' });
      addVoucher(p, d, [
        { code: '6702', debit: book - amt, credit: 0, summary: '处置固定资产净损失' },
        { code: '1606', debit: 0, credit: book - amt, summary: '结转处置净损失' }
      ], 'planted_asset_stripping', { approved_by: '孙鹏飞' });
      planted.strip.push({ date: vdate(d), amount: amt, book: book, counterparty: '上海鸿远贸易有限公司' });
    });
    [6, 11].forEach(function (pi) {
      var p = periods[pi]; if (!p) return;
      var amt = 6800000;
      var d = new Date(p.year, p.month - 1, int(rng, 20, 28));
      addVoucher(p, d, [
        { code: '6701', debit: amt, credit: 0, summary: '计提商誉减值准备', counterparty: '宁波鑫和贸易有限公司' },
        { code: '1701', debit: 0, credit: amt, summary: '计提无形资产减值' }
      ], 'planted_asset_stripping', { approved_by: '周慧敏' });
      planted.strip.push({ date: vdate(d), amount: amt, counterparty: '宁波鑫和贸易有限公司' });
    });
    /* 往来长期挂账 */
    var longD = new Date(periods[0].year, periods[0].month - 1, 8);
    addVoucher(periods[0], longD, [
      { code: '122102', debit: 2400000, credit: 0, summary: '关联方往来款-长期未结', counterparty: '宁波保税区鑫和贸易有限公司' },
      { code: '100201', debit: 0, credit: 2400000, summary: '往来款支付', counterparty: '宁波保税区鑫和贸易有限公司' }
    ], 'planted_asset_stripping', { approved_by: '孙鹏飞' });
    planted.strip.push({ date: vdate(longD), amount: 2400000, counterparty: '宁波保税区鑫和贸易有限公司' });

    /* ---- 7.8 植入信号：内幕交易 / 敏感期时点异常（以投资类收付体现） ---- */
    periods.forEach(function (p, pi) {
      var amt = U.round(int(rng, 120, 260) * 10000, 2);
      var d = new Date(p.year, p.month - 1, p.last.getDate() - int(rng, 0, 2)); // 期末敏感期
      addVoucher(p, d, [
        { code: '6111', debit: amt, credit: 0, summary: '投资收益-资管产品申赎', counterparty: '北京鼎峰资产管理有限公司' },
        { code: '100201', debit: 0, credit: amt, summary: '投资款回收', counterparty: '北京鼎峰资产管理有限公司' }
      ], 'planted_insider_trading', { hour: 22, approved_by: '孙鹏飞' });
      planted.insider.push({ date: vdate(d), amount: amt, counterparty: '北京鼎峰资产管理有限公司' });
    });

    /* ================= 8. 总账余额（由分录汇总推导，保证勾稽） ================= */
    var gl_ledger = [];
    var lSeq = 0;
    var leafCodes = subjects.filter(function (s) { return s.is_leaf; }).map(function (s) { return s.subject_code; });
    var balance = {};
    leafCodes.forEach(function (c) { balance[c] = 0; });
    /* 期初余额 */
    var openingSeed = {
      '1001': 260000, '100201': 12500000, '100202': 8600000, '100203': 3200000,
      '112201': 18000000, '112202': 6200000, '112301': 2400000, '122101': 800000, '122102': 1500000,
      '1405': 9600000, '1601': 42000000, '1606': 0, '1701': 21000000,
      '220201': 11500000, '220202': 4300000, '2211': 1900000, '2221': 2600000,
      '224101': 1200000, '224102': 900000, '2501': 25000000,
      '4001': 50000000, '4104': 8600000,
      '1602': 12400000
    };
    /* 贷方类科目期初为正数余额（贷方） */
    var creditSide = {};
    subjects.forEach(function (s) { if (s.direction === '贷') creditSide[s.subject_code] = 1; });
    leafCodes.forEach(function (c) { balance[c] = U.num(openingSeed[c], 0); });

    periods.forEach(function (p) {
      var monthDebit = {}, monthCredit = {};
      leafCodes.forEach(function (c) { monthDebit[c] = 0; monthCredit[c] = 0; });
      entries.filter(function (e) { return e.period === p.key; }).forEach(function (e) {
        monthDebit[e.subject_code] = U.round((monthDebit[e.subject_code] || 0) + U.num(e.debit), 2);
        monthCredit[e.subject_code] = U.round((monthCredit[e.subject_code] || 0) + U.num(e.credit), 2);
      });
      leafCodes.forEach(function (c) {
        var open = U.round(balance[c], 2);
        var dr = monthDebit[c] || 0, cr = monthCredit[c] || 0;
        var close = creditSide[c] ? U.round(open - dr + cr, 2) : U.round(open + dr - cr, 2);
        lSeq++;
        gl_ledger.push({
          ledger_id: 'L' + pad(lSeq, 6),
          period: p.key,
          subject_code: c,
          subject_name: subjectMap[c].subject_name,
          level: subjectMap[c].level,
          direction: subjectMap[c].direction,
          opening_balance: open,
          debit_amount: dr,
          credit_amount: cr,
          closing_balance: close,
          currency: 'CNY'
        });
        balance[c] = close;
      });
    });

    /* ================= 9. 银行流水 ================= */
    var bank_transactions = [];
    var tSeq = 0;
    /* 商业实质对照：交易对手 → 是否有凭证支撑（matched） */
    function addTxn(o) {
      tSeq++;
      bank_transactions.push({
        txn_id: 'T' + pad(tSeq, 6),
        txn_date: o.date,
        txn_time: o.time,
        account_id: o.account_id,
        account_no: (bank_accounts.filter(function (a) { return a.account_id === o.account_id; })[0] || {}).account_no || '',
        counterparty_name: o.cp,
        counterparty_account: o.cpAcc || '',
        counterparty_is_person: o.person ? 1 : 0,
        amount: U.round(U.num(o.amount), 2),
        direction: o.dir, // 收 / 付
        balance_after: 0,
        purpose: o.purpose || '',
        matched: o.matched === undefined ? 1 : o.matched,
        voucher_no: o.vno || '',
        invoice_no: o.invoice || '',
        contract_no: o.contract || '',
        source: o.source || 'operating'
      });
    }
    var seqByDate = {};
    function rtime(rng, hourOverride) {
      var h = hourOverride !== undefined ? hourOverride : int(rng, 9, 17);
      return pad(h) + ':' + pad(int(rng, 0, 59)) + ':' + pad(int(rng, 0, 59));
    }
    /* 9.1 由正常凭证生成流水（有业务支撑） */
    var normalEntries = entries.filter(function (e) {
      return ['normal_sale', 'normal_receipt', 'normal_payment', 'normal_purchase'].indexOf(
        (vouchers.filter(function (v) { return v.voucher_id === e.voucher_id; })[0] || {}).tag) >= 0;
    });
    /* 简化：按凭证 tag 生成流水 */
    vouchers.forEach(function (v) {
      var lines = entries.filter(function (e) { return e.voucher_id === v.voucher_id; });
      var bankLine = lines.filter(function (l) { return /^1002/.test(l.subject_code); })[0];
      if (!bankLine) return;
      var amt = U.num(bankLine.debit) || U.num(bankLine.credit);
      if (!amt) return;
      var dir = U.num(bankLine.debit) > 0 ? '收' : '付';
      var cp = bankLine.counterparty || v.summary.replace(/^[^\-]*-/, '');
      var isPerson = false;
      var cpEmp = employees.filter(function (e) { return e.employee_name === cp; })[0];
      if (cpEmp) isPerson = true;
      var custRow = customers.filter(function (c) { return c.customer_name === cp; })[0];
      var supRow = suppliers.filter(function (s) { return s.supplier_name === cp; })[0];
      if (custRow && /^[\u4e00-\u9fa5]{2,3}$/.test(custRow.customer_name)) isPerson = true;
      var hour = U.hourOf(v.create_time);
      var purpose = v.tag === 'normal_sale' || v.tag === 'normal_receipt' ? '货款收款'
        : v.tag === 'normal_payment' ? '货款支付'
        : /咨询/.test(v.summary) ? '咨询服务费'
        : /广告/.test(v.summary) ? '广告费'
        : /担保/.test(v.summary) ? '担保保证金'
        : /投资/.test(v.summary) ? '投资款'
        : /处置/.test(v.summary) ? '资产处置款'
        : /往来/.test(v.summary) ? '往来款'
        : /服务收入/.test(v.summary) ? '服务收入回款'
        : '款项收付';
      addTxn({
        date: v.voucher_date, time: rtime(rng, hour),
        account_id: /^100201/.test(bankLine.subject_code) ? 'A001' : /^100202/.test(bankLine.subject_code) ? 'A002' : 'A003',
        cp: cp, cpAcc: (custRow && custRow.bank_account) || (supRow && supRow.bank_account) || (cpEmp && cpEmp.salary_card) || '',
        person: isPerson, amount: amt, dir: dir, purpose: purpose,
        matched: 1, vno: v.voucher_no,
        source: v.tag.indexOf('planted') === 0 ? v.tag : 'operating',
        contract: 'HT-' + v.period.replace('-', '') + '-' + pad(int(rng, 1, 60), 3),
        invoice: 'FP' + int(rng, 10000000, 99999999)
      });
    });
    /* 9.2 植入：本人账户互转 / 双向对冲 / 拆分 */
    periods.forEach(function (p, pi) {
      /* 双向对冲：与同一对手方短期收付近似相等（改用非头部对手方，避免与正常货款重复计入） */
      if (pi % 3 === 0) {
        var cp = customers[7]; // 山东鲁信机械制造
        var base = U.round(int(rng, 60, 95) * 10000, 2);
        var d1 = new Date(p.year, p.month - 1, 6), d2 = new Date(p.year, p.month - 1, 12);
        addTxn({ date: vdate(d1), time: rtime(rng), account_id: 'A003', cp: cp.customer_name, cpAcc: cp.bank_account, amount: base, dir: '付', purpose: '货款支付', matched: 1, vno: 'PZ' + p.key.replace('-', '') + '-0999', source: 'planted_hedge' });
        addTxn({ date: vdate(d2), time: rtime(rng), account_id: 'A003', cp: cp.customer_name, cpAcc: cp.bank_account, amount: U.round(base * (1 + (rng() * 0.04 - 0.02)), 2), dir: '收', purpose: '货款退回', matched: 1, vno: 'PZ' + p.key.replace('-', '') + '-0998', source: 'planted_hedge' });
      }
      /* 拆分支付：同一供应商 7 日内 5 笔 < 5 万 */
      if (pi % 2 === 0) {
        var sup = suppliers[10];
        var dd = new Date(p.year, p.month - 1, 18);
        for (var k = 0; k < 5; k++) {
          var d = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate() + k);
          addTxn({ date: vdate(d), time: rtime(rng, 20), account_id: 'A002', cp: sup.supplier_name, cpAcc: sup.bank_account, amount: 48000, dir: '付', purpose: '咨询服务费', matched: 1, vno: 'PZ' + p.key.replace('-', '') + '-09' + pad(80 + k), source: 'planted_split' });
        }
      }
      /* 无业务支撑的整数大额付款（虚构交易）：整年固定金额、期末、夜间、无凭证、对方为自然人 */
      if (periods.length >= 4 && pi % 3 === 2) {
        var d3 = new Date(p.year, p.month - 1, p.last.getDate() - 1);
        addTxn({ date: vdate(d3), time: '23:41:07', account_id: 'A002', cp: '周成林', cpAcc: '6228489001006677889', person: true, amount: 1000000, dir: '付', purpose: '咨询费', matched: 0, vno: '', source: 'planted_fake' });
        planted.fake.push({ date: vdate(d3), amount: 1000000, counterparty: '周成林', note: '无凭证支撑' });
      }
      /* 个人卡收款：销售回款打进个人卡 */
      if (pi % 3 === 1) {
        var emp = employees[11];
        var d4 = new Date(p.year, p.month - 1, int(rng, 8, 24));
        addTxn({ date: vdate(d4), time: rtime(rng, 21), account_id: 'A001', cp: emp.employee_name, cpAcc: emp.salary_card, person: true, amount: U.round(int(rng, 60, 120) * 10000, 2), dir: '收', purpose: '销售回款', matched: 1, source: 'planted_personal_card' });
      }
      /* 收款账户与档案不一致：付给登记之外的第三方账号（资金合同错配） */
      if (pi % 4 === 0) {
        var supX = suppliers[5]; // 苏州精工设备
        var amtX = U.round(int(rng, 18, 32) * 10000, 2);
        var dX = bizDay(p, rng);
        var vX = addVoucher(p, dX, [
          { code: '1405', debit: amtX, credit: 0, summary: '设备采购-' + supX.supplier_name, counterparty: supX.supplier_name },
          { code: '100201', debit: 0, credit: amtX, summary: '支付设备款', counterparty: supX.supplier_name }
        ], 'planted_mismatch', {});
        addTxn({
          date: vdate(dX), time: rtime(rng), account_id: 'A001', cp: supX.supplier_name,
          cpAcc: '6228489901007788991', /* 与档案登记的 6228482001002234572 不一致 */
          amount: amtX, dir: '付', purpose: '设备款', matched: 1, vno: vX.vno,
          source: 'planted_mismatch', contract_no: 'HT-QZ-' + p.key.replace('-', '') + '-01', invoice_no: ''
        });
        planted.related.push({ voucher_no: vX.vno, date: vdate(dX), amount: amtX, counterparty: supX.supplier_name, note: '收款账户与档案不一致' });
      }
    });
    /* 9.3 频次异常：某对手方单月笔数暴增（同日多笔，避免形成重复记录） */
    (function () {
      var p = periods[Math.min(9, periods.length - 1)];
      if (!p) return;
      var sup = suppliers[3];
      for (var i = 0; i < 26; i++) {
        var dom = 1 + (i % 20);
        var d = new Date(p.year, p.month - 1, dom);
        addTxn({
          date: vdate(d), time: pad(9 + Math.floor(i / 6)) + ':' + pad((i * 7) % 60) + ':' + pad((i * 13) % 60),
          account_id: 'A001', cp: sup.supplier_name, cpAcc: sup.bank_account,
          amount: U.round(1000 + i * 217.35, 2), dir: '付', purpose: '运费', matched: 1, source: 'planted_freq'
        });
      }
    })();
    /* 9.4 计算余额（按账户按时间累积） */
    (function () {
      var initBal = { A001: 12500000, A002: 8600000, A003: 3200000, A004: 500000, A005: 1200000 };
      var byAcc = U.groupBy(bank_transactions, function (t) { return t.account_id; });
      Object.keys(byAcc).forEach(function (acc) {
        var list = byAcc[acc].slice().sort(function (a, b) {
          var ka = a.txn_date + ' ' + a.txn_time, kb = b.txn_date + ' ' + b.txn_time;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
        var bal = U.num(initBal[acc], 0);
        list.forEach(function (t) {
          bal += (t.direction === '收' ? 1 : -1) * U.num(t.amount);
          t.balance_after = U.round(bal, 2);
        });
      });
    })();
    /* 排序流水 */
    bank_transactions.sort(function (a, b) {
      var ka = a.txn_date + ' ' + a.txn_time, kb = b.txn_date + ' ' + b.txn_time;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    /* ================= 10. 借贷不平衡凭证（数据质量问题，便于演示校验） ================= */
    (function () {
      var p = periods[2];
      if (!p) return;
      var v = addVoucher(p, new Date(p.year, p.month - 1, 17), [
        { code: '660202', debit: 36800, credit: 0, summary: '办公费（导入数据借贷不平示例）', counterparty: '成都锦江办公用品有限公司' },
        { code: '100201', debit: 0, credit: 36500, summary: '办公费付款', counterparty: '成都锦江办公用品有限公司' }
      ], 'data_quality', {});
      /* 人为制造单边不平：只补贷方分录，形成借方 36,800 ≠ 贷方 36,800 以外的差额 */
      eSeq++;
      entries.push({
        entry_id: 'VE' + pad(eSeq, 7), voucher_id: v.vid, voucher_no: v.vno, voucher_date: v.voucher_date,
        period: p.key, subject_code: '660202', subject_name: '管理费用-办公费', debit: 600, credit: 0,
        summary: '办公费补记（单边分录示例）', counterparty: '', dept_id: '', employee_name: ''
      });
    })();

    var data = {
      customers: customers,
      suppliers: suppliers,
      employees: employees,
      departments: departments,
      bank_accounts: bank_accounts,
      subjects: subjects,
      gl_ledger: gl_ledger,
      gl_vouchers: vouchers,
      gl_voucher_entries: entries,
      bank_transactions: bank_transactions
    };

    var meta = {
      source: 'preset',
      label: '预置演示数据（合成）',
      periodStart: START,
      periodEnd: END,
      periods: periods.map(function (p) { return p.key; }),
      currency: 'CNY',
      generatedAt: new Date().toISOString(),
      company: '华信融通投资控股有限公司',
      note: '本数据集为合成演示数据，所有企业、个人名称与账号均为虚构，用于展示风险信号识别能力。',
      planted: {
        fake_transaction: planted.fake.length,
        fund_misappropriation: planted.misap.length,
        related_party_tunneling: planted.related.length,
        illegal_guarantee: planted.guarantee.length,
        insider_trading: planted.insider.length,
        expense_fraud: planted.expense.length,
        asset_stripping: planted.strip.length
      }
    };

    return { data: data, meta: meta };
  }

  App.demoData = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
