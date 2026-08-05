#!/usr/bin/env node
'use strict';
/**
 * 中国街景点位验证 + 新城市搜索
 * v1.10.1 — 逐点调用 Mapillary API 校验覆盖，生成有效/失效/新增报告
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'src', 'js', 'data.js');
const TOKEN = process.env.MAPILLARY_TOKEN || 'MLY|27847157814868912|297a1717444edeb373bb94009d2df54a';

// 新目标城市：坐标 + 搜索偏移量
const TARGET_CITIES = [
    {
        city: '上海',
        lat: 31.23,
        lng: 121.47,
        extra: [
            { name: '上海·人民广场', lat: 31.232, lng: 121.473 },
            { name: '上海·新天地', lat: 31.219, lng: 121.475 },
            { name: '上海·静安寺', lat: 31.225, lng: 121.445 },
            { name: '上海·武康路', lat: 31.208, lng: 121.436 },
            { name: '上海·迪士尼', lat: 31.143, lng: 121.657 },
        ],
    },
    {
        city: '成都',
        lat: 30.66,
        lng: 104.06,
        extra: [
            { name: '成都·太古里', lat: 30.653, lng: 104.084 },
            { name: '成都·武侯祠', lat: 30.644, lng: 104.047 },
            { name: '成都·杜甫草堂', lat: 30.661, lng: 104.028 },
            { name: '成都·金沙遗址', lat: 30.682, lng: 104.012 },
        ],
    },
    {
        city: '阆中',
        lat: 31.56,
        lng: 105.97,
        extra: [
            { name: '阆中·古城', lat: 31.575, lng: 105.967 },
            { name: '阆中·张飞庙', lat: 31.576, lng: 105.966 },
            { name: '阆中·华光楼', lat: 31.574, lng: 105.964 },
        ],
    },
    {
        city: '南充',
        lat: 30.79,
        lng: 106.08,
        extra: [
            { name: '南充·北湖公园', lat: 30.796, lng: 106.076 },
            { name: '南充·西山风景区', lat: 30.78, lng: 106.065 },
        ],
    },
    {
        city: '南部',
        lat: 31.35,
        lng: 106.04,
        extra: [
            { name: '南部·桂花博览园', lat: 31.348, lng: 106.038 },
            { name: '南部·凌云公园', lat: 31.356, lng: 106.045 },
        ],
    },
    {
        city: '溧水',
        lat: 31.65,
        lng: 119.02,
        extra: [
            { name: '溧水·无想山', lat: 31.63, lng: 119.035 },
            { name: '溧水·天生桥', lat: 31.638, lng: 119.012 },
        ],
    },
    {
        city: '株洲',
        lat: 27.84,
        lng: 113.14,
        extra: [
            { name: '株洲·炎帝广场', lat: 27.838, lng: 113.132 },
            { name: '株洲·神农城', lat: 27.835, lng: 113.128 },
            { name: '株洲·湘江风光带', lat: 27.836, lng: 113.148 },
        ],
    },
];

// ==========================================================
// 1. 从 src/js/data.js 抓取 LOCATIONS 中所有中国点位
// ==========================================================
function parseChinaLocations() {
    const src = fs.readFileSync(GAME, 'utf8');
    const marker = 'const LOCATIONS =';
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('LOCATIONS not found');
    const open = src.indexOf('[', start);
    let depth = 0,
        inStr = false,
        quote = '',
        esc = false,
        end = -1;
    for (let i = open; i < src.length; i++) {
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
    if (end < 0) throw new Error('LOCATIONS not closed');
    const arr = eval(src.slice(open, end + 1));
    // 过滤以"中国"开头的点位（含港澳台统一归类为中国）
    return arr.filter((l) => (l.name || '').startsWith('中国'));
}

// ==========================================================
// 2. Mapillary API 查询
// ==========================================================
function mapillaryRequest(url) {
    try {
        const out = execSync(`curl -s --max-time 12 "${url}"`, {
            encoding: 'utf8',
            timeout: 15000,
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        if (!out || out.trim().startsWith('{')) {
            const data = JSON.parse(out.trim());
            return Promise.resolve(data);
        }
    } catch (e) {
        // fall through
    }
    return Promise.reject(new Error('fetch failed'));
}

async function checkMapillaryCoverage(lat, lng) {
    // 1.3 km 半径 ≈ 0.012 度，加上主偏移，分两级搜索
    const offsets = [0.006, 0.012];
    for (const offset of offsets) {
        const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
        const url = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,geometry&bbox=${bbox}&limit=5`;
        try {
            const data = await mapillaryRequest(url);
            if (data.data && data.data.length > 0) {
                const img = data.data[0];
                return {
                    valid: true,
                    imageId: img.id,
                    lat: img.geometry.coordinates[1],
                    lng: img.geometry.coordinates[0],
                };
            }
        } catch (e) {
            // fall through to next offset
        }
    }
    return { valid: false };
}

// ==========================================================
// 3. 确认新点位是否存在已有同名
// ==========================================================
function nameExists(name, all) {
    return all.some((l) => l.name === name);
}

// 限速并发执行
async function withConcurrency(items, fn, limit = 6) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

// ==========================================================
// 主流程
// ==========================================================
async function main() {
    console.log('🔍 开始中国街景点位全面验证...\n');

    // 读取现有中国点位
    const chinaPoints = parseChinaLocations();
    console.log(`📌 现有中国点位总数: ${chinaPoints.length}\n`);

    // 去重检查
    const nameSet = new Set();
    const dupes = [];
    chinaPoints.forEach((p) => {
        if (nameSet.has(p.name)) dupes.push(p.name);
        else nameSet.add(p.name);
    });
    if (dupes.length > 0) {
        console.log('⚠️  发现重复点位:');
        dupes.forEach((d) => console.log(`    - ${d}`));
        console.log();
    }

    // 逐点验证 Mapillary 覆盖（6 并发）
    console.log('🔬 逐点验证 Mapillary 覆盖（6 并发）...\n');
    const valid = [],
        invalid = [];
    let done = 0;
    const total = chinaPoints.length;

    const verifyResults = await withConcurrency(chinaPoints, async (p) => {
        done++;
        process.stdout.write(`\r  [${done}/${total}] ${p.name.padEnd(24)} `);
        const result = await checkMapillaryCoverage(p.lat, p.lng);
        if (result.valid) {
            process.stdout.write('✅');
            return { valid: true, point: p, imageId: result.imageId };
        } else {
            process.stdout.write('❌');
            return { valid: false, point: p };
        }
    });

    for (const r of verifyResults) {
        if (r.valid) valid.push({ ...r.point, imageId: r.imageId });
        else invalid.push(r.point);
    }
    process.stdout.write('\n\n');

    console.log(`\n📊 验证结果: 有效 ${valid.length}, 失效 ${invalid.length}\n`);

    if (invalid.length > 0) {
        console.log('❌ 以下点位已失效，建议移除:');
        invalid.forEach((p) => console.log(`    - ${p.name} (${p.lat}, ${p.lng})`));
        console.log();
    }

    // 搜索新城市点位（6 并发）
    console.log('🌆 搜索新城市点位...\n');
    const newPoints = [];
    const allNames = new Set(chinaPoints.map((p) => p.name));

    // 收集所有待搜索点
    const allSpots = [];
    for (const city of TARGET_CITIES) {
        for (const spot of city.extra) {
            const cnName = `中国${spot.name}`;
            if (allNames.has(cnName)) {
                console.log(`  ⏭️  ${spot.name} — 已存在，跳过`);
                continue;
            }
            allSpots.push({ ...spot, cnName, city: city.city });
        }
    }

    let spotDone = 0;
    const spotTotal = allSpots.length;

    const spotResults = await withConcurrency(allSpots, async (spot) => {
        spotDone++;
        process.stdout.write(`\r  🏙️  [${spotDone}/${spotTotal}] ${spot.city}·${spot.name.padEnd(18)} `);
        const result = await checkMapillaryCoverage(spot.lat, spot.lng);
        if (result.valid) {
            process.stdout.write('✅');
            return { valid: true, spot, imageId: result.imageId };
        } else {
            process.stdout.write('❌');
            return { valid: false, spot };
        }
    });

    for (const r of spotResults) {
        if (r.valid) {
            const diff =
                r.spot.city === '上海' || r.spot.city === '成都'
                    ? 2
                    : r.spot.city === '阆中' || r.spot.city === '南充' || r.spot.city === '株洲'
                      ? 3
                      : 4;
            newPoints.push({
                name: r.spot.cnName,
                lat: r.spot.lat,
                lng: r.spot.lng,
                region: 'asia',
                difficulty: diff,
                imageId: r.imageId,
            });
        }
    }
    process.stdout.write('\n\n');

    console.log(`\n📊 新增有效点位: ${newPoints.length}\n`);

    // 汇总
    console.log('═══════════════════════════════════════');
    console.log('📋 操作汇总:');
    console.log(`   现有中国点位: ${chinaPoints.length}`);
    console.log(`   有效(保留):   ${valid.length}`);
    console.log(`   失效(移除):   ${invalid.length}`);
    console.log(`   重复(合并):   ${dupes.length}`);
    console.log(`   新增:         ${newPoints.length}`);
    console.log(`   最终点位:     ${valid.length + newPoints.length} (如果移除失效+去重)`);
    console.log('═══════════════════════════════════════');

    // 输出详细清单供后续使用
    fs.writeFileSync(
        path.join(ROOT, 'tools', '.verify-report.json'),
        JSON.stringify({ invalid, newPoints, dupes, total: chinaPoints.length, validCount: valid.length }, null, 2),
        'utf8'
    );
    console.log('\n📄 详细报告已保存至 tools/.verify-report.json');
}

main().catch((e) => {
    console.error('❌ 错误:', e.message);
    process.exit(1);
});
