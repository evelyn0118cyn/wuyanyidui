/* 生成知识库内嵌副本：node tools/build-embedded-kb.js
 * 目的：file:// 直接打开时浏览器禁止 XHR 读取本地 JSON（CORS），
 * 以内嵌脚本保证离线模式也能检索方法论知识库。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = path.join(ROOT, 'data', 'knowledge', 'fraud-kb.json');
const out = path.join(ROOT, 'web', 'assets', 'js', 'core', 'kb-embedded.js');

const kb = JSON.parse(fs.readFileSync(src, 'utf8'));
const js =
  '/* 自动生成，请勿手工编辑。\n' +
  '   源文件：data/knowledge/fraud-kb.json\n' +
  '   重新生成：node tools/build-embedded-kb.js\n' +
  '   用途：file:// 离线模式下浏览器禁止 XHR 读取本地 JSON，以内嵌副本保证知识库可用。 */\n' +
  '(function (global) {\n' +
  '  var App = global.App = global.App || {};\n' +
  '  App.embeddedKB = ' + JSON.stringify(kb, null, 1) + ';\n' +
  '})(typeof window !== "undefined" ? window : globalThis);\n';
fs.writeFileSync(out, js, 'utf8');
console.log('已生成 ' + path.relative(ROOT, out) + '（' + kb.docs.length + ' 条，' + js.length + ' 字节）');
