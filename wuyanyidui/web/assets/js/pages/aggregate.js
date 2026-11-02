/* =============================================================
 * 页面：数据汇总（F4 数据自动汇总与采集 + 数据接入）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.aggregate = {
    render: function (mount) {
      var S = App.state;
      var mem = App.memory.load();
      var h = [];
      h.push(UI.divisionBar('助理辅助：汇总 / 校验 / 出质量报告　｜　人工决策：口径确认、数据是否可用'));

      /* ---------- 数据源接入 ---------- */
      h.push('<div class="card"><div class="card-head"><div class="card-title">数据源接入<span class="sub">选择一种方式接入 10 张业务表</span></div></div>');
      h.push('<div class="source-grid">');
      h.push('<div class="source-card" data-src="preset"><div class="sc-title">🗂 预置演示数据</div>' +
        '<div class="sc-desc">内置合成的 10 张业务表（2025 全年，约 1,150 张凭证 / 558 笔流水），含刻意植入的各类风险信号，开箱即用。</div>' +
        '<div class="sc-state">' + (S.dataset && S.dataset.meta && S.dataset.meta.source === 'preset' ? '✓ 当前正在使用' : '点击加载') + '</div></div>');
      h.push('<div class="source-card" data-src="upload"><div class="sc-title">📄 上传 Excel / CSV</div>' +
        '<div class="sc-desc">支持 .xlsx / .xls / .csv。表名或列名包含"银行流水 / 凭证分录 / 科目 / 客户 / 供应商 / 员工"等标识即可自动识别。</div>' +
        '<div class="sc-state">' + (S.dataset && S.dataset.meta && S.dataset.meta.source === 'upload' ? '✓ 当前正在使用' : '点击上传') + '</div></div>');
      h.push('<div class="source-card" data-src="mysql"><div class="sc-title">🗄 连接数据库</div>' +
        '<div class="sc-desc">通过本地代理读取后端 MySQL 的 10 张业务表（需 start.bat 已启动并配置 .env）。</div>' +
        '<div class="sc-state">' + (S.dataset && S.dataset.meta && S.dataset.meta.source === 'mysql' ? '✓ 当前正在使用' : '点击检测') + '</div></div>');
      h.push('</div>');

      /* 上传区 */
      h.push('<div id="uploadZone" class="hidden mt14">' +
        '<div class="dropzone" id="dz"><div class="dz-ico">⬆</div>' +
        '<div class="dz-title">点击选择，或把 Excel/CSV 拖到这里</div>' +
        '<div class="dz-desc">可同时选择多个文件（如 bank_transactions.xlsx + gl_voucher_entries.xlsx）。<br>' +
        '未上传的表会自动用预置演示数据补齐，便于先看效果。</div></div>' +
        '<input type="file" id="fileInput" multiple accept=".xlsx,.xls,.csv,.txt" class="hidden">' +
        '<div class="file-list" id="fileList"></div>' +
        '<div class="flex-gap mt8"><button class="btn btn-sm" id="btnTemplate">下载数据模板说明</button>' +
        '<span class="small muted">解析在浏览器本地完成，文件不会上传到任何服务器。</span></div>' +
        '</div>');

      /* MySQL 区 */
      h.push('<div id="mysqlZone" class="hidden mt14"><div id="mysqlOut"></div></div>');
      h.push('</div>');

      /* ---------- 数据源概况 ---------- */
      if (S.dataset) {
        var d = S.dataset.data, m = S.dataset.meta || {};
        var totalRows = App.config.TABLE_ORDER.reduce(function (a, t) { return a + ((d[t] || []).length); }, 0);
        h.push('<div class="card"><div class="card-head"><div class="card-title">数据源概况<span class="sub">' + UI.esc(m.label || m.source || '') + '</span></div>' +
          '<div class="card-actions"><button class="btn btn-sm" id="btnClearData">清空数据源</button></div></div>');
        h.push('<div class="stat-row">' +
          UI.stat({ label: '业务表', value: App.config.TABLE_ORDER.filter(function (t) { return (d[t] || []).length; }).length + ' / 10', hint: '已接入 / 应有', tone: 'primary' }) +
          UI.stat({ label: '总记录数', value: U.thousands(totalRows), hint: '10 张表合计' }) +
          UI.stat({ label: '银行流水', value: U.thousands((d.bank_transactions || []).length), hint: m.periodStart ? (m.periodStart + ' ~ ' + m.periodEnd) : '' }) +
          UI.stat({ label: '凭证 / 分录', value: (d.gl_vouchers || []).length + ' / ' + (d.gl_voucher_entries || []).length, small: true }) +
          UI.stat({ label: '会计科目', value: (d.subjects || []).length, hint: '含末级科目' }) +
          '</div>');
        if (m.note) h.push(UI.alert(UI.esc(m.note), 'info'));
        if (m.mapping && m.mapping.length) {
          h.push('<div class="mt8 small"><b>上传映射结果：</b>' + m.mapping.map(function (x) {
            return UI.esc(x.sheet) + ' → ' + UI.esc(x.table) + '（' + x.rows + ' 行）';
          }).join('；') + '</div>');
        }
        /* 表清单 */
        h.push('<div class="table-wrap mt14"><table class="grid"><thead><tr><th>表名</th><th>中文名</th><th style="text-align:right">记录数</th><th>关键字段</th></tr></thead><tbody>');
        App.config.TABLE_ORDER.forEach(function (t) {
          var meta = App.config.TABLES[t];
          var n = (d[t] || []).length;
          h.push('<tr><td class="mono">' + t + '</td><td>' + meta.cn + '</td><td class="num">' +
            (n ? U.thousands(n) : '<span class="tag tag-mid">缺失</span>') + '</td><td class="small muted">' + meta.keys.slice(0, 5).join(', ') + '</td></tr>');
        });
        h.push('</tbody></table></div>');
        h.push('</div>');
      }

      /* ---------- 全科目汇总 ---------- */
      h.push('<div class="card"><div class="card-head"><div class="card-title">全科目口径汇总<span class="sub">按科目树逐级汇总发生额与余额</span></div>' +
        '<div class="card-actions">' +
        '<button class="btn btn-sm" id="btnAgg">按全科目汇总</button>' +
        '<button class="btn btn-sm btn-primary" id="btnAggAll">汇总并生成数据质量报告</button>' +
        '</div></div>');
      h.push('<div id="aggOut"></div></div>');

      mount.innerHTML = h.join('');

      /* ---------- 事件：数据源 ---------- */
      Array.prototype.forEach.call(mount.querySelectorAll('[data-src]'), function (card) {
        card.addEventListener('click', function () {
          var src = card.getAttribute('data-src');
          if (src === 'preset') {
            mount.querySelector('#uploadZone').classList.add('hidden');
            mount.querySelector('#mysqlZone').classList.add('hidden');
            loadPreset(mount);
          } else if (src === 'upload') {
            mount.querySelector('#uploadZone').classList.remove('hidden');
            mount.querySelector('#mysqlZone').classList.add('hidden');
          } else {
            mount.querySelector('#mysqlZone').classList.remove('hidden');
            mount.querySelector('#uploadZone').classList.add('hidden');
            checkMysql(mount);
          }
        });
      });

      var dz = mount.querySelector('#dz'), fi = mount.querySelector('#fileInput');
      if (dz) {
        dz.addEventListener('click', function () { fi.click(); });
        dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('drag'); });
        dz.addEventListener('dragleave', function () { dz.classList.remove('drag'); });
        dz.addEventListener('drop', function (e) {
          e.preventDefault(); dz.classList.remove('drag');
          handleFiles(mount, e.dataTransfer.files);
        });
        fi.addEventListener('change', function () { handleFiles(mount, fi.files); });
      }
      var tpl = mount.querySelector('#btnTemplate');
      if (tpl) tpl.addEventListener('click', function () { showTemplate(mount); });
      var clear = mount.querySelector('#btnClearData');
      if (clear) clear.addEventListener('click', function () {
        UI.confirm({ title: '清空数据源', body: '清空后所有分析结果将失效，需要重新接入数据。是否继续？', okText: '清空' }).then(function (ok) {
          if (!ok) return;
          App.state.dataset = null;
          ['riskAlert', 'clueSort', 'linkage', 'aggregation', 'scorecard', 'report'].forEach(function (k) { App.state[k] = null; });
          App.memory.saveState({});
          App.refreshTopbar();
          App.pages.aggregate.render(mount);
          UI.toast('已清空数据源', 'ok');
        });
      });

      var bAgg = mount.querySelector('#btnAgg');
      if (bAgg) bAgg.addEventListener('click', function () { runAgg(mount, false); });
      var bAll = mount.querySelector('#btnAggAll');
      if (bAll) bAll.addEventListener('click', function () { runAgg(mount, true); });

      /* 若已有汇总结果，直接渲染 */
      if (S.aggregation && S.aggregation.ok) renderAgg(mount, S.aggregation);
      else mount.querySelector('#aggOut').innerHTML = UI.empty({
        icon: '▤', title: '尚未执行汇总',
        desc: '点击「按全科目汇总」按钮，助理将按科目树从末级科目逐级向上汇总，并做借贷平衡校验。'
      });
    }
  };

  /* ---------------- 预置数据 ---------------- */
  function loadPreset(mount) {
    var out = mount.querySelector('#aggOut');
    out.innerHTML = UI.loading('正在生成预置演示数据…');
    setTimeout(function () {
      try {
        var ds = App.demoData.build({});
        App.state.set('dataset', ds);
        App.memory.saveState({ dataset: ds });
        App.refreshTopbar();
        UI.toast('已加载预置演示数据（' + (ds.data.bank_transactions || []).length + ' 笔流水）', 'ok');
        App.pages.aggregate.render(mount);
      } catch (e) {
        out.innerHTML = UI.errorState(e.message);
      }
    }, 30);
  }

  /* ---------------- 上传 ---------------- */
  function handleFiles(mount, files) {
    if (!files || !files.length) return;
    var list = mount.querySelector('#fileList');
    list.innerHTML = '<div class="small muted">正在解析 ' + files.length + ' 个文件…</div>';
    var csvFiles = [], excelFiles = [];
    Array.prototype.forEach.call(files, function (f) {
      if (/\.csv$/i.test(f.name) || /\.txt$/i.test(f.name)) csvFiles.push(f);
      else excelFiles.push(f);
    });

    var jobs = [];
    csvFiles.forEach(function (f) {
      jobs.push(readAsText(f).then(function (text) { return { name: f.name, text: text }; }));
    });

    Promise.all(jobs).then(function (texts) {
      var result = null;
      if (texts.length) result = App.dataSource.fromCSVTexts(texts);
      if (!excelFiles.length) return result;
      /* Excel 需要 SheetJS；若未加载则提示 */
      if (!global.XLSX) {
        UI.toast('Excel 解析需要 SheetJS 库（离线时不可用），请另存为 CSV 后上传', 'warn');
        return result;
      }
      var sheets = {};
      var chain = Promise.resolve();
      excelFiles.forEach(function (f) {
        chain = chain.then(function () {
          return readAsArrayBuffer(f).then(function (buf) {
            var wb = global.XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
            wb.SheetNames.forEach(function (sn) {
              sheets[sn] = global.XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '', raw: false });
            });
          });
        });
      });
      return chain.then(function () {
        var xr = App.dataSource.fromSheets(sheets, { source: 'upload', label: '上传文件（' + excelFiles.map(function (f) { return f.name; }).join('、') + '）' });
        if (xr.ok && result && result.ok) {
          /* 合并 CSV 与 Excel 结果 */
          Object.keys(xr.data).forEach(function (t) { result.data[t] = xr.data[t]; });
          return result;
        }
        return xr;
      });
    }).then(function (r) {
      if (!r) { list.innerHTML = '<div class="small muted">没有可解析的文件</div>'; return; }
      if (!r.ok) {
        list.innerHTML = '<div class="alert alert-danger"><span class="alert-ico">⚠</span><div>' + UI.esc(r.error) + '</div></div>';
        return;
      }
      /* 与预置数据合并：缺失表用预置补齐 */
      var hasBank = (r.data.bank_transactions || []).length > 0;
      var merged;
      if (hasBank) {
        merged = r;
        var missing = App.config.TABLE_ORDER.filter(function (t) { return !(r.data[t] || []).length; });
        if (missing.length) {
          var preset = App.demoData.build({});
          App.config.TABLE_ORDER.forEach(function (t) {
            if (!(r.data[t] || []).length) r.data[t] = preset.data[t];
          });
          merged.meta.note = '以下表未在文件中提供，已用预置演示数据补齐：' + missing.map(function (t) { return App.config.TABLES[t].cn; }).join('、');
        }
      } else {
        merged = r;
      }
      list.innerHTML = '<div class="alert alert-ok"><span class="alert-ico">✓</span><div>解析成功：' +
        Object.keys(r.data).filter(function (t) { return r.data[t].length; }).map(function (t) {
          return App.config.TABLES[t].cn + ' ' + r.data[t].length + ' 行';
        }).join('、') + '</div></div>';
      App.state.set('dataset', merged);
      App.memory.saveState({ dataset: merged });
      App.memory.save({ lastSource: 'upload' });
      App.refreshTopbar();
      UI.toast('已接入上传数据', 'ok');
      setTimeout(function () { App.pages.aggregate.render(mount); }, 400);
    }).catch(function (e) {
      list.innerHTML = '<div class="alert alert-danger"><span class="alert-ico">⚠</span><div>' + UI.esc(e.message) + '</div></div>';
    });
  }

  function readAsText(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('读取文件失败：' + file.name)); };
      fr.readAsText(file, 'utf-8');
    });
  }
  function readAsArrayBuffer(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(new Error('读取文件失败：' + file.name)); };
      fr.readAsArrayBuffer(file);
    });
  }

  /* ---------------- 模板说明 ---------------- */
  function showTemplate(mount) {
    var rows = [
      ['bank_transactions', 'txn_date, txn_time, account_id, counterparty_name, counterparty_account, amount, direction, purpose, matched, voucher_no, invoice_no, contract_no'],
      ['gl_voucher_entries', 'voucher_id, voucher_no, voucher_date, period, subject_code, debit, credit, summary, counterparty, employee_name, dept_id'],
      ['gl_vouchers', 'voucher_id, voucher_no, voucher_date, period, prepared_by, approved_by, status'],
      ['gl_ledger', 'period, subject_code, opening_balance, debit_amount, credit_amount, closing_balance'],
      ['subjects', 'subject_code, subject_name, parent_code, level, direction'],
      ['customers', 'customer_id, customer_name, legal_person, contact, bank_account'],
      ['suppliers', 'supplier_id, supplier_name, legal_person, contact, bank_account'],
      ['employees', 'employee_id, employee_name, id_card, salary_card, dept_id, position'],
      ['departments', 'dept_id, dept_name, manager'],
      ['bank_accounts', 'account_id, account_no, account_name, bank_name, account_type']
    ];
    var csv = App.dataSource.toCSV(rows, [0, 1], ['表名', '必需字段（可含更多字段）']);
    var body = '<div class="small" style="line-height:1.75;margin-bottom:10px">' +
      '上传的表格请满足：①表名（或工作表名）能对应到下列业务表；②列名可包含中文（系统会自动映射，如"对手方"→counterparty_name、"金额"→amount）。<br>' +
      '若只上传银行流水一张表，其余表会自动用预置演示数据补齐，便于先看分析效果。</div>' +
      '<div class="table-wrap"><table class="grid"><thead><tr><th>业务表</th><th>必需字段</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td class="mono">' + UI.esc(r[0]) + '</td><td class="small wrap" style="white-space:normal">' + UI.esc(r[1]) + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    var m = UI.modal({
      title: '数据模板说明', wide: true, body: body,
      footer: '<button class="btn" data-close>关闭</button><button class="btn btn-primary" id="dlTpl">下载模板 CSV</button>'
    });
    m.body.parentNode.querySelector('#dlTpl').addEventListener('click', function () {
      var ok = App.dataSource.download('财务舞弊111_数据模板.csv', csv, 'text/csv');
      UI.toast(ok ? '模板已下载' : '当前环境不允许下载', ok ? 'ok' : 'err');
    });
    /* 点击"点击上传"卡片时也显示说明 */
    var card = mount.querySelector('[data-src="upload"]');
    if (card) card.onclick = function () {
      mount.querySelector('#uploadZone').classList.remove('hidden');
      mount.querySelector('#mysqlZone').classList.add('hidden');
    };
  }

  /* ---------------- MySQL ---------------- */
  function checkMysql(mount) {
    var out = mount.querySelector('#mysqlOut');
    out.innerHTML = UI.loading('正在检测本地代理与数据库客户端…');
    App.llm.status().then(function (st) {
      if (!st.online) {
        out.innerHTML = UI.alert('未检测到本地代理服务（' + UI.esc(st.base) + '）。<br>' +
          '请双击项目根目录的 <b>start.bat</b> 启动后再试；或改用「预置演示数据」「上传 Excel/CSV」。', 'warn') +
          '<button class="btn btn-sm mt8" id="btnRecheckDb">重新检测</button>';
        out.querySelector('#btnRecheckDb').addEventListener('click', function () { checkMysql(mount); });
        return;
      }
      fetch(st.base + '/api/db/status').then(function (r) { return r.json(); }).then(function (j) {
        var h = [];
        h.push('<div class="card" style="background:#FCFBFF">');
        h.push('<div class="mem-row"><span class="mem-k">本地代理</span><span class="mem-v"><span class="pass">已连接</span> ' + UI.esc(st.base) + '</span></div>');
        h.push('<div class="mem-row"><span class="mem-k">MySQL 客户端</span><span class="mem-v">' +
          (j.clientInstalled ? '<span class="pass">已安装</span> <span class="small muted">' + UI.esc(j.clientVersion || '') + '</span>' : '<span class="fail">未检测到 mysql 命令</span>') + '</span></div>');
        h.push('<div class="mem-row"><span class="mem-k">目标数据库</span><span class="mem-v">' +
          (j.config && j.config.database ? UI.esc(j.config.user + '@' + j.config.host + ':' + j.config.port + '/' + j.config.database) : '<span class="small muted">未配置（FRAUD111_DB_NAME）</span>') + '</span></div>');
        h.push('<div class="hint" style="font-size:11.5px;color:#6B6780;margin-top:6px">' + UI.esc(j.hint || '') + '</div>');
        h.push('<div class="flex-gap mt8"><button class="btn btn-sm btn-primary" id="btnLoadDb"' +
          (!j.clientInstalled || !j.config.database ? ' disabled' : '') + '>读取 10 张业务表</button>' +
          '<button class="btn btn-sm" id="btnRecheckDb2">重新检测</button></div>');
        h.push('</div>');
        out.innerHTML = h.join('');
        out.querySelector('#btnRecheckDb2').addEventListener('click', function () { checkMysql(mount); });
        var lb = out.querySelector('#btnLoadDb');
        if (lb) lb.addEventListener('click', function () {
          lb.disabled = true;
          lb.textContent = '读取中…';
          App.dataSource.fromServer().then(function (ds) {
            App.state.set('dataset', ds);
            App.memory.saveState({ dataset: ds });
            App.refreshTopbar();
            UI.toast('已从数据库读取数据', 'ok');
            App.pages.aggregate.render(mount);
          }).catch(function (e) {
            lb.disabled = false;
            lb.textContent = '读取 10 张业务表';
            out.querySelector('.card').insertAdjacentHTML('afterbegin', UI.alert(UI.esc(e.message), 'danger'));
          });
        });
      }).catch(function (e) {
        out.innerHTML = UI.errorState(e.message);
      });
    });
  }

  /* ---------------- 执行汇总 ---------------- */
  function runAgg(mount, withQuality) {
    var S = App.state;
    var out = mount.querySelector('#aggOut');
    if (!S.dataset) {
      out.innerHTML = UI.alert('请先接入数据源（预置演示数据 / 上传文件 / 数据库）。', 'warn');
      return;
    }
    out.innerHTML = UI.loading('正在按科目树逐级汇总…');
    setTimeout(function () {
      try {
        var cal = S.caliber();
        var r = App.aggregation.run(S.dataset, { period: cal.period });
        if (!r.ok) { out.innerHTML = UI.errorState(r.error); return; }
        App.state.set('aggregation', r);
        renderAgg(mount, r, withQuality);
        UI.toast('汇总完成：' + r.rows.length + ' 个科目，借贷' + (r.balance.balanced ? '平衡' : '不平'), r.balance.balanced ? 'ok' : 'warn');
      } catch (e) {
        console.error(e);
        out.innerHTML = UI.errorState(e.message);
      }
    }, 30);
  }

  /* ---------------- 渲染汇总结果 ---------------- */
  function renderAgg(mount, r, withQuality) {
    var out = mount.querySelector('#aggOut');
    var h = [];

    /* 口径说明卡 */
    h.push('<div class="caliber-bar"><span>口径：</span><b>' + UI.esc(r.caliber.periodRange) + '</b>' +
      '<span>· ' + r.caliber.subjectCount + ' 个科目（末级 ' + r.caliber.leafCount + '，' + r.caliber.levelCount + ' 级）</span>' +
      '<span>· ' + UI.esc(r.caliber.currency + ' / ' + r.caliber.unit) + '</span>' +
      '<span class="cal-actions"><span class="small muted">汇总口径由岗位人员确认后生效</span></span></div>');

    /* 借贷平衡 */
    var bal = r.balance;
    h.push('<div class="stat-row">' +
      UI.stat({ label: '借方发生额合计', value: U.money(bal.totalDebit), hint: U.moneyRaw(bal.totalDebit) + ' 元' }) +
      UI.stat({ label: '贷方发生额合计', value: U.money(bal.totalCredit), hint: U.moneyRaw(bal.totalCredit) + ' 元' }) +
      UI.stat({ label: '借贷平衡校验', value: bal.balanced ? '平衡' : '不平衡', hint: bal.balanced ? '差额 0.00 元' : '差额 ' + U.moneyRaw(bal.diff) + ' 元', tone: bal.balanced ? 'low' : 'high' }) +
      UI.stat({ label: '不平衡凭证', value: bal.unbalancedVouchers.length + ' 张', hint: bal.unbalancedVouchers.length ? '需先整改' : '全部平衡', tone: bal.unbalancedVouchers.length ? 'mid' : 'low' }) +
      UI.stat({ label: '数据质量问题', value: r.qualityTotals.issueTypes + ' 类 / ' + r.qualityTotals.issueCount + ' 项', tone: r.qualityTotals.issueTypes ? 'mid' : 'low' }) +
      '</div>');
    if (r.warnings && r.warnings.length) h.push(UI.alerts(r.warnings, 'warn', '结果校验提示'));

    /* 不平衡凭证明细 */
    if (bal.unbalancedVouchers.length) {
      h.push('<div class="mt8"><b class="small">借贷不平凭证（前 10 张）</b><div class="table-wrap mt8"><table class="grid"><thead><tr>' +
        '<th>凭证号</th><th>日期</th><th>期间</th><th style="text-align:right">借方</th><th style="text-align:right">贷方</th><th style="text-align:right">差额</th></tr></thead><tbody>');
      bal.unbalancedVouchers.slice(0, 10).forEach(function (v) {
        h.push('<tr><td class="mono">' + UI.esc(v.voucher_no) + '</td><td>' + UI.esc(v.date) + '</td><td>' + UI.esc(v.period) + '</td>' +
          '<td class="num">' + U.moneyRaw(v.debit) + '</td><td class="num">' + U.moneyRaw(v.credit) + '</td>' +
          '<td class="num" style="color:#D93025">' + U.moneyRaw(v.diff) + '</td></tr>');
      });
      h.push('</tbody></table></div></div>');
    }

    /* 全科目汇总表 */
    h.push('<div class="card-head mt14"><div class="card-title">全科目汇总表<span class="sub">一级至末级科目全覆盖，父级 = Σ子级</span></div>' +
      '<div class="card-actions"><button class="btn btn-sm" id="btnExportAgg">导出全科目汇总 CSV</button></div></div>');
    h.push('<div id="aggTable"></div>');

    /* 数据质量报告 */
    h.push('<div class="card-head mt14"><div class="card-title">数据质量报告<span class="sub">问题类型 / 条数 / 示例 / 影响提示</span></div></div>');
    if (!r.quality.length) {
      h.push(UI.alert('未发现明显的数据质量问题（仍建议人工抽查原始数据）。', 'ok'));
    } else {
      h.push('<div class="table-wrap"><table class="grid"><thead><tr><th>问题类型</th><th style="text-align:right">条数</th><th>明细</th><th>影响提示</th></tr></thead><tbody>');
      r.quality.forEach(function (q) {
        h.push('<tr><td><span class="tag tag-mid">' + UI.esc(q.type) + '</span></td><td class="num">' + q.count + '</td>' +
          '<td class="wrap">' + UI.esc(q.detail) + '</td><td class="wrap small muted">' + UI.esc(q.impact || '') + '</td></tr>');
      });
      h.push('</tbody></table></div>');
    }

    /* 口径说明 */
    h.push('<div class="mt14"><div class="caliber-bar" style="display:block;line-height:1.9">' +
      '<div><b>汇总口径说明</b></div>' +
      '<div class="small">· 汇总公式：' + UI.esc(r.caliber.aggregation) + '</div>' +
      '<div class="small">· 余额规则：' + UI.esc(r.caliber.balanceRule) + '</div>' +
      '<div class="small">· 数据来源：' + UI.esc(r.caliber.source) + '　｜　币种单位：' + UI.esc(r.caliber.currency + ' / ' + r.caliber.unit) + '</div>' +
      '<div class="small muted">· 口径是否符合审计方案，请由岗位人员确认。</div>' +
      '</div></div>');

    out.innerHTML = h.join('');

    /* 渲染表格 */
    var rows = r.rows;
    var tableWrap = out.querySelector('#aggTable');
    var api = UI.table(tableWrap, {
      csvName: '全科目汇总',
      pageSize: 100,
      rows: rows,
      defaultSort: 'subject_code',
      defaultSortDir: 'asc',
      columns: [
        {
          key: 'subject_code', title: '科目编码', width: 120,
          render: function (row) {
            var indent = (row.level - 1) * 16;
            return '<span style="padding-left:' + indent + 'px" class="mono">' + UI.esc(row.subject_code) + '</span>';
          }
        },
        {
          key: 'subject_name', title: '科目名称', width: 190,
          render: function (row) {
            var b = row.isLeaf ? '' : 'font-weight:600;';
            var tag = row.isLeaf ? '' : ' <span class="tag tag-line">汇总级</span>';
            return '<span style="' + b + '">' + UI.esc(row.subject_name) + '</span>' + tag;
          }
        },
        { key: 'level', title: '层级', width: 56, render: function (row) { return row.level + ' 级'; } },
        { key: 'direction', title: '方向', width: 52, render: function (row) { return '<span class="tag tag-gray">' + UI.esc(row.direction) + '</span>'; } },
        { key: 'periodCount', title: '期间数', width: 66, type: 'num', csv: function (r2) { return r2.periodCount; } },
        { key: 'opening', title: '期初余额', width: 118, type: 'num', render: function (row) { return U.moneyRaw(row.opening); }, csv: function (r2) { return r2.opening; } },
        { key: 'debit', title: '借方发生额', width: 118, type: 'num', render: function (row) { return U.moneyRaw(row.debit); }, csv: function (r2) { return r2.debit; } },
        { key: 'credit', title: '贷方发生额', width: 118, type: 'num', render: function (row) { return U.moneyRaw(row.credit); }, csv: function (r2) { return r2.credit; } },
        { key: 'closing', title: '期末余额', width: 118, type: 'num', render: function (row) { return U.moneyRaw(row.closing); }, csv: function (r2) { return r2.closing; } }
      ],
      filters: [
        { key: 'level', label: '层级', options: [1, 2, 3].map(function (l) { return { value: String(l), label: l + ' 级' }; }), test: function (row, v) { return String(row.level) === v; } },
        { key: 'leaf', label: '科目类型', options: [{ value: 'leaf', label: '仅末级' }, { value: 'parent', label: '仅汇总级' }], test: function (row, v) { return v === 'leaf' ? row.isLeaf : !row.isLeaf; } },
        { key: 'hasData', label: '是否有数据', options: [{ value: 'y', label: '有发生额' }, { value: 'n', label: '无发生额' }], test: function (row, v) { return v === 'y' ? (row.debit || row.credit) > 0 : !(row.debit || row.credit); } }
      ],
      emptyTitle: '没有匹配的科目'
    });
    var eb = out.querySelector('#btnExportAgg');
    if (eb) eb.addEventListener('click', function () { api.exportCSV(); });
  }

  /* 全局 SheetJS 检测变量 */
  var global = typeof window !== 'undefined' ? window : globalThis;
})(typeof window !== 'undefined' ? window : globalThis);
