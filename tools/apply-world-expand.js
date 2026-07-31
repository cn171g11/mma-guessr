#!/usr/bin/env node
'use strict';
/**
 * v1.13.0 — 将世界街景验证结果写入 LOCATIONS
 * 合并第一轮(.world-expand-report.json) + 第二轮(.world-expand-report2.json) 的有效点位
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'MmaGuessr.html');

// 读取报告（存在哪个读哪个）
function readReport(file) {
  const p = path.join(ROOT, 'tools', file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const r1 = readReport('.world-expand-report.json');
const r2 = readReport('.world-expand-report2.json');
const valid = [];
if (r1 && r1.valid) valid.push(...r1.valid);
if (r2 && r2.valid) valid.push(...r2.valid);
if (valid.length === 0) { console.log('❌ 没有有效点位可写入'); process.exit(1); }

console.log('待写入有效点位:', valid.length);

// 解析 LOCATIONS
let src = fs.readFileSync(GAME, 'utf8');
const marker = 'const LOCATIONS =';
const start = src.indexOf(marker);
const open = src.indexOf('[', start);
let depth = 0, inStr = false, quote = '', esc = false, end = -1;
for (let i = open; i < src.length; i++) {
  const c = src[i];
  if (esc) { esc = false; continue; }
  if (c === '\\') { esc = true; continue; }
  if (c === '"' || c === "'" || c === '`') {
    if (!inStr) { inStr = true; quote = c; }
    else if (quote === c) { inStr = false; quote = ''; }
    continue;
  }
  if (inStr) continue;
  if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
}
const existing = eval(src.slice(open, end + 1));
const existingNames = new Set(existing.map(l => l.name));

// 过滤：避免重复写入同名（安全保护）
const toAdd = valid.filter(v => !existingNames.has(v.name));
console.log('实际新增(去重后):', toAdd.length);

const formatLoc = e => `            { name: ${JSON.stringify(e.name)}, lat: ${e.lat}, lng: ${e.lng}, region: ${JSON.stringify(e.region)}, difficulty: ${e.difficulty} }`;
const allLines = [...existing, ...toAdd].map(formatLoc);
const newSrc = src.slice(0, open) + '[' + allLines.join(',\n') + ']' + src.slice(end + 1);
fs.writeFileSync(GAME, newSrc, 'utf8');

// 校验
const vSrc = fs.readFileSync(GAME, 'utf8');
const vOpen = vSrc.indexOf('[', vSrc.indexOf(marker));
let vd = 0, vis = false, vq = '', ve = false, vend = -1;
for (let i = vOpen; i < vSrc.length; i++) {
  const c = vSrc[i];
  if (ve) { ve = false; continue; }
  if (c === '\\') { ve = true; continue; }
  if (c === '"' || c === "'" || c === '`') { if (!vis) { vis = true; vq = c; } else if (vq === c) { vis = false; vq = ''; } continue; }
  if (vis) continue;
  if (c === '[') vd++; else if (c === ']') { vd--; if (vd === 0) { vend = i; break; } }
}
const finalArr = eval(vSrc.slice(vOpen, vend + 1));
console.log(`✅ 最终 LOCATIONS: ${finalArr.length}`);
