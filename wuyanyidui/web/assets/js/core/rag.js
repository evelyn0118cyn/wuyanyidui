/* =============================================================
 * 财务舞弊111 · 知识库检索（rag）
 * 轻量本地检索：中文 2-gram + BM25 打分，不依赖外部向量库，file:// 可用。
 * 仅检索内置的方法论/释义/用语规范，不含企业制度条款。
 * ============================================================= */
(function (global) {
  'use strict';
  var App = global.App = global.App || {};

  var RAG = {};
  var DOCS = null;
  var INDEX = null;

  /* 中文按 2-gram 切分 + 英文数字按词切分 */
  function tokenize(text) {
    var s = String(text || '').toLowerCase();
    var tokens = [];
    var re = /[\u4e00-\u9fa5]+|[a-z0-9σ]+/g;
    var m;
    while ((m = re.exec(s))) {
      var w = m[0];
      if (/^[\u4e00-\u9fa5]+$/.test(w)) {
        if (w.length === 1) tokens.push(w);
        else for (var i = 0; i < w.length - 1; i++) tokens.push(w.substr(i, 2));
      } else {
        tokens.push(w);
        if (w.length > 3) tokens.push(w.substr(0, 3));
      }
    }
    return tokens;
  }

  function buildIndex(docs) {
    var df = Object.create(null);
    var postings = Object.create(null);
    var docLen = [];
    docs.forEach(function (d, di) {
      var text = [d.title, d.type, (d.keys || []).join(' '), d.content].join(' ');
      var toks = tokenize(text);
      docLen[di] = toks.length;
      var tf = Object.create(null);
      toks.forEach(function (t) { tf[t] = (tf[t] || 0) + 1; });
      Object.keys(tf).forEach(function (t) {
        df[t] = (df[t] || 0) + 1;
        (postings[t] = postings[t] || []).push({ doc: di, tf: tf[t] });
      });
      d._len = toks.length;
    });
    var avgdl = docLen.length ? docLen.reduce(function (a, b) { return a + b; }, 0) / docLen.length : 1;
    return { df: df, postings: postings, avgdl: avgdl, n: docs.length, docLen: docLen };
  }

  /* 知识库路径候选：页面在 /web/ 下，数据在项目根的 /data/ 下。
     - 通过本地服务打开：'../data/knowledge/fraud-kb.json'
     - 直接双击 file:// 打开：同样可用（相对 web/index.html 的上级目录）
     - 若把 index.html 与 data 放在同一目录，'data/...' 也命中 */
  var KB_CANDIDATES = ['../data/knowledge/fraud-kb.json', 'data/knowledge/fraud-kb.json'];

  RAG.load = function (docs) {
    if (docs) { DOCS = docs; INDEX = null; return true; }
    if (DOCS) return true;
    /* 路径 1：内嵌副本（kb-embedded.js）。
       file:// 下浏览器禁止 XHR 读取本地 JSON（CORS），因此内嵌副本是离线模式的主路径。 */
    var eb = global.App && global.App.embeddedKB;
    if (eb && eb.docs && eb.docs.length) {
      DOCS = eb.docs;
      return true;
    }
    /* 路径 2：同步读取 JSON 文件（http:// 提供静态服务时可用） */
    if (typeof XMLHttpRequest === 'undefined') { DOCS = []; return false; }
    if (isFileProtocol()) { DOCS = []; return false; }
    for (var i = 0; i < KB_CANDIDATES.length; i++) {
      var text = syncGet(KB_CANDIDATES[i]);
      if (text && text.length > 2) {
        try {
          var j = JSON.parse(text);
          DOCS = (j && j.docs) || [];
          if (DOCS.length) { KB_PATH = KB_CANDIDATES[i]; return true; }
        } catch (e) {
          if (typeof console !== 'undefined') console.warn('[rag] 知识库 JSON 解析失败：', e && e.message);
        }
      }
    }
    DOCS = DOCS || [];
    return false;
  };

  var KB_PATH = KB_CANDIDATES[0];

  function isFileProtocol() {
    try { return typeof location !== 'undefined' && location.protocol === 'file:'; } catch (e) { return false; }
  }

  function syncGet(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      try { xhr.overrideMimeType('application/json'); } catch (e) { /* 忽略 */ }
      xhr.send(null);
      var t = xhr.responseText || '';
      /* 404 时服务端会返回 JSON 错误体，长度很短，交由上层判断 */
      if ((xhr.status === 200 || xhr.status === 0) && t.length > 2 && t.indexOf('"docs"') >= 0) return t;
      return '';
    } catch (e) {
      return '';
    }
  }

  /* 异步兜底加载（同步读取失败时由 App.boot 调用）。
     file:// 下 fetch 同样受 CORS 限制，直接跳过以免控制台报错。 */
  RAG.loadAsync = function () {
    if (DOCS && DOCS.length) return Promise.resolve(DOCS.length);
    if (isFileProtocol()) {
      DOCS = DOCS || [];
      if (!DOCS.length && typeof console !== 'undefined') {
        console.info('[rag] 当前为 file:// 离线模式且无内嵌知识库副本，方法论问答不可用。请双击 start.bat 或运行 node tools/build-embedded-kb.js。');
      }
      return Promise.resolve(0);
    }
    var tryOne = function (idx) {
      if (idx >= KB_CANDIDATES.length) { DOCS = DOCS || []; return 0; }
      return fetch(KB_CANDIDATES[idx])
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          DOCS = (j && j.docs) || [];
          if (DOCS.length) { KB_PATH = KB_CANDIDATES[idx]; INDEX = null; return DOCS.length; }
          return tryOne(idx + 1);
        })
        .catch(function () { return tryOne(idx + 1); });
    };
    return Promise.resolve(tryOne(0)).then(function (n) {
      if (!n && typeof console !== 'undefined') console.warn('[rag] 知识库未能加载，方法论问答将不可用。');
      return n;
    });
  };

  RAG.docs = function () { RAG.load(); return DOCS || []; };

  /**
   * 检索
   * @param {string} query
   * @param {number} topK
   * @returns [{id,title,type,content,score}]
   */
  RAG.search = function (query, topK) {
    RAG.load();
    if (!DOCS || !DOCS.length) return [];
    if (!INDEX) INDEX = buildIndex(DOCS);
    var qToks = tokenize(query);
    if (!qToks.length) return [];
    var k1 = 1.5, b = 0.75;
    var scores = [];
    var seen = Object.create(null);
    qToks.forEach(function (q) {
      if (seen[q]) return;
      seen[q] = 1;
      var plist = INDEX.postings[q];
      if (!plist) return;
      var idf = Math.log(1 + (INDEX.n - INDEX.df[q] + 0.5) / (INDEX.df[q] + 0.5));
      plist.forEach(function (p) {
        var tf = p.tf;
        var denom = tf + k1 * (1 - b + b * (INDEX.docLen[p.doc] / INDEX.avgdl));
        var s = idf * (tf * (k1 + 1)) / denom;
        scores[p.doc] = (scores[p.doc] || 0) + s;
      });
    });
    /* 关键词直接命中加权 boost：命中关键词越多、关键词越长，权重越高 */
    var qs = String(query || '');
    DOCS.forEach(function (d, di) {
      var hitCount = 0, hitLen = 0;
      (d.keys || []).forEach(function (k) {
        if (qs.indexOf(k) >= 0) { hitCount++; hitLen += k.length; }
      });
      if (hitCount) scores[di] = (scores[di] || 0) + 2.5 + (hitCount - 1) * 2.0 + hitLen * 0.35;
      if (qs.indexOf(d.title) >= 0) scores[di] = (scores[di] || 0) + 3;
    });
    var out = [];
    Object.keys(scores).forEach(function (di) {
      var d = DOCS[di];
      out.push({ id: d.id, title: d.title, type: d.type, content: d.content, score: Math.round(scores[di] * 1000) / 1000 });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, topK || 3);
  };

  /** 检索并拼接为可注入大模型的上下文 */
  RAG.context = function (query, topK) {
    var hits = RAG.search(query, topK || 3);
    if (!hits.length) return { text: '', hits: [] };
    var text = hits.map(function (h, i) {
      return '【资料' + (i + 1) + '·' + h.type + '】' + h.title + '\n' + h.content;
    }).join('\n\n');
    return { text: text, hits: hits };
  };

  App.rag = RAG;
})(typeof window !== 'undefined' ? window : globalThis);
