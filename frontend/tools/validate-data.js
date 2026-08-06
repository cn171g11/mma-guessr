#!/usr/bin/env node
'use strict';
/**
 * CI 数据校验（无网络依赖）
 *
 * 校验 src/js/data.js 中 LOCATIONS 题库的完整性与约束：
 *   · 可被完整解析，且总数与期望值一致（可用环境变量 EXPECTED_LOCATIONS 覆盖）
 *   · 地点名称唯一、非空
 *   · region / difficulty / lat / lng 字段合法
 *   · WORLD_LOCATIONS / CHINA_LOCATIONS 派生题库存在且与 LOCATIONS 总量一致
 *
 * 任何一项失败则非零退出，供 GitHub Actions 直接使用：
 *   node tools/validate-data.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'src', 'js', 'data.js');

const REGIONS = ['asia', 'europe', 'northamerica', 'southamerica', 'africa', 'oceania'];
const EXPECTED_TOTAL = process.env.EXPECTED_LOCATIONS ? Number(process.env.EXPECTED_LOCATIONS) : 1570;

const errors = [];
const log = (...args) => console.log(...args);

// 与 tools/ 下其他脚本一致的 LOCATIONS 解析逻辑（括号配对 + 字符串感知）
function parseLocations(src) {
    const m = src.indexOf('const LOCATIONS =');
    if (m < 0) throw new Error('未找到 const LOCATIONS =');
    const o = src.indexOf('[', m);
    let depth = 0,
        inStr = false,
        quote = '',
        esc = false,
        end = -1;
    for (let i = o; i < src.length; i++) {
        const c = src[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (c === '\\') {
            esc = true;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            if (!inStr) {
                inStr = true;
                quote = c;
            } else if (quote === c) {
                inStr = false;
                quote = '';
            }
            continue;
        }
        if (inStr) continue;
        if (c === '[') depth++;
        else if (c === ']') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end < 0) throw new Error('LOCATIONS 数组未闭合');
    return eval(src.slice(o, end + 1));
}

const src = fs.readFileSync(GAME, 'utf8');
let locs;
try {
    locs = parseLocations(src);
} catch (e) {
    console.error('❌ 题库解析失败:', e.message);
    process.exit(1);
}

// ---- 总量 ----
log(`题库总量: ${locs.length}（期望 ${EXPECTED_TOTAL}）`);
if (locs.length !== EXPECTED_TOTAL) {
    errors.push(`题库总量 ${locs.length} ≠ 期望值 ${EXPECTED_TOTAL}（如需调整请设置环境变量 EXPECTED_LOCATIONS）`);
}

// ---- 逐条校验 ----
const seen = new Set();
let china = 0,
    world = 0;
locs.forEach((l, i) => {
    const tag = `[${i}] ${l && l.name ? l.name : '?'}`;
    if (!l || typeof l.name !== 'string' || !l.name.trim()) {
        errors.push(`${tag} 缺少有效 name`);
        return;
    }
    if (seen.has(l.name)) errors.push(`${tag} 地点名称重复`);
    seen.add(l.name);
    if (!REGIONS.includes(l.region)) errors.push(`${tag} region 非法: ${l.region}`);
    if (!Number.isInteger(l.difficulty) || l.difficulty < 1 || l.difficulty > 5) {
        errors.push(`${tag} difficulty 非法: ${l.difficulty}`);
    }
    if (typeof l.lat !== 'number' || l.lat < -90 || l.lat > 90) errors.push(`${tag} lat 非法: ${l.lat}`);
    if (typeof l.lng !== 'number' || l.lng < -180 || l.lng > 180) errors.push(`${tag} lng 非法: ${l.lng}`);
    if (l.name.startsWith('中国')) china++;
    else world++;
});

// ---- 派生题库 ----
for (const c of ['WORLD_LOCATIONS', 'CHINA_LOCATIONS']) {
    if (!src.includes(`const ${c} =`)) errors.push(`缺少派生题库声明 const ${c} =`);
}
log(`中国条目: ${china} / 世界条目: ${world}`);
if (china + world !== locs.length) errors.push('中国/世界条目计数与总量不一致');

// ---- 结果 ----
if (errors.length) {
    console.error('\n❌ 校验失败:');
    errors.forEach((e) => console.error('  - ' + e));
    process.exit(1);
}
console.log('✅ 题库校验通过');
