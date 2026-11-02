/* =============================================================
 * 财务舞弊111 · 本地 API 代理服务（零第三方依赖）
 *
 * 设计要点
 *  - 安全代理架构：大模型 API Key 与 MySQL 口令只在服务端（环境变量/.env）出现，
 *    前端永不落盘、永不经手。
 *  - 只监听 127.0.0.1，并对 Origin 做同源校验，避免被外部页面驱动。
 *  - 静态服务根目录 = 项目根，因此 web/index.html 与 data/ 都能被浏览器读取，
 *    这样即使不走代理，双击 index.html（file://）也能用全部离线分析功能。
 *  - MySQL 接入使用系统自带 mysql/mysqldump 命令（见 /api/db/status 的提示），
 *    未安装时返回明确的可操作提示，不静默失败。
 *
 * 启动：node server/server.js      或双击 start.bat
 * ============================================================= */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.FRAUD111_PORT || process.env.PORT || 5178);
const HOST = '127.0.0.1';
const VERSION = '1.0.0';

/* ---------------- .env 加载（不覆盖已有环境变量） ---------------- */
(function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch (e) { /* 忽略解析错误 */ }
})();

/* ---------------- 配置 ---------------- */
const CFG = {
  get llmKey() {
    return process.env.FRAUD111_LLM_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
  },
  get llmBase() {
    return (process.env.FRAUD111_LLM_BASE || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
  },
  get llmModel() {
    return process.env.FRAUD111_LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  },
  get db() {
    return {
      host: process.env.FRAUD111_DB_HOST || process.env.MYSQL_HOST || '127.0.0.1',
      port: process.env.FRAUD111_DB_PORT || process.env.MYSQL_PORT || '3306',
      user: process.env.FRAUD111_DB_USER || process.env.MYSQL_USER || 'root',
      password: process.env.FRAUD111_DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
      database: process.env.FRAUD111_DB_NAME || process.env.MYSQL_DATABASE || ''
    };
  }
};

/* ---------------- 工具 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.bat': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
};

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function readBody(req, limitBytes) {
  limitBytes = limitBytes || 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('请求体过大（>8MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

/* 防止路径穿越 */
function safeJoin(rootDir, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const p = path.normalize(path.join(rootDir, decoded));
  const rel = path.relative(rootDir, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return p;
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '') rel = '/web/index.html';
  let filePath = safeJoin(ROOT, rel);
  if (!filePath) return sendJSON(res, 403, { ok: false, error: '非法路径' });

  fs.stat(filePath, (err, st) => {
    if (!err && st.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      return fs.stat(filePath, (e2, s2) => {
        if (e2) return notFound(res);
        streamFile(res, filePath, s2.size);
      });
    }
    if (err) return notFound(res);
    streamFile(res, filePath, st.size);
  });

  function streamFile(res2, fp, size) {
    const ext = path.extname(fp).toLowerCase();
    res2.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(fp).pipe(res2);
  }
  function notFound(res2) {
    /* 页面路由回退到 index.html（单页应用） */
    if (!path.extname(pathname)) {
      const idx = path.join(ROOT, 'web', 'index.html');
      if (fs.existsSync(idx)) {
        const body = fs.readFileSync(idx);
        res2.writeHead(200, { 'Content-Type': MIME['.html'], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
        return res2.end(body);
      }
    }
    sendJSON(res2, 404, { ok: false, error: '未找到资源：' + pathname });
  }
}

/* ---------------- /api/health ---------------- */
function handleHealth(req, res) {
  const key = CFG.llmKey;
  sendJSON(res, 200, {
    ok: true,
    name: '财务舞弊111',
    version: VERSION,
    node: process.version,
    llm: {
      configured: !!key,
      keyMasked: key ? key.slice(0, 6) + '****' + key.slice(-4) : '',
      model: CFG.llmModel,
      base: CFG.llmBase
    },
    database: {
      connected: false,
      driver: 'mysql-cli',
      configured: !!(CFG.db.database && CFG.db.user),
      note: '数据库连接状态在首次查询时确定'
    },
    time: new Date().toISOString()
  });
}

/* ---------------- /api/llm（转发 + SSE 流） ---------------- */
function handleLLM(req, res) {
  readBody(req).then((body) => {
    const key = CFG.llmKey;
    if (!key) {
      return sendJSON(res, 401, {
        ok: false,
        error: '未配置大模型 API Key。请在项目根目录 .env 中设置 FRAUD111_LLM_KEY，或设置环境变量后重启 start.bat。',
        code: 'NO_API_KEY'
      });
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return sendJSON(res, 400, { ok: false, error: 'messages 不能为空' });

    const payload = JSON.stringify({
      model: body.model || CFG.llmModel,
      messages: messages,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.3,
      max_tokens: body.max_tokens || 1600,
      stream: body.stream !== false
    });

    const target = new URL(CFG.llmBase + '/chat/completions');
    const lib = target.protocol === 'https:' ? https : http;
    const proxyReq = lib.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer ' + key
      },
      timeout: 120000
    }, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        let errBody = '';
        proxyRes.on('data', (d) => { errBody += d; });
        proxyRes.on('end', () => {
          let msg = '模型服务返回 ' + proxyRes.statusCode;
          try {
            const j = JSON.parse(errBody);
            msg += '：' + ((j.error && (j.error.message || j.error.type)) || errBody.slice(0, 300));
          } catch (e) { msg += '：' + errBody.slice(0, 300); }
          sendJSON(res, 502, { ok: false, error: msg });
        });
        return;
      }
      /* 透传 SSE */
      res.writeHead(200, {
        'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*'
      });
      proxyRes.pipe(res);
      proxyRes.on('end', () => { try { res.end(); } catch (e) {} });
    });

    proxyReq.on('timeout', () => { proxyReq.destroy(new Error('模型请求超时（120s）')); });
    proxyReq.on('error', (err) => {
      if (!res.headersSent) sendJSON(res, 502, { ok: false, error: '无法连接模型服务：' + err.message });
      else try { res.end(); } catch (e) {}
    });
    proxyReq.write(payload);
    proxyReq.end();
  }).catch((err) => sendJSON(res, 400, { ok: false, error: err.message }));
}

/* ---------------- MySQL（走 mysql / mysqldump 命令行） ---------------- */
function hasCommand(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, ['--version'], { shell: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve({ ok: false, out: '' }));
    p.on('close', (code) => resolve({ ok: code === 0, out: out.trim() }));
  });
}

function runMysql(sql, opts) {
  opts = opts || {};
  const db = CFG.db;
  const args = ['-h', db.host, '-P', String(db.port), '-u', db.user, '--default-character-set=utf8mb4', '--batch', '-e', sql];
  if (db.database && !opts.noDb) args.push(db.database);
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env);
    if (db.password) env.MYSQL_PWD = db.password;
    const p = spawn('mysql', args, { env, shell: process.platform === 'win32' });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error('无法执行 mysql 命令：' + e.message + '（请安装 MySQL 客户端并加入 PATH）')));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('MySQL 查询失败：' + (err || ('exit ' + code)).slice(0, 500)));
      resolve(out);
    });
  });
}

/* 解析 --batch 输出（TAB 分隔，\N 表示 NULL） */
function parseBatch(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l !== '');
  if (!lines.length) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const o = {};
    headers.forEach((h, i) => {
      const v = cells[i];
      if (v === undefined || v === '\\N' || v === 'NULL') o[h] = null;
      else if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 16) o[h] = Number(v);
      else o[h] = v.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    });
    return o;
  });
}

const ALLOWED_TABLES = ['customers', 'subjects', 'suppliers', 'departments', 'employees', 'bank_accounts', 'gl_ledger', 'gl_vouchers', 'gl_voucher_entries', 'bank_transactions'];

async function handleDBStatus(req, res) {
  const ver = await hasCommand('mysql');
  sendJSON(res, 200, {
    ok: true,
    driver: 'mysql-cli',
    clientInstalled: ver.ok,
    clientVersion: ver.out,
    config: {
      host: CFG.db.host, port: CFG.db.port, user: CFG.db.user,
      database: CFG.db.database, hasPassword: !!CFG.db.password
    },
    hint: ver.ok
      ? (CFG.db.database ? '已检测到 mysql 客户端，可尝试连接' : '请在 .env 中配置 FRAUD111_DB_NAME')
      : '未检测到 mysql 命令行客户端。请安装 MySQL 客户端并加入系统 PATH，或改用「上传 Excel/CSV」方式接入数据。'
  });
}

async function handleDBTables(req, res, query) {
  const ver = await hasCommand('mysql');
  if (!ver.ok) {
    return sendJSON(res, 503, {
      ok: false,
      error: '未检测到 mysql 命令行客户端，无法连接数据库。',
      hint: '请安装 MySQL 客户端（或把 mysql.exe 所在目录加入 PATH）后重启 start.bat；也可改用「上传 Excel/CSV」接入数据。'
    });
  }
  const requested = String(query.tables || ALLOWED_TABLES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const tables = requested.filter((t) => ALLOWED_TABLES.includes(t));
  if (!tables.length) return sendJSON(res, 400, { ok: false, error: 'tables 参数不含受支持的表名' });
  if (!CFG.db.database) return sendJSON(res, 400, { ok: false, error: '未配置数据库名（FRAUD111_DB_NAME）' });

  const data = {}, counts = {};
  try {
    for (const t of tables) {
      const out = await runMysql('SELECT * FROM `' + t + '` LIMIT 20000;');
      data[t] = parseBatch(out);
      counts[t] = data[t].length;
    }
    sendJSON(res, 200, { ok: true, database: CFG.db.database, data, counts });
  } catch (e) {
    sendJSON(res, 502, { ok: false, error: e.message, hint: '请检查 .env 中的数据库连接配置与表结构是否与本项目一致（10 张业务表）。' });
  }
}

/* ---------------- /api/fetch-page（公开工商信息采集，受域名白名单约束） ---------------- */
const FETCH_ALLOW = [
  'gsxt.gov.cn', 'qcc.com', 'tianyancha.com', 'aiqicha.baidu.com',
  'crunchbase.com', 'opencorporates.com', 'wikipedia.org', 'baidu.com', 'cn.bing.com'
];
function handleFetchPage(req, res) {
  readBody(req).then((body) => {
    const target = String(body.url || '');
    if (!/^https?:\/\//i.test(target)) return sendJSON(res, 400, { ok: false, error: 'url 必须为 http(s) 地址' });
    let host;
    try { host = new URL(target).hostname.toLowerCase(); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'url 解析失败' }); }
    if (!FETCH_ALLOW.some((d) => host === d || host.endsWith('.' + d))) {
      return sendJSON(res, 403, {
        ok: false,
        error: '该域名不在采集白名单内（' + host + '）。',
        hint: '出于合规考虑，仅允许采集公开工商信息站点。也可人工上传工商信息文件。',
        allowlist: FETCH_ALLOW
      });
    }
    const lib = target.startsWith('https') ? https : http;
    const r = lib.get(target, { headers: { 'User-Agent': 'Mozilla/5.0 Fraud111-Collector/1.0' }, timeout: 20000 }, (resp) => {
      let raw = '';
      resp.setEncoding('utf8');
      resp.on('data', (d) => { raw += d; if (raw.length > 2e6) resp.destroy(); });
      resp.on('end', () => {
        const title = (raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
        const text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
        sendJSON(res, 200, { ok: true, url: target, status: resp.statusCode, title: title.trim(), text });
      });
    });
    r.on('timeout', () => { r.destroy(); sendJSON(res, 504, { ok: false, error: '采集超时' }); });
    r.on('error', (e) => sendJSON(res, 502, { ok: false, error: '采集失败：' + e.message, hint: '可改为人工上传工商信息文件' }));
  }).catch((e) => sendJSON(res, 400, { ok: false, error: e.message }));
}

/* ---------------- 路由 ---------------- */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/health' && req.method === 'GET') return handleHealth(req, res);
      if (pathname === '/api/llm' && req.method === 'POST') return handleLLM(req, res);
      if (pathname === '/api/db/status' && req.method === 'GET') return handleDBStatus(req, res);
      if (pathname === '/api/db/tables' && req.method === 'GET') return handleDBTables(req, res, parsed.query);
      if (pathname === '/api/fetch-page' && req.method === 'POST') return handleFetchPage(req, res);
      return sendJSON(res, 404, { ok: false, error: '接口不存在：' + pathname });
    } catch (e) {
      return sendJSON(res, 500, { ok: false, error: e.message });
    }
  }

  return serveStatic(req, res, pathname);
});

server.headersTimeout = 180000;
server.requestTimeout = 180000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\n[错误] 端口 ' + PORT + ' 已被占用。');
    console.error('       可能已有一个服务在运行，请直接打开 http://127.0.0.1:' + PORT + '/web/index.html');
    console.error('       或设置环境变量 FRAUD111_PORT 换一个端口后重试。\n');
  } else {
    console.error('[错误]', err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const line = '='.repeat(60);
  console.log(line);
  console.log('  财务舞弊111 · 本地服务已启动');
  console.log(line);
  console.log('  网页应用：http://' + HOST + ':' + PORT + '/web/index.html');
  console.log('  健康检查：http://' + HOST + ':' + PORT + '/api/health');
  console.log('  大模型  ：' + (CFG.llmKey ? ('已配置 Key（' + CFG.llmKey.slice(0, 6) + '****），模型 ' + CFG.llmModel) : '未配置 Key（默认使用本地模式，页面仍可完整运行）'));
  console.log('  数据库  ：' + (CFG.db.database ? (CFG.db.user + '@' + CFG.db.host + ':' + CFG.db.port + '/' + CFG.db.database) : '未配置（可在 .env 中设置 FRAUD111_DB_*）'));
  console.log(line);
  console.log('  注意：按 Ctrl+C 或关闭窗口即停止服务。');
  console.log('');
});
