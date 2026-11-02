/* =============================================================
 * 财务舞弊111 · UI 组件库（无第三方依赖）
 * 表格：排序 / 筛选 / 按列导出 CSV / 行内展开命中依据
 * 图表：基于内联 SVG 与 CSS 的轻量实现（散点、箱线、柱状、雷达、关系图）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;
  var UI = {};

  /* ===================== 基础转义 ===================== */
  var esc = UI.esc = U.escapeHtml;

  UI.h = function (str) {
    /* 极简模板：{{expr}} 形式不安全，这里只做原样返回，便于阅读代码 */
    return str;
  };

  /* ===================== 参考值说明 ⓘ ===================== */
  UI.info = function (tip) {
    return '<i class="info-i" data-tip="' + esc(tip || '参考值，需人工复核') + '">i</i>';
  };
  UI.REF_TIP = '参考值，需人工复核';

  /* ===================== 分工提示条 ===================== */
  UI.divisionBar = function (extra) {
    return '<div class="division-bar"><span class="div-ico">⚖</span><span>本页输出为辅助材料，最终判断由调查人员作出</span>' +
      '<span class="div-right">' + esc(extra || '助理辅助 · 人工决策') + '</span></div>';
  };

  /* ===================== 状态占位 ===================== */
  UI.empty = function (opt) {
    opt = opt || {};
    return '<div class="empty"><div class="empty-art">' + (opt.icon || '📄') + '</div>' +
      '<div class="empty-title">' + esc(opt.title || '暂无数据') + '</div>' +
      '<div class="empty-desc">' + (opt.desc || '') + '</div>' +
      (opt.action ? opt.action : '') + '</div>';
  };

  UI.loading = function (text) {
    return '<div class="loading"><div class="spinner"></div><div>' + esc(text || '正在计算…') + '</div>' +
      '<div class="progress-line"><i></i></div></div>';
  };

  UI.errorState = function (msg, hint) {
    return '<div class="error-state"><div class="empty-art">!</div>' +
      '<div class="empty-title">处理失败</div><div class="empty-desc">' + esc(msg || '未知错误') + '</div>' +
      (hint ? '<div class="small muted">' + esc(hint) + '</div>' : '') + '</div>';
  };

  UI.alerts = function (list, type, title) {
    if (!list || !list.length) return '';
    return '<div class="alert alert-' + (type || 'warn') + '"><span class="alert-ico">' + (type === 'danger' ? '⚠' : type === 'ok' ? '✓' : 'ⓘ') + '</span>' +
      '<div>' + (title ? '<b>' + esc(title) + '</b>' : '') +
      '<ul>' + list.map(function (x) { return '<li>' + (typeof x === 'string' ? esc(x) : x) + '</li>'; }).join('') + '</ul></div></div>';
  };

  UI.alert = function (text, type) {
    if (!text) return '';
    return '<div class="alert alert-' + (type || 'info') + '"><span class="alert-ico">ⓘ</span><div>' + text + '</div></div>';
  };

  /* ===================== 指标卡 ===================== */
  UI.stat = function (o) {
    return '<div class="stat ' + (o.tone || '') + '">' +
      '<div class="stat-label">' + esc(o.label) + (o.tip ? UI.info(o.tip) : '') + '</div>' +
      '<div class="stat-value ' + (o.small ? 'sm' : '') + '">' + (o.raw ? o.value : esc(o.value)) + '</div>' +
      (o.hint ? '<div class="stat-hint">' + esc(o.hint) + '</div>' : '') +
      '</div>';
  };

  /* ===================== 表格 ===================== */
  /**
   * 创建可交互表格
   * @param {HTMLElement} mount
   * @param {object} cfg {
   *   columns: [{key,title,type:'text'|'num'|'tag'|'html',width,align,sortable,render(row),csv(row),tip}],
   *   rows, pageSize, expandable, expand(row) -> html,
   *   toolbar: [{label,cls,onClick(tableApi)}],
   *   filters: [{key,label,options:[{value,label}],test(row,value)}],
   *   csvName, emptyText, onRowClick, rowClass(row)
   * }
   */
  UI.table = function (mount, cfg) {
    var state = {
      rows: (cfg.rows || []).slice(),
      sortKey: cfg.defaultSort || null,
      sortDir: cfg.defaultSortDir || 'desc',
      page: 1,
      pageSize: cfg.pageSize || 50,
      keyword: '',
      filterValues: {},
      expanded: {}
    };

    var root = document.createElement('div');
    mount.innerHTML = '';
    mount.appendChild(root);

    function applyFilters() {
      var out = state.rows.slice();
      if (state.keyword) {
        var kw = state.keyword.toLowerCase();
        out = out.filter(function (r) {
          return (cfg.columns || []).some(function (c) {
            var v = c.csv ? c.csv(r) : r[c.key];
            return String(v === undefined || v === null ? '' : v).toLowerCase().indexOf(kw) >= 0;
          });
        });
      }
      (cfg.filters || []).forEach(function (f) {
        var v = state.filterValues[f.key];
        if (v === undefined || v === '' || v === null) return;
        out = out.filter(function (r) { return f.test(r, v); });
      });
      if (state.sortKey) {
        var col = (cfg.columns || []).filter(function (c) { return c.key === state.sortKey; })[0] || {};
        var dir = state.sortDir === 'asc' ? 1 : -1;
        out.sort(function (a, b) {
          var va = col.sortValue ? col.sortValue(a) : (col.csv ? col.csv(a) : a[state.sortKey]);
          var vb = col.sortValue ? col.sortValue(b) : (col.csv ? col.csv(b) : b[state.sortKey]);
          var na = U.num(va, null), nb = U.num(vb, null);
          if (na !== null && nb !== null && String(va) !== '' && String(vb) !== '') return (na - nb) * dir;
          va = String(va === undefined || va === null ? '' : va); vb = String(vb === undefined || vb === null ? '' : vb);
          return va.localeCompare(vb, 'zh-CN') * dir;
        });
      }
      return out;
    }

    function cellHTML(col, row) {
      if (col.render) return col.render(row);
      var v = row[col.key];
      if (col.type === 'num') return U.moneyRaw(v);
      if (v === undefined || v === null || v === '') return '<span class="muted">—</span>';
      return esc(v);
    }

    function render() {
      var filtered = applyFilters();
      var total = filtered.length;
      var pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) state.page = pages;
      var start = (state.page - 1) * state.pageSize;
      var pageRows = filtered.slice(start, start + state.pageSize);

      var h = [];

      /* 工具栏 */
      h.push('<div class="table-toolbar">');
      h.push('<input class="input" style="width:190px" placeholder="搜索…" value="' + esc(state.keyword) + '" data-role="kw">');
      (cfg.filters || []).forEach(function (f) {
        h.push('<select class="select" data-filter="' + f.key + '"><option value="">' + esc(f.label) + '：全部</option>' +
          (f.options || []).map(function (o) {
            return '<option value="' + esc(o.value) + '"' + (String(state.filterValues[f.key]) === String(o.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
          }).join('') + '</select>');
      });
      (cfg.toolbar || []).forEach(function (b) {
        h.push('<button class="btn btn-sm ' + (b.cls || '') + '" data-toolbar="' + esc(b.id) + '">' + esc(b.label) + '</button>');
      });
      h.push('<span class="grow"></span>');
      h.push('<span class="small muted">共 ' + total + ' 条' + (total !== state.rows.length ? '（已筛选，总 ' + state.rows.length + '）' : '') + '</span>');
      h.push('</div>');

      /* 表格 */
      if (!total) {
        h.push(UI.empty({ icon: '🔍', title: cfg.emptyTitle || '没有匹配的记录', desc: cfg.emptyText || '调整筛选条件或搜索关键词后重试。' }));
      } else {
        h.push('<div class="table-wrap"><table class="grid"><thead><tr>');
        (cfg.columns || []).forEach(function (c) {
          var sortable = c.sortable !== false;
          var sorted = state.sortKey === c.key;
          h.push('<th class="' + (sortable ? 'sortable ' : '') + (sorted ? 'sorted' : '') + '"' +
            (sortable ? ' data-sort="' + esc(c.key) + '"' : '') +
            (c.width ? ' style="min-width:' + c.width + 'px"' : '') + '>' + esc(c.title) +
            (c.tip ? ' ' + UI.info(c.tip) : '') +
            (sortable ? '<span class="arrow">' + (sorted ? (state.sortDir === 'asc' ? '▲' : '▼') : '⇅') + '</span>' : '') + '</th>');
        });
        if (cfg.expandable) h.push('<th style="width:64px">依据</th>');
        h.push('</tr></thead><tbody>');

        pageRows.forEach(function (row, ri) {
          var idx = start + ri;
          var rid = 'r' + idx;
          var cls = ['clickable'];
          if (cfg.rowClass) cls.push(cfg.rowClass(row) || '');
          if (state.expanded[rid]) cls.push('row-expanded');
          h.push('<tr class="' + cls.join(' ') + '" data-row="' + idx + '">');
          (cfg.columns || []).forEach(function (c) {
            var isNum = c.type === 'num';
            h.push('<td class="' + (isNum ? 'num' : '') + (c.wrap ? ' wrap' : '') + '" data-col="' + esc(c.key) + '">' + cellHTML(c, row) + '</td>');
          });
          if (cfg.expandable) {
            h.push('<td><button class="btn btn-sm btn-ghost" data-expand="' + idx + '">' + (state.expanded[rid] ? '收起' : '展开') + '</button></td>');
          }
          h.push('</tr>');
          if (cfg.expandable && state.expanded[rid]) {
            h.push('<tr class="detail-row"><td colspan="' + ((cfg.columns || []).length + 1) + '">' + (cfg.expand ? cfg.expand(row) : '') + '</td></tr>');
          }
        });
        h.push('</tbody></table></div>');

        /* 分页 */
        h.push('<div class="table-foot"><span class="grow">第 ' + state.page + ' / ' + pages + ' 页，每页 ' + state.pageSize + ' 条</span>');
        h.push('<button class="btn btn-sm" data-page="prev"' + (state.page <= 1 ? ' disabled' : '') + '>上一页</button>');
        h.push('<button class="btn btn-sm" data-page="next"' + (state.page >= pages ? ' disabled' : '') + '>下一页</button>');
        if (pages > 3) {
          h.push('<select class="select" data-role="pagesize">' + [20, 50, 100, 200].map(function (n) {
            return '<option value="' + n + '"' + (n === state.pageSize ? ' selected' : '') + '>' + n + ' 条/页</option>';
          }).join('') + '</select>');
        }
        h.push('</div>');
      }

      root.innerHTML = h.join('');

      /* 事件绑定 */
      var kwEl = root.querySelector('[data-role="kw"]');
      if (kwEl) {
        var t = null;
        kwEl.addEventListener('input', function () {
          clearTimeout(t);
          var v = kwEl.value;
          t = setTimeout(function () { state.keyword = v; state.page = 1; render(); }).valueOf();
          setTimeout(function () { state.keyword = v; state.page = 1; }, 0);
        });
        kwEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { state.keyword = kwEl.value; state.page = 1; render(); } });
      }
      Array.prototype.forEach.call(root.querySelectorAll('[data-filter]'), function (sel) {
        sel.addEventListener('change', function () {
          state.filterValues[sel.getAttribute('data-filter')] = sel.value;
          state.page = 1; render();
        });
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-sort]'), function (th) {
        th.addEventListener('click', function () {
          var k = th.getAttribute('data-sort');
          if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          else { state.sortKey = k; state.sortDir = 'desc'; }
          render();
        });
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-expand]'), function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var i = b.getAttribute('data-expand');
          var rid = 'r' + i;
          if (state.expanded[rid]) delete state.expanded[rid];
          else state.expanded[rid] = 1;
          render();
        });
      });
      Array.prototype.forEach.call(root.querySelectorAll('tr[data-row]'), function (tr) {
        tr.addEventListener('click', function () {
          var i = tr.getAttribute('data-row');
          if (cfg.expandable) {
            var rid = 'r' + i;
            if (state.expanded[rid]) delete state.expanded[rid];
            else state.expanded[rid] = 1;
            render();
            return;
          }
          if (cfg.onRowClick) cfg.onRowClick(filtered[Number(i)], api);
        });
      });
      Array.prototype.forEach.call(root.querySelectorAll('[data-page]'), function (b) {
        b.addEventListener('click', function () {
          state.page += (b.getAttribute('data-page') === 'next' ? 1 : -1);
          if (state.page < 1) state.page = 1;
          render();
        });
      });
      var psEl = root.querySelector('[data-role="pagesize"]');
      if (psEl) psEl.addEventListener('change', function () { state.pageSize = U.num(psEl.value, 50); state.page = 1; render(); });
      Array.prototype.forEach.call(root.querySelectorAll('[data-toolbar]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-toolbar');
          var btn = (cfg.toolbar || []).filter(function (x) { return x.id === id; })[0];
          if (btn && btn.onClick) btn.onClick(api);
        });
      });
    }

    var api = {
      /** 当前筛选后的行 */
      getFiltered: applyFilters,
      /** 按列导出 CSV（当前筛选结果） */
      exportCSV: function (colKey) {
        var rows = applyFilters();
        if (!rows.length) { UI.toast('当前没有可导出的数据', 'warn'); return; }
        var cols, headers, name = (cfg.csvName || 'export');
        if (colKey) {
          var c = (cfg.columns || []).filter(function (x) { return x.key === colKey; })[0];
          if (!c) { UI.toast('未找到该列', 'err'); return; }
          cols = [function (r) { return c.csv ? c.csv(r) : r[c.key]; }];
          headers = [c.title];
          name += '_' + c.title;
        } else {
          cols = (cfg.columns || []).map(function (c) { return function (r) { return c.csv ? c.csv(r) : r[c.key]; }; });
          headers = (cfg.columns || []).map(function (c) { return c.title; });
        }
        var csv = App.dataSource.toCSV(rows, cols, headers);
        var ok = App.dataSource.download(name + '_' + U.fmtDateCompact(new Date()) + '.csv', csv, 'text/csv');
        UI.toast(ok ? '已导出 ' + rows.length + ' 条记录' : '当前环境不允许下载，请改用复制', ok ? 'ok' : 'err');
      },
      setRows: function (rows) { state.rows = (rows || []).slice(); state.page = 1; render(); },
      rerender: render,
      state: state
    };

    render();
    return api;
  };

  /* 列头右键/按钮式"按列导出"封装：在表格上方渲染一个导出按钮 */
  UI.exportButton = function (tableApi) {
    return function () { tableApi.exportCSV(); };
  };

  /* ===================== 图表：散点图（信号分布） ===================== */
  UI.scatterChart = function (signals, opt) {
    opt = opt || {};
    var W = opt.width || 760, H = opt.height || 280, PL = 62, PR = 14, PT = 16, PB = 34;
    if (!signals || !signals.length) return UI.empty({ icon: '📈', title: '暂无可绘制的信号', desc: '完成筛查后显示金额分布。' });
    var maxAmt = Math.max.apply(null, signals.map(function (s) { return s.amount; })) || 1;
    var dates = signals.map(function (s) { return U.parseDate(s.txn_date); }).filter(Boolean);
    if (!dates.length) return UI.empty({ icon: '📈', title: '交易日期缺失', desc: '无法按时间绘制散点图，请检查 txn_date 字段。' });
    var minD = Math.min.apply(null, dates), maxD = Math.max.apply(null, dates);
    var span = Math.max(1, maxD - minD);
    var X = function (d) { var v = PL + (W - PL - PR) * ((d - minD) / span); return isFinite(v) ? v : PL; };
    var Y = function (a) { var v = PT + (H - PT - PB) * (1 - Math.min(1, a / maxAmt)); return isFinite(v) ? v : PT; };
    var color = { high: '#D93025', mid: '#E8A317', low: '#9B7BFF' };
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img">'];
    /* 坐标轴 */
    svg.push('<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#E7E3F5"/>');
    svg.push('<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#E7E3F5"/>');
    /* Y 轴刻度 */
    for (var i = 0; i <= 4; i++) {
      var y = PT + (H - PT - PB) * i / 4;
      var val = maxAmt * (1 - i / 4);
      svg.push('<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="#F4F1FB"/>');
      svg.push('<text x="' + (PL - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="9.5" fill="#9C99AB">' + U.money(val) + '</text>');
    }
    /* 基线（均值） */
    if (opt.mean && isFinite(opt.mean)) {
      var my = Y(opt.mean);
      svg.push('<line x1="' + PL + '" y1="' + my + '" x2="' + (W - PR) + '" y2="' + my + '" stroke="#9B7BFF" stroke-dasharray="4 3"/>');
      svg.push('<text x="' + (W - PR) + '" y="' + (my - 4) + '" text-anchor="end" font-size="9.5" fill="#9B7BFF">均值 ' + U.money(opt.mean) + '</text>');
    }
    /* 点 */
    signals.forEach(function (s) {
      var d = U.parseDate(s.txn_date);
      if (!d) return;
      var x = X(d), y = Y(s.amount);
      if (!isFinite(x) || !isFinite(y)) return;
      var r = s.riskLevel === 'high' ? 4.2 : s.riskLevel === 'mid' ? 3.2 : 2.2;
      svg.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r + '" fill="' + (color[s.riskLevel] || '#9B7BFF') + '" fill-opacity="0.72"><title>' +
        esc(s.txn_date + ' ' + s.counterparty + ' ' + U.money(s.amount) + ' [' + s.ruleCodes.join('/') + ']') + '</title></circle>');
    });
    /* X 轴月份标签 */
    var months = U.uniq(signals.map(function (s) { return String(s.txn_date).slice(0, 7); })).sort();
    var show = months.length > 8 ? months.filter(function (m, i) { return i % 2 === 0; }) : months;
    show.forEach(function (m) {
      var d = U.parseDate(m + '-01');
      if (!d) return;
      var x = X(d);
      if (!isFinite(x) || x < PL - 2 || x > W - PR) return;
      svg.push('<text x="' + x.toFixed(1) + '" y="' + (H - PB + 14) + '" text-anchor="middle" font-size="9.5" fill="#9C99AB">' + esc(m.slice(5)) + '月</text>');
    });
    svg.push('<text x="' + (PL - 46) + '" y="' + (PT + 4) + '" font-size="9.5" fill="#9C99AB">金额</text>');
    svg.push('</svg>');
    return '<div class="chart-box">' + svg.join('') + '</div>' +
      '<div class="chart-legend"><span><i style="background:#D93025"></i>参考高风险</span><span><i style="background:#E8A317"></i>参考中风险</span><span><i style="background:#9B7BFF"></i>参考低风险</span><span class="muted">点越大等级越高</span></div>';
  };

  /* ===================== 图表：箱线图 ===================== */
  UI.boxplotChart = function (b, opt) {
    opt = opt || {};
    if (!b || !b.n) return UI.empty({ icon: '📊', title: '暂无统计基线', desc: '数据不足，无法绘制箱线图。' });
    /* 数值兜底：任何缺失/非有限值都应退化为 0，避免输出 NaN 造成 SVG 解析错误 */
    ['min', 'q1', 'median', 'q3', 'max', 'loFence', 'hiFence'].forEach(function (k) {
      if (!isFinite(b[k])) b[k] = isFinite(b.median) ? b.median : 0;
    });
    var W = 760, H = 150, PL = 62, PR = 30, PT = 34, PB = 30;
    var min = Math.min(b.min, isFinite(b.loFence) ? b.loFence : b.min);
    var max = Math.max(b.max, isFinite(b.hiFence) ? b.hiFence : b.max);
    var span = Math.max(1, max - min);
    var X = function (v) {
      var x = PL + (W - PL - PR) * ((U.num(v, min) - min) / span);
      return isFinite(x) ? x : PL;
    };
    var y = PT + 22;
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '">'];
    svg.push('<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#E7E3F5"/>');
    /* 须线 */
    svg.push('<line x1="' + X(b.min) + '" y1="' + y + '" x2="' + X(b.q1) + '" y2="' + y + '" stroke="#9B7BFF" stroke-width="1.5"/>');
    svg.push('<line x1="' + X(b.q3) + '" y1="' + y + '" x2="' + X(b.max) + '" y2="' + y + '" stroke="#9B7BFF" stroke-width="1.5"/>');
    svg.push('<line x1="' + X(b.min) + '" y1="' + (y - 9) + '" x2="' + X(b.min) + '" y2="' + (y + 9) + '" stroke="#9B7BFF"/>');
    svg.push('<line x1="' + X(b.max) + '" y1="' + (y - 9) + '" x2="' + X(b.max) + '" y2="' + (y + 9) + '" stroke="#9B7BFF"/>');
    /* 箱体 */
    svg.push('<rect x="' + X(b.q1) + '" y="' + (y - 15) + '" width="' + Math.max(2, X(b.q3) - X(b.q1)) + '" height="30" fill="#EFEAFF" stroke="#6D4AFF"/>');
    /* 中位线 */
    svg.push('<line x1="' + X(b.median) + '" y1="' + (y - 15) + '" x2="' + X(b.median) + '" y2="' + (y + 15) + '" stroke="#4B2FD6" stroke-width="2"/>');
    /* IQR 上界（离群阈值） */
    svg.push('<line x1="' + X(b.hiFence) + '" y1="' + (y - 22) + '" x2="' + X(b.hiFence) + '" y2="' + (y + 22) + '" stroke="#E8A317" stroke-dasharray="3 3"/>');
    /* 离群点 */
    var outs = (b.outliers || []).filter(function (v) { return isFinite(v); }).slice(0, 160);
    outs.forEach(function (v) {
      svg.push('<circle cx="' + X(v).toFixed(1) + '" cy="' + y + '" r="2.4" fill="#D93025" fill-opacity=".55"><title>' + U.money(v) + '</title></circle>');
    });
    /* 标签 */
    [['min', b.min], ['Q1', b.q1], ['中位数', b.median], ['Q3', b.q3], ['max', b.max]].forEach(function (p) {
      svg.push('<text x="' + X(p[1]).toFixed(1) + '" y="' + (y + 32) + '" text-anchor="middle" font-size="9" fill="#9C99AB">' + p[0] + '</text>');
    });
    svg.push('<text x="' + X(b.hiFence).toFixed(1) + '" y="' + (y - 27) + '" text-anchor="middle" font-size="9" fill="#C08800">IQR 上界</text>');
    svg.push('<text x="' + PL + '" y="16" font-size="10" fill="#6B6780">金额箱线图（样本 ' + b.n + ' 笔，' + (b.outliers || []).length + ' 个离群点）</text>');
    svg.push('</svg>');
    return svg.join('');
  };

  /* ===================== 图表：柱状图 ===================== */
  UI.barChart = function (items, opt) {
    opt = opt || {};
    if (!items || !items.length) return UI.empty({ icon: '📊', title: '暂无数据', desc: '' });
    var max = Math.max.apply(null, items.map(function (x) { return x.value; })) || 1;
    var h = [];
    h.push('<div class="chart-box">');
    items.forEach(function (it) {
      var pct = Math.max(1, (it.value / max) * 100);
      var col = it.color || '#6D4AFF';
      h.push('<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:12.5px">' +
        '<span style="width:' + (opt.labelWidth || 132) + 'px;flex:0 0 ' + (opt.labelWidth || 132) + 'px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4A4560" title="' + esc(it.label) + '">' + esc(it.label) + '</span>' +
        '<span style="flex:1;height:14px;background:#F4F1FB;border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:' + pct.toFixed(1) + '%;background:' + col + ';border-radius:4px"></i></span>' +
        '<span style="flex:0 0 ' + (opt.valueWidth || 96) + 'px;text-align:right;font-variant-numeric:tabular-nums;color:#1F1B2E">' + esc(it.text || it.value) + '</span></div>');
    });
    h.push('</div>');
    return h.join('');
  };

  /* ===================== 图表：雷达图 ===================== */
  UI.radarChart = function (cards, opt) {
    opt = opt || {};
    if (!cards || !cards.length) return UI.empty({ icon: '🕸', title: '暂无评分数据', desc: '完成评分评估后显示雷达图。' });
    var size = opt.size || 330, cx = size / 2, cy = size / 2 + 6, R = size / 2 - 52;
    var n = cards.length;
    var svg = ['<svg viewBox="0 0 ' + size + ' ' + size + '" width="100%" height="' + size + '">'];
    /* 网格 */
    for (var lvl = 1; lvl <= 4; lvl++) {
      var pts = [];
      for (var i = 0; i < n; i++) {
        var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
        var r = R * lvl / 4;
        pts.push((cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1));
      }
      svg.push('<polygon points="' + pts.join(' ') + '" fill="none" stroke="#EFECF7"/>');
    }
    /* 轴线与标签 */
    for (var j = 0; j < n; j++) {
      var a = -Math.PI / 2 + j * 2 * Math.PI / n;
      svg.push('<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + R * Math.cos(a)).toFixed(1) + '" y2="' + (cy + R * Math.sin(a)).toFixed(1) + '" stroke="#EFECF7"/>');
      var lx = cx + (R + 20) * Math.cos(a), ly = cy + (R + 20) * Math.sin(a);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end');
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly + 3.5).toFixed(1) + '" text-anchor="' + anchor + '" font-size="10.5" fill="#4A4560">' + esc(cards[j].name) + '</text>');
      svg.push('<text x="' + lx.toFixed(1) + '" y="' + (ly + 15).toFixed(1) + '" text-anchor="' + anchor + '" font-size="9.5" fill="#9C99AB">' + cards[j].total + '</text>');
    }
    /* 数据多边形 */
    var dpts = cards.map(function (c, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      var r = R * Math.max(0.02, c.total / 100);
      return (cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1);
    });
    svg.push('<polygon points="' + dpts.join(' ') + '" fill="#6D4AFF" fill-opacity="0.16" stroke="#6D4AFF" stroke-width="1.6"/>');
    cards.forEach(function (c, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      var r = R * Math.max(0.02, c.total / 100);
      svg.push('<circle cx="' + (cx + r * Math.cos(ang)).toFixed(1) + '" cy="' + (cy + r * Math.sin(ang)).toFixed(1) + '" r="2.8" fill="#4B2FD6"><title>' + esc(c.name + '：' + c.total + ' 分') + '</title></circle>');
    });
    svg.push('</svg>');
    return svg.join('') + '<div class="small muted" style="text-align:center">刻度 0–100，每格 25 分（参考值，需人工复核）</div>';
  };

  /* ===================== 图表：关系网络图 ===================== */
  UI.networkChart = function (graph, opt) {
    opt = opt || {};
    if (!graph || !graph.nodes || !graph.nodes.length) return UI.empty({ icon: '🕸', title: '暂无关系数据', desc: '完成关联方核查后显示关系网络。' });
    var W = opt.width || 720, H = opt.height || 380;
    var nodes = graph.nodes.slice(0, 40), edges = graph.edges || [];
    var idIdx = {};
    nodes.forEach(function (n, i) { idIdx[n.id] = i; });
    /* 环形布局：本公司居中，其余按类型分环 */
    var kinds = U.uniq(nodes.map(function (n) { return n.kind; }));
    var pos = {};
    var ringOrder = { '本公司': 0, '员工': 1, '法人主体': 2, '供应商/客户': 2 };
    var byRing = {};
    nodes.forEach(function (n) {
      var r = ringOrder[n.kind] !== undefined ? ringOrder[n.kind] : 2;
      (byRing[r] = byRing[r] || []).push(n);
    });
    Object.keys(byRing).forEach(function (rk) {
      var list = byRing[rk], r = U.num(rk);
      if (r === 0) { list.forEach(function (n) { pos[n.id] = { x: W / 2, y: H / 2 }; }); return; }
      var rad = r === 1 ? 118 : 172;
      list.forEach(function (n, i) {
        var ang = -Math.PI / 2 + i * 2 * Math.PI / list.length + (r === 2 ? 0.35 : 0);
        pos[n.id] = { x: W / 2 + rad * Math.cos(ang), y: H / 2 + rad * Math.sin(ang) };
      });
    });
    var colorOf = function (kind) {
      return { '本公司': '#4B2FD6', '员工': '#6D4AFF', '法人主体': '#9B7BFF', '对手方': '#E8A317', '供应商/客户': '#E8A317', '个人账户': '#D93025', '断点': '#D93025', '回流': '#D93025' }[kind] || '#9B7BFF';
    };
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '">'];
    edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to];
      if (!a || !b) return;
      svg.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="#D2C9EE" stroke-width="' + (e.weight > 1 ? 1.6 : 1) + '" ' + (e.dashed ? 'stroke-dasharray="4 3"' : '') + '/>');
    });
    nodes.forEach(function (n) {
      var p = pos[n.id]; if (!p) return;
      var rad = n.kind === '本公司' ? 15 : 8;
      svg.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + rad + '" fill="' + colorOf(n.kind) + '" fill-opacity=".85" stroke="#fff" stroke-width="1.5"><title>' + esc(n.label + '（' + n.kind + '）') + '</title></circle>');
      svg.push('<text x="' + p.x.toFixed(1) + '" y="' + (p.y + rad + 11).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="#4A4560">' + esc(String(n.label).slice(0, 10)) + '</text>');
    });
    svg.push('</svg>');
    var legend = '<div class="chart-legend">' + U.uniq(nodes.map(function (n) { return n.kind; })).map(function (k) {
      return '<span><i style="background:' + colorOf(k) + '"></i>' + esc(k) + '</span>';
    }).join('') + '</div>';
    return svg.join('') + legend;
  };

  /* ===================== 图表容器（带口径与生成时间标注） ===================== */
  UI.chartCard = function (opt) {
    return '<div class="card chart-card">' +
      '<div class="chart-meta">数据口径：' + esc(opt.caliber || '全科目') + '<br>生成时间：' + esc(opt.time || U.fmtDateTime(new Date())) + '</div>' +
      '<div class="card-head"><div class="card-title">' + esc(opt.title) + (opt.sub ? '<span class="sub">' + esc(opt.sub) + '</span>' : '') + '</div></div>' +
      opt.body + '</div>';
  };

  /* ===================== 弹窗 ===================== */
  UI.modal = function (opt) {
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = '<div class="modal ' + (opt.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div class="modal-title">' + esc(opt.title || '') + '</div>' +
      '<button class="modal-close" aria-label="关闭">✕</button></div>' +
      '<div class="modal-body">' + (opt.body || '') + '</div>' +
      (opt.footer !== null ? '<div class="modal-foot">' + (opt.footer || '<button class="btn" data-close>关闭</button>') + '</div>' : '') +
      '</div>';
    document.body.appendChild(mask);
    var close = function () {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
      document.removeEventListener('keydown', onKey);
    };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    mask.querySelector('.modal-close').addEventListener('click', close);
    Array.prototype.forEach.call(mask.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', close); });
    return {
      el: mask.querySelector('.modal'),
      body: mask.querySelector('.modal-body'),
      close: close,
      setBody: function (html) { mask.querySelector('.modal-body').innerHTML = html; }
    };
  };

  UI.confirm = function (opt) {
    return new Promise(function (resolve) {
      var m = UI.modal({
        title: opt.title || '请确认',
        body: '<div style="font-size:13px;line-height:1.75">' + (opt.body || '') + '</div>',
        footer: '<button class="btn" data-close>取消</button><button class="btn ' + (opt.danger ? 'btn-primary' : 'btn-primary') + '" data-ok>' + esc(opt.okText || '确定') + '</button>'
      });
      m.body.parentNode.querySelector('[data-ok]').addEventListener('click', function () { m.close(); resolve(true); });
      m.el.addEventListener('click', function (e) {
        if (e.target.hasAttribute && e.target.hasAttribute('data-close')) resolve(false);
      });
      m.el.querySelector('.modal-close').addEventListener('click', function () { resolve(false); });
    });
  };

  /* ===================== Toast ===================== */
  UI.toast = function (msg, type) {
    var wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .25s';
      t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }, type === 'err' ? 4200 : 2400);
  };

  /* ===================== 复制 / 下载 ===================== */
  UI.copy = function (text, okMsg) {
    var done = function () { UI.toast(okMsg || '已复制到剪贴板', 'ok'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { UI.toast('复制失败，请手动选择文本', 'err'); }
      document.body.removeChild(ta);
    }
  };

  /* ===================== 风险等级标签 ===================== */
  UI.riskTag = function (level, withTip) {
    var map = { high: ['tag-high', '高'], mid: ['tag-mid', '中'], low: ['tag-low', '低'] };
    var m = map[level] || ['tag-gray', '—'];
    return '<span class="tag ' + m[0] + '">' + m[1] + '</span>' + (withTip ? ' ' + UI.info('参考风险等级，需人工复核后定级') : '');
  };
  UI.bandTag = function (band) {
    return '<span class="tag tag-' + (band.level === 'low' ? 'low' : band.level === 'mid' ? 'mid' : 'high') + '">' + esc(band.label) + '</span>';
  };
  UI.chainTag = function (status) {
    var cls = status === '疑似回流' ? 'tag-high' : status === '断点' ? 'tag-mid' : 'tag-low';
    return '<span class="tag ' + cls + '">' + esc(status) + '</span>';
  };
  UI.crossTag = function (status) {
    var cls = status === '基本匹配' ? 'tag-low' : status === '有资金无业务' ? 'tag-high' : 'tag-mid';
    return '<span class="tag ' + cls + '">' + esc(status) + '</span>';
  };

  /* ===================== 分数进度条 ===================== */
  UI.scoreBar = function (score, max) {
    var pct = Math.min(100, (U.num(score) / (max || 5)) * 100);
    var color = score >= 4 ? '#D93025' : score >= 2.5 ? '#E8A317' : '#6D4AFF';
    return '<div class="score-bar"><span class="track"><i style="width:' + pct.toFixed(1) + '%;background:' + color + '"></i></span>' +
      '<span class="val">' + (typeof score === 'number' ? score.toFixed(2).replace(/\.00$/, '') : score) + '</span></div>';
  };

  /* ===================== 日期工具 ===================== */
  UI.now = function () { return U.fmtDateTime(new Date()); };

  App.ui = UI;
})(typeof window !== 'undefined' ? window : globalThis);
