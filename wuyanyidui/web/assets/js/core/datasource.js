/* =============================================================
 * 财务舞弊111 · 数据接入（data_read / file_upload / 数据库 / 预置快照）
 * 统一为 { data: {10张表}, meta } 结构，供所有分析模块复用。
 * 前端 SheetJS 解析 Excel/CSV；无网络时降级为内置 CSV 解析器。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;
  var DS = {};

  var TABLE_ALIAS = {
    bank_transactions: ['bank_transactions', '银行流水', '流水', 'txn', 'transaction'],
    gl_voucher_entries: ['gl_voucher_entries', '凭证分录', '分录', 'entries'],
    gl_vouchers: ['gl_vouchers', '记账凭证', '凭证', 'vouchers'],
    gl_ledger: ['gl_ledger', '总账', '总账余额', 'ledger'],
    subjects: ['subjects', '会计科目', '科目'],
    customers: ['customers', '客户', '客户档案'],
    suppliers: ['suppliers', '供应商', '供应商档案'],
    employees: ['employees', '员工', '员工档案'],
    departments: ['departments', '部门'],
    bank_accounts: ['bank_accounts', '银行账户', '账户']
  };

  /* 字段同义词（用于宽松识别上传表格的列名） */
  var FIELD_ALIAS = {
    txn_date: ['txn_date', '交易日期', '日期', '记账日期', '交易时间日期', 'date'],
    txn_time: ['txn_time', '交易时间', '时间', '记账时间', 'time'],
    account_id: ['account_id', '账户id', '账户', '银行账户'],
    account_no: ['account_no', '账号', '银行账号', '本方账号'],
    counterparty_name: ['counterparty_name', '对手方', '对方户名', '对方名称', '交易对手', '收款人', '付款人', '对方账户名称'],
    counterparty_account: ['counterparty_account', '对方账号', '对手方账号'],
    counterparty_is_person: ['counterparty_is_person', '是否个人', '个人标志'],
    amount: ['amount', '金额', '发生额', '交易金额', '金额（元）', '交易金额（元）'],
    direction: ['direction', '方向', '收付', '收付标志', '收付方向', '借贷标志', '收支', '收支标志', '交易方向', '进出标志'],
    purpose: ['purpose', '用途', '摘要', '交易用途', '款项用途'],
    matched: ['matched', '已对账', '对账标志', '匹配标志'],
    voucher_no: ['voucher_no', '凭证号', '凭证编号'],
    invoice_no: ['invoice_no', '发票号', '发票编号'],
    contract_no: ['contract_no', '合同号', '合同编号'],
    period: ['period', '期间', '会计期间', '月份'],
    subject_code: ['subject_code', '科目编码', '科目代码', '科目号'],
    subject_name: ['subject_name', '科目名称', '科目'],
    opening_balance: ['opening_balance', '期初余额', '期初'],
    debit_amount: ['debit_amount', '借方发生额', '借方', '本期借方'],
    credit_amount: ['credit_amount', '贷方发生额', '贷方', '本期贷方'],
    closing_balance: ['closing_balance', '期末余额', '期末'],
    debit: ['debit', '借方金额', '借方发生'],
    credit: ['credit', '贷方金额', '贷方发生'],
    summary: ['summary', '摘要', '说明'],
    counterparty: ['counterparty', '对手方', '往来单位'],
    employee_name: ['employee_name', '员工姓名', '姓名', '报销人'],
    employee_id: ['employee_id', '员工编号', '工号'],
    id_card: ['id_card', '身份证号', '身份证'],
    salary_card: ['salary_card', '工资卡', '工资卡号', '银行卡号'],
    customer_name: ['customer_name', '客户名称', '客户名'],
    supplier_name: ['supplier_name', '供应商名称', '供应商名'],
    legal_person: ['legal_person', '法人', '法定代表人', '法人代表'],
    contact: ['contact', '联系人'],
    bank_account: ['bank_account', '银行账号', '账号', '开户账号'],
    voucher_id: ['voucher_id', '凭证id'],
    voucher_date: ['voucher_date', '凭证日期'],
    dept_id: ['dept_id', '部门编号', '部门id'],
    dept_name: ['dept_name', '部门名称'],
    account_name: ['account_name', '户名', '账户名称'],
    account_type: ['account_type', '账户类型'],
    bank_name: ['bank_name', '开户行', '银行名称']
  };

  /* ---------- 内置 CSV 解析器（无网络降级方案） ---------- */
  DS.parseCSV = function (text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    var rows = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
        } else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else if (c === '\r') { /* skip */ }
        else cur += c;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      if (rows[r].length === 1 && !rows[r][0]) continue;
      var o = {};
      headers.forEach(function (h, ci) { o[h] = rows[r][ci] !== undefined ? rows[r][ci] : ''; });
      out.push(o);
    }
    return out;
  };

  /* ---------- 字段宽松映射 ---------- */
  function mapFields(rows) {
    if (!rows.length) return { rows: [], mapping: {}, unmapped: [] };
    var headers = Object.keys(rows[0]);
    var mapping = {}, unmapped = [];
    headers.forEach(function (h) {
      var key = String(h).trim();
      var target = null;
      var low = key.toLowerCase();
      Object.keys(FIELD_ALIAS).forEach(function (std) {
        if (target) return;
        var list = FIELD_ALIAS[std];
        for (var i = 0; i < list.length; i++) {
          if (list[i] === key || list[i].toLowerCase() === low) { target = std; break; }
        }
      });
      if (target) mapping[key] = target;
      else unmapped.push(key);
    });
    var out = rows.map(function (r) {
      var o = {};
      Object.keys(r).forEach(function (k) {
        var t = mapping[k] || k;
        o[t] = r[k];
      });
      return o;
    });
    return { rows: out, mapping: mapping, unmapped: unmapped };
  }

  /* ---------- 规范化各表 ---------- */
  function normalizeTable(name, rows) {
    return rows.map(function (r) {
      var o = Object.assign({}, r);
      if (name === 'bank_transactions') {
        o.txn_date = U.fmtDate(o.txn_date);
        o.amount = U.num(o.amount);
        if (o.direction !== undefined) {
          var d = String(o.direction);
          o.direction = /收|借|入|c/i.test(d) ? '收' : '付';
        }
        o.matched = o.matched === undefined || o.matched === '' ? 1 : U.num(o.matched);
        o.counterparty_is_person = U.num(o.counterparty_is_person);
        /* 金额若为负，转化为方向 */
        if (o.amount < 0) { o.amount = Math.abs(o.amount); }
      } else if (name === 'gl_voucher_entries') {
        o.debit = U.num(o.debit); o.credit = U.num(o.credit);
        o.voucher_date = U.fmtDate(o.voucher_date);
      } else if (name === 'gl_ledger') {
        ['opening_balance', 'debit_amount', 'credit_amount', 'closing_balance', 'level'].forEach(function (k) { o[k] = U.num(o[k]); });
      } else if (name === 'gl_vouchers') {
        o.voucher_date = U.fmtDate(o.voucher_date);
      }
      return o;
    });
  }

  /* ---------- 从工作簿对象（SheetJS 或手工构造）载入 ---------- */
  DS.fromSheets = function (sheets, opt) {
    opt = opt || {};
    var data = {}, mappingReport = [], autoAsBank = false;
    var names = Object.keys(sheets);
    /* 单表文件：自动判表 */
    names.forEach(function (sn) {
      var rows = sheets[sn];
      var target = null;
      var low = String(sn).trim().toLowerCase();
      Object.keys(TABLE_ALIAS).forEach(function (t) {
        if (target) return;
        if (TABLE_ALIAS[t].some(function (a) { return String(a).toLowerCase() === low; })) target = t;
      });
      if (!target && names.length === 1) {
        /* 依据列名猜测：有对手方+金额 → 流水；有科目+借贷 → 分录 */
        var hs = rows.length ? Object.keys(rows[0]).join(',').toLowerCase() : '';
        if (/对手方|对方户名|交易对手|收款人|付款人/.test(hs) && /金额|发生额/.test(hs)) { target = 'bank_transactions'; autoAsBank = true; }
        else if (/科目/.test(hs) && /(借方|贷方)/.test(hs)) target = 'gl_voucher_entries';
        else if (/供应商/.test(hs)) target = 'suppliers';
        else if (/客户/.test(hs)) target = 'customers';
        else if (/身份证|工资卡/.test(hs)) target = 'employees';
      }
      if (!target) return;
      var mapped = mapFields(rows);
      data[target] = normalizeTable(target, mapped.rows);
      mappingReport.push({ sheet: sn, table: target, rows: data[target].length, mappedFields: Object.keys(mapped.mapping).length, unmapped: mapped.unmapped });
    });
    if (!Object.keys(data).length) {
      return { ok: false, error: '未能识别表格结构：请确保表名或列名包含"银行流水/凭证分录/科目/客户/供应商"等标识，或使用内置模板。' };
    }
    var meta = {
      source: opt.source || 'upload',
      label: opt.label || '上传文件',
      periodStart: '', periodEnd: '',
      currency: 'CNY',
      generatedAt: new Date().toISOString(),
      mapping: mappingReport,
      note: autoAsBank ? '单表上传已按列名自动识别为银行流水表。' : ''
    };
    var dates = (data.bank_transactions || []).map(function (t) { return t.txn_date; }).filter(Boolean).sort();
    if (dates.length) { meta.periodStart = dates[0]; meta.periodEnd = dates[dates.length - 1]; }
    return { ok: true, data: data, meta: meta };
  };

  DS.fromCSVTexts = function (files) {
    /* files: [{name, text}] */
    var sheets = {}, report = [];
    files.forEach(function (f) {
      var base = String(f.name || 'table').replace(/\.(csv|txt)$/i, '');
      var rows = DS.parseCSV(f.text);
      if (rows.length) { sheets[base] = rows; report.push(base + '（' + rows.length + ' 行）'); }
    });
    var r = DS.fromSheets(sheets, { source: 'upload', label: 'CSV 上传（' + report.join('、') + '）' });
    return r;
  };

  /* ---------- 合并多源数据（上传优先，缺失表用预置补齐） ---------- */
  DS.merge = function (base, override) {
    var data = {};
    var TABLES = App.config.TABLE_ORDER;
    TABLES.forEach(function (t) {
      if (override && override.data && override.data[t] && override.data[t].length) data[t] = override.data[t];
      else if (base && base.data && base.data[t]) data[t] = base.data[t];
      else data[t] = [];
    });
    var meta = Object.assign({}, (base && base.meta) || {}, (override && override.meta) || {});
    meta.mergedAt = new Date().toISOString();
    return { ok: true, data: data, meta: meta };
  };

  /* ---------- 从后端数据库读取 ---------- */
  DS.fromServer = function (opts) {
    var cfg = App.api ? App.api.serverConfig() : {};
    if (!cfg.base) return Promise.reject(new Error('未检测到本地代理服务：请双击 start.bat 启动后再使用数据库接入。'));
    var q = new URLSearchParams();
    q.set('tables', App.config.TABLE_ORDER.join(','));
    return fetch(cfg.base + '/api/db/tables?' + q.toString())
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || '数据库读取失败');
        var data = {};
        App.config.TABLE_ORDER.forEach(function (t) { data[t] = (j.data && j.data[t]) || []; });
        var hasData = Object.keys(data).some(function (k) { return data[k].length; });
        if (!hasData) throw new Error('数据库连接成功但未读取到记录，请检查表结构与数据。');
        return { ok: true, data: data, meta: { source: 'mysql', label: '后端 MySQL（' + (j.database || '') + '）', generatedAt: new Date().toISOString(), tables: j.counts || {} } };
      });
  };

  /* ---------- 导出 CSV（按列导出） ---------- */
  DS.toCSV = function (rows, columns, headers) {
    if (!rows || !rows.length) return '\uFEFF';
    var cols = columns || Object.keys(rows[0]);
    var head = headers || cols;
    var esc = function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var out = ['\uFEFF' + head.map(esc).join(',')];
    rows.forEach(function (r) {
      out.push(cols.map(function (c) { return esc(typeof c === 'function' ? c(r) : r[c]); }).join(','));
    });
    return out.join('\r\n');
  };

  DS.download = function (filename, content, mime) {
    try {
      var blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return true;
    } catch (e) { return false; }
  };

  App.dataSource = DS;
})(typeof window !== 'undefined' ? window : globalThis);
