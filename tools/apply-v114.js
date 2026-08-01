#!/usr/bin/env node
'use strict';
/**
 * v1.14.0 — 将验证通过的新点位写入 LOCATIONS
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'MmaGuessr.html');

const valid = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '.v114-valid.json'), 'utf8'));
const worldValid = valid.filter(v => !v.name.startsWith('中国'));
const cnValid = valid.filter(v => v.name.startsWith('中国'));
console.log('待写入: 世界', worldValid.length, '中国', cnValid.length);

let src = fs.readFileSync(GAME, 'utf8');
const marker = 'const LOCATIONS =';
const start = src.indexOf(marker);
const open = src.indexOf('[', start);
let depth=0,is=false,q='',esc=false,end=-1;
for(let i=open;i<src.length;i++){
  const c=src[i];
  if(esc){esc=false;continue}
  if(c==='\\'){esc=true;continue}
  if(c==='"'||c==="'"||c==='`'){if(!is){is=true;q=c}else if(q===c){is=false;q=''};continue}
  if(is)continue
  if(c==='[')depth++;else if(c===']'){depth--;if(depth===0){end=i;break}}
}
const existing = eval(src.slice(open, end + 1));
const existingNames = new Set(existing.map(l => l.name));
const toAdd = valid.filter(v => !existingNames.has(v.name));
console.log('实际新增(去重后):', toAdd.length);

const formatLoc = e => `            { name: ${JSON.stringify(e.name)}, lat: ${e.lat}, lng: ${e.lng}, region: ${JSON.stringify(e.region)}, difficulty: ${e.difficulty} }`;
const allLines = [...existing, ...toAdd].map(formatLoc);
const newSrc = src.slice(0, open) + '[' + allLines.join(',\n') + ']' + src.slice(end + 1);
fs.writeFileSync(GAME, newSrc, 'utf8');

// 校验
const vSrc = fs.readFileSync(GAME, 'utf8');
const vOpen = vSrc.indexOf('[', vSrc.indexOf(marker));
let vd=0,vis=false,vq='',ve=false,vend=-1;
for(let i=vOpen;i<vSrc.length;i++){
  const c=vSrc[i];
  if(ve){ve=false;continue}
  if(c==='\\'){ve=true;continue}
  if(c==='"'||c==="'"||c==='`'){if(!vis){vis=true;vq=c}else if(vq===c){vis=false;vq=''};continue}
  if(vis)continue
  if(c==='[')vd++;else if(c===']'){vd--;if(vd===0){vend=i;break}}
}
const finalArr = eval(vSrc.slice(vOpen, vend + 1));
const cnFinal = finalArr.filter(l => l.name.startsWith('中国'));
const wFinal = finalArr.filter(l => !l.name.startsWith('中国'));
console.log(`✅ 最终 LOCATIONS: ${finalArr.length}（中国 ${cnFinal.length} / 世界 ${wFinal.length}）`);
