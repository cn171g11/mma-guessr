#!/usr/bin/env node
/**
 * build-admin.js — 从 MmaGuessr.html 抽取 LOCATIONS，AES-256-GCM 加密后注入 admin.html
 *
 * 用法:
 *   node tools/build-admin.js                 # 使用默认密码
 *   ADMIN_PASSWORD=你的密码 node tools/build-admin.js
 *
 * 加密与浏览器端 Web Crypto 完全一致（均使用 Node webcrypto / SubtleCrypto），
 * 因此浏览器输入正确密码即可解密。密码本身不写入产物，仅用于派生密钥。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const subtle = webcrypto.subtle;
const enc = new TextEncoder();

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'MmaGuessr.html');
const TPL  = path.join(ROOT, 'admin.template.html');
const OUT  = path.join(ROOT, 'admin.html');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'mma-admin-2026';
const PBKDF2_ITER = 150000;

// 国家归类：从 name 前缀推断；港澳台统一归为中国
const COUNTRIES = [
  '美国','英国','法国','日本','澳大利亚','意大利','俄罗斯','巴西','阿联酋','西班牙','德国',
  '荷兰','泰国','加拿大','奥地利','新加坡','阿根廷','捷克','韩国','南非','墨西哥','葡萄牙',
  '新西兰','瑞典','波兰','芬兰','印度','土耳其','冰岛','挪威','马来西亚','智利','立陶宛',
  '肯尼亚','乌拉圭','爱沙尼亚','摩洛哥','斯洛文尼亚','法罗群岛','格陵兰','蒙古','秘鲁','纳米比亚','中国','香港','澳门','台北'
];
function deriveCountry(name) {
  const n = name || '';
  for (const c of COUNTRIES) {
    if (n.indexOf(c) === 0) {
      if (c === '香港' || c === '澳门' || c === '台北') return '中国';
      return c;
    }
  }
  return '其他';
}

function extractLocations(src) {
  const marker = 'const LOCATIONS =';
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('未找到 LOCATIONS 数组');
  const open = src.indexOf('[', start);
  let depth = 0, inStr = false, quote = '', esc = false, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if ((c === '"' || c === "'" || c === '`')) {
      if (!inStr) { inStr = true; quote = c; }
      else if (quote === c) { inStr = false; quote = ''; }
      continue;
    }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error('LOCATIONS 数组未闭合');
  const literal = src.slice(open, end + 1);
  // 本地可信文件，按 JS 字面量求值
  const arr = eval(literal);
  if (!Array.isArray(arr)) throw new Error('LOCATIONS 不是数组');
  return arr;
}

function b64(buf) { return Buffer.from(buf).toString('base64'); }

async function main() {
  const locations = extractLocations(fs.readFileSync(GAME, 'utf8'));
  // 为每条补充 country 字段（不修改游戏本体，仅在管理端数据注入国家归类）
  const enriched = locations.map(l => Object.assign({}, l, { country: deriveCountry(l.name || '') }));
  const json = JSON.stringify(enriched);

  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv   = webcrypto.getRandomValues(new Uint8Array(12));
  const keyMat = await subtle.importKey('raw', enc.encode(ADMIN_PASSWORD), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ctBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
  // Web Crypto AES-GCM 输出已含 16 字节认证标签，浏览器解密可直接使用

  const saltB64 = b64(salt);
  const ivB64   = b64(iv);
  const dataB64 = b64(ctBuf);

  // self-test: 立即用同一密码解密验证（Node webcrypto 与浏览器一致）
  const decKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, decKey, ctBuf);
  const roundTrip = JSON.parse(new TextDecoder().decode(plainBuf));
  if (roundTrip.length !== locations.length) throw new Error('自检失败：解密条目数不一致');
  const cnCount = roundTrip.filter(l => l.country === '中国').length;

  let tpl = fs.readFileSync(TPL, 'utf8');
  tpl = tpl.replace('__SALT__', saltB64).replace('__IV__', ivB64).replace('__DATA__', dataB64);
  if (tpl.includes('__SALT__') || tpl.includes('__DATA__')) throw new Error('占位符未完全替换');
  fs.writeFileSync(OUT, tpl, 'utf8');

  console.log('✅ 已生成 admin.html');
  console.log('   地点数量 :', locations.length, '(中国:', cnCount + ')');
  console.log('   盐/IV/密文(base64) 长度:', saltB64.length, ivB64.length, dataB64.length);
  console.log('   管理员密码 :', ADMIN_PASSWORD, '(请妥善保管，改密需重新运行本脚本)');
}

main().catch(function (e) {
  console.error('❌ 构建失败:', e.message);
  process.exit(1);
});
