#!/usr/bin/env node
'use strict';
/**
 * v1.14.0 — 批量验证新候选点位（世界 500 + 中国 200 目标）
 * 真异步并发（exec promisify），10 并发
 */
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execP = promisify(exec);

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'src', 'js', 'data.js');
const TOKEN = 'MLY|27847157814868912|297a1717444edeb373bb94009d2df54a';

// 合并所有候选
const europe = require('./candidates-europe.js');
const asia = require('./candidates-asia.js');
const africa = require('./candidates-africa.js');
const na = require('./candidates-northamerica.js');
const sa = require('./candidates-southamerica.js');
const oceania = require('./candidates-oceania.js');
const china = require('./candidates-china.js');
const china2 = require('./candidates-china2.js');
const world2 = require('./candidates-world2.js');

const CANDIDATES = [...europe, ...asia, ...africa, ...na, ...sa, ...oceania, ...china, ...china2, ...world2];
console.log('候选总数:', CANDIDATES.length);

// 读取现有 LOCATIONS 避免重名
function parseLocations() {
    const src = fs.readFileSync(GAME, 'utf8');
    const m = src.indexOf('const LOCATIONS =');
    const o = src.indexOf('[', m);
    let d = 0,
        is = false,
        q = '',
        esc = false,
        e = -1;
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
            if (!is) {
                is = true;
                q = c;
            } else if (q === c) {
                is = false;
                q = '';
            }
            continue;
        }
        if (is) continue;
        if (c === '[') d++;
        else if (c === ']') {
            d--;
            if (d === 0) {
                e = i;
                break;
            }
        }
    }
    return eval(src.slice(o, e + 1));
}
const existing = parseLocations();
const existingNames = new Set(existing.map((l) => l.name));
const candidates = CANDIDATES.filter((c) => !existingNames.has(c[0]));
console.log('过滤重名后:', candidates.length, '(跳过', CANDIDATES.length - candidates.length, ')');

async function checkCoverage(lat, lng) {
    const offsets = [0.006, 0.012];
    for (const offset of offsets) {
        const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
        const url = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,geometry,is_pano&bbox=${bbox}&limit=5`;
        try {
            const { stdout } = await execP(`curl -s --max-time 10 "${url}"`, { timeout: 12000 });
            if (stdout && stdout.trim().startsWith('{')) {
                const data = JSON.parse(stdout.trim());
                if (data.data && data.data.length > 0) {
                    const panos = data.data.filter((i) => i.is_pano);
                    const img = (panos.length ? panos : data.data)[0];
                    const [ilng, ilat] = img.geometry.coordinates;
                    return { valid: true, imageId: img.id, lat: ilat, lng: ilng };
                }
            }
        } catch (e) {
            /* 继续 */
        }
    }
    return { valid: false };
}

async function main() {
    const LIMIT = 10;
    const results = new Array(candidates.length);
    let done = 0;
    const total = candidates.length;

    async function worker() {
        for (;;) {
            const idx = done++;
            if (idx >= total) break;
            const c = candidates[idx];
            const r = await checkCoverage(c[1], c[2]);
            results[idx] = { cand: c, result: r };
            if ((idx + 1) % 20 === 0 || idx === total - 1) {
                process.stdout.write(`\r  进度 ${idx + 1}/${total}`);
            }
        }
    }
    await Promise.all(Array.from({ length: LIMIT }, worker));
    process.stdout.write('\n\n');

    const valid = results
        .filter((r) => r.result.valid)
        .map((r) => ({
            name: r.cand[0],
            lat: r.result.lat,
            lng: r.result.lng,
            region: r.cand[3],
            difficulty: r.cand[4],
            imageId: r.result.imageId,
        }));
    const invalid = results.filter((r) => !r.result.valid).map((r) => r.cand[0]);

    // 分组统计
    const worldValid = valid.filter((v) => !v.name.startsWith('中国'));
    const cnValid = valid.filter((v) => v.name.startsWith('中国'));
    const byRegion = {};
    worldValid.forEach((v) => (byRegion[v.region] = (byRegion[v.region] || 0) + 1));

    console.log('═══ 验证结果 ═══');
    console.log('世界有效:', worldValid.length, JSON.stringify(byRegion));
    console.log('中国有效:', cnValid.length);
    console.log('无效:', invalid.length);

    fs.writeFileSync(path.join(ROOT, 'tools', '.v114-valid.json'), JSON.stringify(valid, null, 2), 'utf8');
    fs.writeFileSync(path.join(ROOT, 'tools', '.v114-invalid.json'), JSON.stringify(invalid, null, 2), 'utf8');
    console.log('📄 报告已保存至 tools/.v114-valid.json');
}

main().catch((e) => {
    console.error('错误:', e.message);
    process.exit(1);
});
