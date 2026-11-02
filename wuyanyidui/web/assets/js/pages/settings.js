/* =============================================================
 * 页面：设置（F7 偏好记忆与口径校验）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util, UI = App.ui;
  App.pages = App.pages || {};

  App.pages.settings = {
    render: function (mount) {
      var mem = App.memory.load();
      var srv = App.state.server || {};
      var h = [];

      h.push(UI.divisionBar('助理辅助：记忆 / 回显 / 提示　｜　人工决策：口径最终确认'));

      /* 记忆开关 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">偏好记忆<span class="sub">记住常用口径以减少重复配置</span></div></div>');
      h.push('<div class="flex-gap"><label class="switch"><input type="checkbox" id="swMem2"' + (mem.enabled ? ' checked' : '') +
        '><span class="track"></span><span>启用偏好记忆</span></label>' +
        '<span class="small muted">记忆只保存在本浏览器 localStorage，不会上传。</span></div>');
      h.push('<div class="mt14">' + UI.alert('每次分析开始前，页面顶部都会回显本次使用的口径并提示来源（记忆 / 默认）。口径变更后，历史分析结果不可直接比较。', 'info') + '</div>');
      h.push('</div>');

      /* 口径明细 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">当前记忆内容</div>' +
        '<div class="card-actions"><button class="btn btn-sm" id="btnEditTh2">修改阈值</button>' +
        '<button class="btn btn-sm" id="btnResetAll">恢复默认</button>' +
        '<button class="btn btn-sm btn-danger-ghost" id="btnClearAll">清空记忆</button></div></div>');
      var rows = [
        ['记忆开关', mem.enabled ? '<span class="pass">已启用</span>' : '已关闭'],
        ['常用统计期间', (mem.period && (mem.period.start || mem.period.end)) ? (UI.esc(mem.period.start) + ' ~ ' + UI.esc(mem.period.end)) : '全量'],
        ['统计口径', '3σ（σ×' + mem.thresholds.sigma + '）+ IQR×' + mem.thresholds.iqrK + ' + MAD>' + mem.thresholds.madZ],
        ['R01 大额', U.moneyRaw(mem.thresholds.R01_large_amount) + ' 元'],
        ['R02 整数', (mem.thresholds.R02_round_amount / 10000) + ' 万整数倍'],
        ['R03 拆分', mem.thresholds.R03_split_window_days + ' 日累计 ≥ ' + U.moneyRaw(mem.thresholds.R03_split_total) + '，单笔 < ' + U.moneyRaw(mem.thresholds.R03_split_single_max)],
        ['R04 期末', '最后 ' + mem.thresholds.R04_period_end_days + ' 日且 ≥ ' + U.moneyRaw(mem.thresholds.R04_period_end_amount)],
        ['R06 高频', '单月 > 历史月均 × ' + mem.thresholds.R06_freq_multiple],
        ['R07 对冲', '金额差 ≤ ' + (mem.thresholds.R07_hedge_ratio * 100) + '%，窗口 ' + mem.thresholds.R07_hedge_days + ' 天'],
        ['R08 夜间', mem.thresholds.R08_night_start + ':00 – ' + mem.thresholds.R08_night_end + ':00'],
        ['关注舞弊类型', (mem.fraudTypes || []).map(function (c) {
          var f = App.config.FRAUD_TYPES.filter(function (x) { return x.code === c; })[0];
          return f ? f.name : c;
        }).join('、') || '全部'],
        ['白名单', (mem.whitelist || []).join('、') || '<span class="muted">无</span>'],
        ['报告模板', UI.esc((mem.reportTemplate && mem.reportTemplate.title) || '默认')],
        ['口径历史', (mem.history || []).length + ' 条（最多保留 10 条）']
      ];
      h.push(rows.map(function (r) {
        return '<div class="mem-row"><span class="mem-k">' + r[0] + '</span><span class="mem-v">' + r[1] + '</span></div>';
      }).join(''));
      h.push('</div>');

      /* 关注舞弊类型 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">关注的舞弊类型<span class="sub">仅对勾选类型做信号映射与评分</span></div>' +
        '<div class="card-actions"><button class="btn btn-sm" id="btnSaveTypes">保存</button></div></div>');
      h.push('<div class="flex-gap">');
      App.config.FRAUD_TYPES.forEach(function (f) {
        var on = (mem.fraudTypes || []).indexOf(f.code) >= 0;
        h.push('<label class="switch" style="margin-right:18px"><input type="checkbox" data-type="' + f.code + '"' + (on ? ' checked' : '') +
          '><span class="track"></span><span title="' + UI.esc(f.desc) + '">' + UI.esc(f.name) + '</span></label>');
      });
      h.push('</div></div>');

      /* 大模型 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">大模型与本地代理<span class="sub">API Key 由服务端持有</span></div>' +
        '<div class="card-actions"><button class="btn btn-sm" id="btnApi2">大模型API设置</button>' +
        '<button class="btn btn-sm" id="btnRecon">重新检测连接</button></div></div>');
      h.push('<div class="mem-row"><span class="mem-k">本地代理</span><span class="mem-v">' +
        (srv.online ? '<span class="pass">已连接</span> ' + UI.esc(srv.base) : '<span class="fail">未连接</span> ' + UI.esc(srv.base || App.llm.serverBase())) + '</span></div>');
      h.push('<div class="mem-row"><span class="mem-k">模型</span><span class="mem-v">' + UI.esc(srv.model || 'deepseek-flash') + '　' +
        (srv.llmConfigured ? '<span class="pass">Key 已配置</span>' : '<span class="fail">Key 未配置（使用本地模式）</span>') + '</span></div>');
      h.push('<div class="mt8 small muted">配置方式：编辑项目根目录 <span class="mono">.env</span> 中的 <span class="mono">FRAUD111_LLM_KEY</span>，然后重新运行 start.bat。' +
        '前端永远不接触 Key，也不会把它写入 localStorage。</div>');
      h.push('</div>');

      /* 数据与合规 */
      h.push('<div class="card"><div class="card-head"><div class="card-title">安全与合规说明</div></div>');
      h.push('<ul class="small" style="line-height:1.9;padding-left:20px;margin:0">' +
        '<li>数据默认在<b>浏览器本地</b>处理，上传的 Excel/CSV 不会上传到任何服务器。</li>' +
        '<li>本地代理只监听 <span class="mono">127.0.0.1</span>，不会暴露到局域网或互联网。</li>' +
        '<li>大模型调用经服务端转发；发送给模型的内容仅为问题、必要的结构化摘要（笔数、金额、规则编号），不含完整原始流水与个人身份证号。</li>' +
        '<li>内置知识库<b>不含企业制度条款与法规条文</b>；涉及合规制度的判断，请由岗位人员对照现行制度确认。</li>' +
        '<li>所有报告输出强制附带声明：本报告为辅助分析，不替代调查结论。</li>' +
        '</ul></div>');

      h.push('<div class="card"><div class="card-head"><div class="card-title">关于</div></div>' +
        '<div class="small muted" style="line-height:1.9">财务舞弊111 · v' + App.config.VERSION +
        '　｜　舞弊审计调查岗位 AI 助理<br>七类舞弊 · 九条识别规则 · 三口径统计异常 · 四类关联核查 · 十节报告结构</div></div>');

      mount.innerHTML = h.join('');

      /* 事件 */
      mount.querySelector('#swMem2').addEventListener('change', function (e) {
        App.memory.save({ enabled: e.target.checked });
        UI.toast('偏好记忆已' + (e.target.checked ? '启用' : '关闭'), 'ok');
        App.refreshTopbar();
      });
      mount.querySelector('#btnEditTh2').addEventListener('click', function () { App.pages.risk.openThresholds(); });
      mount.querySelector('#btnResetAll').addEventListener('click', function () {
        UI.confirm({ title: '恢复默认', body: '将所有阈值、白名单恢复为系统默认值（保留记忆开关状态）。是否继续？', okText: '恢复默认' }).then(function (ok) {
          if (!ok) return;
          var d = App.memory.defaults();
          App.memory.save({ thresholds: d.thresholds, whitelist: [], period: d.period, scoreWeights: {} });
          App.go('settings');
          UI.toast('已恢复默认口径', 'ok');
        });
      });
      mount.querySelector('#btnClearAll').addEventListener('click', function () {
        UI.confirm({ title: '清空记忆', body: '将清除所有记住的设置。是否继续？', okText: '清空' }).then(function (ok) {
          if (!ok) return;
          App.memory.clear();
          App.go('settings');
          UI.toast('记忆已清空', 'ok');
        });
      });
      mount.querySelector('#btnSaveTypes').addEventListener('click', function () {
        var arr = [];
        Array.prototype.forEach.call(mount.querySelectorAll('[data-type]'), function (inp) {
          if (inp.checked) arr.push(inp.getAttribute('data-type'));
        });
        if (!arr.length) { UI.toast('至少选择一类舞弊', 'warn'); return; }
        App.memory.save({ fraudTypes: arr });
        UI.toast('已保存关注的舞弊类型（' + arr.length + ' 类）', 'ok');
      });
      mount.querySelector('#btnApi2').addEventListener('click', function () { App.openApiSettings(); });
      mount.querySelector('#btnRecon').addEventListener('click', function () {
        App.detectServer().then(function (st) {
          UI.toast(st.online ? '本地代理已连接' : '本地代理未连接', st.online ? 'ok' : 'warn');
          App.go('settings');
        });
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
