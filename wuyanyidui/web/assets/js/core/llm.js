/* =============================================================
 * 财务舞弊111 · 大模型能力（llm）
 *  - 通过本地代理 /api/llm 转发到 DeepSeek（Key 由服务端注入，前端不落盘）
 *  - 未启动代理 / 未配置 Key 时降级为「本地模式」：用内置规则与知识库生成可用的
 *    解释与摘要，不假装是模型输出（界面会明确标注"本地模式"）
 *  - 所有模型输出经过安全过滤（禁用语改写 + 越界提示）
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};
  var U = App.util;

  var LLM = {};

  /* ---------- 服务端代理地址探测 ---------- */
  LLM.serverBase = function () {
    /* 通过 http(s) 打开时，同源即代理；通过 file:// 打开时默认本地 5178 */
    try {
      if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
    } catch (e) {}
    return 'http://127.0.0.1:5178';
  };

  LLM.status = function () {
    return new Promise(function (resolve) {
      var base = LLM.serverBase();
      var done = false;
      var finish = function (val) { if (!done) { done = true; resolve(val); } };
      setTimeout(function () { finish({ online: false, base: base, reason: '本地代理未响应（请双击 start.bat 启动）' }); }, 2500);
      try {
        fetch(base + '/api/health', { method: 'GET' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            finish({
              online: true, base: base,
              llmConfigured: !!(j.llm && j.llm.configured),
              model: (j.llm && j.llm.model) || '',
              database: !!(j.database && j.database.connected),
              version: j.version || ''
            });
          })
          .catch(function () { finish({ online: false, base: base, reason: '本地代理未响应（请双击 start.bat 启动）' }); });
      } catch (e) {
        finish({ online: false, base: base, reason: '当前环境不支持 fetch' });
      }
    });
  };

  /* ---------- 系统提示词（岗位边界 + 合规约束） ---------- */
  var SYSTEM_PROMPT = [
    '你是「财务舞弊111」——舞弊审计调查岗位的 AI 助理，服务于金融业内控合规、审计辅助与财务分析场景下的舞弊调查人员。',
    '',
    '【定位】你是辅助而非替代。你不做出任何舞弊认定、不形成调查结论、不评价个人责任、不替代岗位人员的专业判断。',
    '你负责"提示与整理"，岗位人员负责"判断与决定"。每一条输出都必须可回溯、可复核、可推翻，并明确标注需要人工确认的内容。',
    '',
    '【硬性边界——必须遵守】',
    '1. 不得输出"构成舞弊""存在舞弊行为""建议立案调查""建议处理某人""认定为舞弊"等结论性或处置性表述。',
    '2. 不得对自然人做品行、动机、责任的主观评价。',
    '3. 涉及合规制度的判断，只能提示"需人工对照现行制度确认"，不得引用或臆造任何制度条款、法规条文编号。',
    '4. 证据链只能输出"证据缺口清单 + 待核实事项"，不得宣称证据链已闭合。',
    '5. 不得编造数据：只能使用给定数据中出现的事实与数字；数据不足时明确说"现有数据不足以判断"。',
    '',
    '【正确表述示例】',
    '- 该笔交易触发 X 项风险信号，建议人工核查。',
    '- 该供应商关联关系命中 X 项特征，建议人工确认工商信息。',
    '- 综合参考风险分值 X 分，处于待核实区间，需人工复核后定级。',
    '',
    '【输出风格】简洁、结构化、要点化；先给结论性摘要（标注"参考"），再列依据与待核实事项；中文简体；不使用夸张修辞。'
  ].join('\n');

  /**
   * 通用对话（流式）。
   * @param {object} opt {messages|prompt, ragQuery, onDelta, onDone, onError, temperature, maxTokens, useRag}
   * @returns {Promise<{text, mode:'llm'|'local', guardrails}>}
   */
  LLM.chat = function (opt) {
    opt = opt || {};
    var messages = opt.messages;
    if (!messages) {
      var ctxText = '';
      var hits = [];
      if (opt.useRag !== false && opt.ragQuery) {
        var rg = App.rag.context(opt.ragQuery, opt.topK || 3);
        ctxText = rg.text; hits = rg.hits;
      }
      var userContent = (ctxText ? '【可参考资料】\n' + ctxText + '\n\n' : '') + (opt.prompt || '');
      messages = [{ role: 'system', content: SYSTEM_PROMPT }];
      if (opt.history && opt.history.length) {
        opt.history.slice(-6).forEach(function (h) { messages.push({ role: h.role, content: h.content }); });
      }
      messages.push({ role: 'user', content: userContent });
      opt._ragHits = hits;
    } else if (!messages.some(function (m) { return m.role === 'system'; })) {
      messages = [{ role: 'system', content: SYSTEM_PROMPT }].concat(messages);
    }

    var base = LLM.serverBase();
    var accum = '';
    var accumReasoning = '';

    return new Promise(function (resolve) {
      var settled = false;
      var done = function (res) {
        if (settled) return;
        settled = true;
        var guard = U.assertSafeText(res.text || '');
        res.guardrails = guard;
        if (!guard.ok) res.text = U.sanitizeText(res.text || '');
        if (opt.onDone) opt.onDone(res);
        resolve(res);
      };

      if (LLM._disabled) {
        var local = LLM.localAnswer(opt);
        local.mode = 'local';
        return done(local);
      }

      var body = JSON.stringify({
        model: opt.model || undefined,
        messages: messages,
        temperature: opt.temperature === undefined ? 0.3 : opt.temperature,
        max_tokens: opt.maxTokens || 3000,
        stream: true
      });

      fetch(base + '/api/llm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body })
        .then(function (resp) {
          if (!resp.ok) {
            return resp.text().then(function (t) {
              throw new Error('代理返回 ' + resp.status + '：' + String(t).slice(0, 200));
            });
          }
          var ctype = resp.headers.get('content-type') || '';
          if (ctype.indexOf('text/event-stream') < 0) {
            return resp.json().then(function (j) {
              if (!j.ok) throw new Error(j.error || '模型调用失败');
              accum = j.text || '';
              if (opt.onDelta && accum) opt.onDelta(accum);
              done({ text: accum, mode: 'llm', ragHits: opt._ragHits || [] });
            });
          }
          /* SSE 流式解析：deepseek-flash 为推理模型，先后输出 reasoning_content（思考过程）
             再输出 content（正文）。思考过程单独回调以便界面展示"正在思考"，不混入正文。 */
          return readSSE(resp, function (payload) {
            var delta = '', reasoning = '';
            try {
              var obj = JSON.parse(payload);
              if (obj.choices && obj.choices[0]) {
                var dlt = obj.choices[0].delta || {};
                delta = dlt.content || '';
                reasoning = dlt.reasoning_content || '';
                if (!delta && !reasoning && obj.choices[0].message) delta = obj.choices[0].message.content || '';
              }
              if (obj.error) throw new Error(obj.error.message || '模型返回错误');
            } catch (e) { /* 非 JSON 行忽略 */ }
            if (reasoning) {
              accumReasoning += reasoning;
              if (opt.onReasoning) opt.onReasoning(accumReasoning);
            }
            if (delta) {
              accum += delta;
              if (opt.onDelta) opt.onDelta(accum);
            }
          }).then(function () {
            /* 推理模型可能在 token 预算耗尽时只输出思考过程而无正文：
               此时降级为本地模式，避免界面出现空白回答。 */
            if (!accum.trim()) {
              var local0 = LLM.localAnswer(opt);
              local0.mode = 'local';
              local0.fallbackReason = '模型仅返回了思考过程、未产出正文（可能 token 预算不足），已改用本地模式';
              return done(local0);
            }
            done({ text: accum, mode: 'llm', reasoning: accumReasoning, ragHits: opt._ragHits || [] });
          });
        })
        .catch(function (err) {
          /* 降级为本地模式 */
          var local = LLM.localAnswer(opt);
          local.mode = 'local';
          local.fallbackReason = err && err.message ? err.message : '模型不可用';
          done(local);
        });
    });
  };

  /* SSE 流读取（兼容无 getReader 的环境） */
  function readSSE(resp, onEvent) {
    if (!resp.body || !resp.body.getReader) {
      return resp.text().then(function (t) {
        t.split(/\n\n/).forEach(function (chunk) {
          chunk.split('\n').forEach(function (line) {
            var m = line.match(/^data:\s*(.*)$/);
            if (m && m[1] && m[1] !== '[DONE]') onEvent(m[1]);
          });
        });
      });
    }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        buffer += decoder.decode(r.value, { stream: true });
        var parts = buffer.split('\n\n');
        buffer = parts.pop();
        parts.forEach(function (chunk) {
          chunk.split('\n').forEach(function (line) {
            var m = line.match(/^data:\s*(.*)$/);
            if (m && m[1] && m[1].trim() !== '[DONE]') onEvent(m[1]);
          });
        });
        return pump();
      });
    }
    return pump();
  }

  /* ---------- 本地模式：基于规则与知识库生成可用回答 ---------- */
  LLM.localAnswer = function (opt) {
    var task = opt.localTask || 'generic';
    var ctx = opt.localContext || {};
    var q = opt.ragQuery || opt.prompt || '';
    var rg = App.rag.context(q, 2);
    var lines = [];
    lines.push('【本地模式】未检测到可用的大模型服务（请双击 start.bat 启动本地代理，并在「大模型API设置」中配置 Key）。以下内容由内置规则与知识库生成，仅供参考。');
    lines.push('');

    if (task === 'explain_signal' && ctx.signal) {
      var s = ctx.signal;
      lines.push('### 信号解读（参考）');
      lines.push('- 交易：' + s.txn_date + ' ' + (s.txn_time || '') + '，' + s.direction + ' ' + U.money(s.amount) + '，对手方「' + s.counterparty + '」，用途「' + (s.purpose || '未注明') + '」。');
      lines.push('- 命中规则：' + s.rules.map(function (r) { return r.code + ' ' + r.detail; }).join('；') + '。');
      if (s.statHit) lines.push('- 统计偏离：命中 ' + s.statReasons.join('/') + ' 口径，Z 值 ' + s.statZ + '。');
      lines.push('- 主要指向：' + (s.primaryFraud === 'fake_transaction' ? '虚构交易' : s.primaryFraud) + '（规则映射结果，非定性）。');
      lines.push('- 待核实事项：核实该笔资金对应的合同与交付凭证；确认审批与授权链；核实对手方与本方的业务往来历史。');
      lines.push('- 该笔交易触发 ' + s.ruleCodes.length + ' 项风险信号，建议人工核查，并由调查人员判断异常是否有合理解释。');
    } else if (task === 'explain_clue' && ctx.clue) {
      var c = ctx.clue;
      lines.push('### 线索摘要（参考）');
      lines.push('- 线索 ' + c.id + '：对手方「' + c.counterparty + '」，事项「' + c.matter + '」，涉及 ' + c.txnCount + ' 笔、累计 ' + U.money(c.amount) + '。');
      lines.push('- 命中规则：' + c.ruleCodes.join('/') + '；资金链路状态：' + c.chain.status + '；业务支撑：' + c.cross.status + '。');
      lines.push('- 排序理由：' + c.reasons.join('；') + '。');
      lines.push('- 建议核查方向：' + c.directions.join('；') + '。');
    } else if (task === 'explain_score' && ctx.scorecard) {
      var sc = ctx.scorecard;
      lines.push('### 评分解释（参考）');
      lines.push('- 综合参考分值 ' + sc.overall + ' 分，区间：' + sc.overallText + '。');
      sc.cards.forEach(function (cd) {
        lines.push('- ' + cd.name + '：' + cd.total + ' 分（' + cd.band.text + '）。' + (cd.explain ? cd.explain.why : ''));
      });
      lines.push('- 以上分值与区间为参考值，需人工复核后定级。');
    } else if (rg.text) {
      lines.push('### 相关知识（来自内置知识库，命中 ' + rg.hits.length + ' 条）');
      rg.hits.forEach(function (h) { lines.push('- 【' + h.type + '】' + h.title + '：' + String(h.content).slice(0, 220) + '…'); });
      lines.push('');
      lines.push('如需更完整的自然语言分析，请启动本地代理并配置大模型 API。');
    } else {
      lines.push('可以在「工作台」选择本次要处理的数据并开始分析；或到「风险信号识别」「线索台账」「关联方核查」「评分评估」页查看结构化结果。');
      lines.push('如需询问方法论（如"3σ 怎么算""四流合一是什么"），可直接提问，我会从内置知识库检索。');
    }
    return { text: lines.join('\n'), mode: 'local', ragHits: rg.hits };
  };

  /* ---------- 便捷封装：解释信号 / 线索 / 评分 / 报告润色 ---------- */
  LLM.explainSignal = function (signal, opt) {
    opt = opt || {};
    var prompt = '请解读下面这一笔风险信号，说明它为什么值得关注、可能指向什么类型的舞弊风险（仅作提示）、以及需要人工核实哪些事项。\n\n' +
      '交易：' + signal.txn_date + ' ' + (signal.txn_time || '') + '，方向' + signal.direction + '，金额 ' + U.moneyRaw(signal.amount) + ' 元，对手方「' + signal.counterparty + '」，用途「' + (signal.purpose || '未注明') + '」，凭证号 ' + (signal.voucher_no || '无') + '。\n' +
      '命中规则：\n' + signal.rules.map(function (r) { return '- ' + r.code + ' ' + r.name + '：' + r.detail + '（' + r.evidence + '）'; }).join('\n') + '\n' +
      '统计偏离：' + (signal.statHit ? '命中 ' + signal.statReasons.join('/') + '，Z=' + signal.statZ : '未命中统计离群') + '\n' +
      '参考风险等级：' + signal.riskLabel + '（参考值，需人工复核）\n' +
      '疑似舞弊类型（规则映射）：' + signal.fraudTypes.join('、') + '\n\n' +
      '要求：500 字以内，分小节；结尾必须提醒"以上为参考，最终判断由调查人员作出"。';
    return LLM.chat({
      prompt: prompt, ragQuery: '信号解读 ' + signal.ruleCodes.join(' ') + ' ' + signal.primaryFraud,
      localTask: 'explain_signal', localContext: { signal: signal },
      onDelta: opt.onDelta
    });
  };

  LLM.explainClue = function (clue, opt) {
    opt = opt || {};
    var prompt = '请为下面这条线索写一段核查摘要（150–300 字），包含：线索要点、资金链路与业务支撑状态、证据缺口、建议核查方向。\n\n' +
      '线索编号：' + clue.id + '\n对手方：' + clue.counterparty + '\n事项：' + clue.matter + '\n' +
      '涉及笔数：' + clue.txnCount + '，累计金额：' + U.moneyRaw(clue.amount) + ' 元，时间跨度：' + clue.dateStart + ' ~ ' + clue.dateEnd + '\n' +
      '命中规则：' + clue.ruleCodes.join('/') + '\n资金链路：' + clue.chain.status + '（' + clue.chain.notes.join('；') + '）\n' +
      '业务支撑：' + clue.cross.status + '（缺口：' + (clue.cross.gaps.join('；') || '无') + '）\n' +
      '四流情况：' + clue.fourFlow.conclusion + '\n' +
      '关联方命中：' + (clue.relatedHit ? clue.relatedType : '否') + '\n' +
      '参考优先级：' + clue.priority + '（' + clue.priorityLevel + '，参考值需人工复核）\n\n' +
      '要求：不要下结论，不要使用"构成舞弊"等表述。';
    return LLM.chat({
      prompt: prompt, ragQuery: '线索核查 资金链路 四流合一 ' + clue.matter,
      localTask: 'explain_clue', localContext: { clue: clue },
      onDelta: opt.onDelta
    });
  };

  LLM.explainScore = function (sc, opt) {
    opt = opt || {};
    var body = sc.cards.map(function (c) {
      return c.name + '：' + c.total + ' 分（' + c.band.text + '）\n' +
        c.dims.map(function (d) { return '  - ' + d.label + '：' + d.score + '/5，权重 ' + d.weight + '%，依据：' + d.rawText; }).join('\n');
    }).join('\n');
    var prompt = '请解释下面这份舞弊可能性参考评分，重点说明：(1) 哪些维度把分数拉高、哪些拉低；(2) 分数的局限性与可能的误判原因；(3) 建议人工优先复核什么。\n\n' + body +
      '\n\n综合参考分值：' + sc.overall + '（' + sc.overallText + '）\n要求：结尾必须写"以上分值与区间为参考值，需人工复核后定级"。';
    return LLM.chat({
      prompt: prompt, ragQuery: '评分卡 加权 参考区间 局限性',
      localTask: 'explain_score', localContext: { scorecard: sc },
      onDelta: opt.onDelta
    });
  };

  /** 报告叙述段润色（仅补充文字，不改动任何数字与强制声明） */
  LLM.composeReportSection = function (payload, opt) {
    opt = opt || {};
    var prompt = '请基于以下结构化分析结果，撰写调查报告的「主要发现」与「进一步核查建议」两节的正文（共 600 字以内）。\n' +
      '要求：\n1) 每条发现必须附带数据依据（笔数/金额/规则编号）；\n2) 使用"触发风险信号、建议人工核查"等表述，严禁结论性用语；\n' +
      '3) 核查建议只写调查方向，不写处置建议；\n4) 不要编造数据，只能使用下面给定的数字。\n\n' + payload;
    return LLM.chat({
      prompt: prompt, ragQuery: '报告用语 合规表述 舞弊调查分析报告结构',
      maxTokens: 3000, onDelta: opt.onDelta
    });
  };

  App.llm = LLM;
  App.llmSystemPrompt = SYSTEM_PROMPT;
})(typeof window !== 'undefined' ? window : globalThis);
