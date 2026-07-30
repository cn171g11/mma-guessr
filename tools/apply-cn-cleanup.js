#!/usr/bin/env node
'use strict';
/**
 * v1.12.0 — 中国街景点位清理：
 *  1. 移除 61 个 Mapillary 验证失效的中国点位
 *  2. 移除 1 个重复点位（中国成都·宽窄巷子）
 *  3. 新增 20 个经 Mapillary 验证的新城市点位
 *  4. 写回 MmaGuessr.html
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'MmaGuessr.html');
const REPORT = path.join(ROOT, 'tools', '.verify-report.json');

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const invalidNames = new Set(report.invalid.map(p => p.name));
const dupes = new Set(report.dupes);

// 读取并解析 LOCATIONS
let src = fs.readFileSync(GAME, 'utf8');
const marker = 'const LOCATIONS =';
const start = src.indexOf(marker);
if (start < 0) throw new Error('LOCATIONS not found');
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
if (end < 0) throw new Error('LOCATIONS not closed');

const original = src.slice(open + 1, end); // the inner array content

// 重新生成 LOCATIONS：
// 1. 解析为对象数组
const allLocations = eval(src.slice(open, end + 1));

// 2. 过滤
let removed = 0, duped = 0;
const seenNames = new Set();
const kept = [];
for (const loc of allLocations) {
  // 移除失效点位
  if (invalidNames.has(loc.name)) { removed++; continue; }
  // 去重：首遇保留，后续同名跳过
  if (seenNames.has(loc.name)) { duped++; continue; }
  seenNames.add(loc.name);
  kept.push(loc);
}

// 3. 添加新点
const newEntries = report.newPoints.map(p => ({
  name: p.name, lat: p.lat, lng: p.lng, region: p.region, difficulty: p.difficulty
}));

// 4. 序列化
const formatLoc = e => `            { name: ${JSON.stringify(e.name)}, lat: ${e.lat}, lng: ${e.lng}, region: ${JSON.stringify(e.region)}, difficulty: ${e.difficulty} }`;
const allLines = [...kept, ...newEntries].map(formatLoc);
const newInner = allLines.join(',\n');

// 5. 写回
const newSrc = src.slice(0, open) + '[' + newInner + ']' + src.slice(end + 1);
fs.writeFileSync(GAME, newSrc, 'utf8');

// 校验
const vSrc = fs.readFileSync(GAME, 'utf8');
const vStart = vSrc.indexOf(marker);
const vOpen = vSrc.indexOf('[', vStart);
let vDepth = 0, vInStr = false, vQuote = '', vEsc = false, vEnd = -1;
for (let i = vOpen; i < vSrc.length; i++) {
  const c = vSrc[i];
  if (vEsc) { vEsc = false; continue; }
  if (c === '\\') { vEsc = true; continue; }
  if (c === '"' || c === "'" || c === '`') {
    if (!vInStr) { vInStr = true; vQuote = c; }
    else if (vQuote === c) { vInStr = false; vQuote = ''; }
    continue;
  }
  if (vInStr) continue;
  if (c === '[') vDepth++;
  else if (c === ']') { vDepth--; if (vDepth === 0) { vEnd = i; break; } }
}
const finalArr = eval(vSrc.slice(vOpen, vEnd + 1));
const cnFinal = finalArr.filter(l => (l.name || '').startsWith('中国'));

console.log('═══════════════════════════════');
console.log('  LOCATIONS 批量更新完成');
console.log('═══════════════════════════════');
console.log('  原始总数        :', allLocations.length);
console.log('  移除去重/失效   :', removed, '/', duped);
console.log('  原有保留        :', kept.length);
console.log('  新增中国点位    :', newEntries.length);
console.log('  最终 LOCATIONS  :', finalArr.length);
console.log('  其中中国相关    :', cnFinal.length);
console.log('═══════════════════════════════');
