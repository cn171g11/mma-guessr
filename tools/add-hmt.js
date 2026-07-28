#!/usr/bin/env node
'use strict';
/** 向 MmaGuessr.html 的 LOCATIONS 追加经 Mapillary 覆盖验证的港澳台街景点位。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'MmaGuessr.html');

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
  if (c === '"' || c === "'" || c === '`') { if (!inStr) { inStr = true; quote = c; } else if (quote === c) { inStr = false; quote = ''; } continue; }
  if (inStr) continue;
  if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
}
if (end < 0) throw new Error('LOCATIONS not closed');

const newEntries = [
  // 香港（均通过 Mapillary 覆盖验证）
  { name: '中国香港·中环', lat: 22.2819, lng: 114.1583, region: 'asia', difficulty: 2 },
  { name: '中国香港·旺角', lat: 22.3193, lng: 114.1694, region: 'asia', difficulty: 2 },
  { name: '中国香港·尖沙咀', lat: 22.2988, lng: 114.1722, region: 'asia', difficulty: 2 },
  { name: '中国香港·铜锣湾', lat: 22.2800, lng: 114.1830, region: 'asia', difficulty: 2 },
  { name: '中国香港·太平山顶', lat: 22.2711, lng: 114.1503, region: 'asia', difficulty: 3 },
  { name: '中国香港·金紫荆广场', lat: 22.2841, lng: 114.1734, region: 'asia', difficulty: 2 },
  { name: '中国香港·庙街夜市', lat: 22.3098, lng: 114.1697, region: 'asia', difficulty: 3 },
  // 澳门（均通过 Mapillary 覆盖验证）
  { name: '中国澳门·议事亭前地', lat: 22.1933, lng: 113.5396, region: 'asia', difficulty: 2 },
  { name: '中国澳门·妈阁庙', lat: 22.1861, lng: 113.5311, region: 'asia', difficulty: 3 },
  { name: '中国澳门·官也街', lat: 22.1526, lng: 113.5572, region: 'asia', difficulty: 3 },
  { name: '中国澳门·东望洋灯塔', lat: 22.1986, lng: 113.5514, region: 'asia', difficulty: 3 },
  // 台湾（均通过 Mapillary 覆盖验证）
  { name: '中国台北·西门町', lat: 25.0420, lng: 121.5075, region: 'asia', difficulty: 2 },
  { name: '中国台北·士林夜市', lat: 25.0879, lng: 121.5243, region: 'asia', difficulty: 2 },
  { name: '中国高雄·六合夜市', lat: 22.6319, lng: 120.2994, region: 'asia', difficulty: 2 },
  { name: '中国台中·逢甲夜市', lat: 24.1786, lng: 120.6449, region: 'asia', difficulty: 2 },
  { name: '中国垦丁·垦丁大街', lat: 21.9482, lng: 120.7800, region: 'asia', difficulty: 4 },
  { name: '中国日月潭', lat: 23.8571, lng: 120.9159, region: 'asia', difficulty: 4 },
  { name: '中国九份·老街', lat: 25.1097, lng: 121.8450, region: 'asia', difficulty: 4 }
];

const block = newEntries
  .map(e => '            { name: ' + JSON.stringify(e.name) + ', lat: ' + e.lat + ', lng: ' + e.lng + ', region: ' + JSON.stringify(e.region) + ', difficulty: ' + e.difficulty + ' }')
  .join(',\n');

let inner = src.slice(open + 1, end);
inner = inner.replace(/,\s*$/, '');
const newInner = inner + ',\n' + block;
const newSrc = src.slice(0, open) + '[' + newInner + ']' + src.slice(end + 1);
fs.writeFileSync(GAME, newSrc, 'utf8');

// 自校验：重新解析计数
const m = newSrc.indexOf(marker);
const o = newSrc.indexOf('[', m);
let d = 0, is = false, q = '', e2 = false, en = -1;
for (let i = o; i < newSrc.length; i++) {
  const c = newSrc[i];
  if (e2) { e2 = false; continue; }
  if (c === '\\') { e2 = true; continue; }
  if (c === '"' || c === "'" || c === '`') { if (!is) { is = true; q = c; } else if (q === c) { is = false; q = ''; } continue; }
  if (is) continue;
  if (c === '[') d++; else if (c === ']') { d--; if (d === 0) { en = i; break; } }
}
const arr = eval(newSrc.slice(o, en + 1));
const hmt = arr.filter(l => /(香港|澳门|台湾|台北|高雄|台中|垦丁|日月潭|九份)/.test(l.name || ''));
console.log('✅ 已插入', newEntries.length, '条港澳台街景');
console.log('   LOCATIONS 总数 :', arr.length);
console.log('   港澳台相关     :', hmt.length);
