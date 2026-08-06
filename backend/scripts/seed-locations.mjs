#!/usr/bin/env node
'use strict';
/**
 * 题库迁移：将 frontend/src/js/data.js 的 LOCATIONS（1570 条）批量写入 PostgreSQL locations 表。
 *
 * 用法：
 *   npm run db:seed                      # 使用默认数据文件与 DATABASE_URL
 *   LOCATIONS_DATA=... node scripts/seed-locations.mjs   # 自定义数据文件路径
 *
 * 幂等：按 name 唯一键 upsert，可重复执行；无效/重复条目仅跳过并告警。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const { Pool } = pg;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.resolve(scriptDir, '../../frontend/src/js/data.js');
const DATA_FILE = process.env.LOCATIONS_DATA || DEFAULT_DATA_FILE;
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://mma:mma@localhost:5432/mma_guessr';

const REGIONS = ['asia', 'europe', 'northamerica', 'southamerica', 'africa', 'oceania'];
const CHUNK_SIZE = 500;

// 与 frontend/tools/validate-data.js 一致的括号配对解析：只求值数组字面量，不执行其他代码
function parseLocations(src) {
    const marker = 'const LOCATIONS =';
    const markerIndex = src.indexOf(marker);
    if (markerIndex < 0) {
        throw new Error('未找到 const LOCATIONS =');
    }
    const openIndex = src.indexOf('[', markerIndex);
    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;
    let endIndex = -1;
    for (let i = openIndex; i < src.length; i++) {
        const char = src[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            if (!inString) {
                inString = true;
                quote = char;
            } else if (quote === char) {
                inString = false;
                quote = '';
            }
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === '[') {
            depth++;
        } else if (char === ']') {
            depth--;
            if (depth === 0) {
                endIndex = i;
                break;
            }
        }
    }
    if (endIndex < 0) {
        throw new Error('LOCATIONS 数组未闭合');
    }
    return eval(src.slice(openIndex, endIndex + 1));
}

function validateEntry(entry) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) {
        return '缺少有效 name';
    }
    if (!REGIONS.includes(entry.region)) {
        return `region 非法: ${entry.region}`;
    }
    if (!Number.isInteger(entry.difficulty) || entry.difficulty < 1 || entry.difficulty > 5) {
        return `difficulty 非法: ${entry.difficulty}`;
    }
    if (typeof entry.lat !== 'number' || entry.lat < -90 || entry.lat > 90) {
        return `lat 非法: ${entry.lat}`;
    }
    if (typeof entry.lng !== 'number' || entry.lng < -180 || entry.lng > 180) {
        return `lng 非法: ${entry.lng}`;
    }
    return null;
}

async function upsertChunk(client, rows) {
    const placeholders = rows.map((_, index) => {
        const base = index * 5;
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
    });
    const values = rows.flatMap((row) => [row.name, row.lat, row.lng, row.region, row.difficulty]);
    const sql = `
        INSERT INTO locations (name, lat, lng, region, difficulty)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (name) DO UPDATE SET
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            region = EXCLUDED.region,
            difficulty = EXCLUDED.difficulty,
            updated_at = now()
    `;
    const result = await client.query(sql, values);
    return result.rowCount ?? 0;
}

async function main() {
    const source = await readFile(DATA_FILE, 'utf8');
    const parsedLocations = parseLocations(source);

    const seenNames = new Set();
    const rows = [];
    let skipped = 0;
    for (const entry of parsedLocations) {
        const problem = validateEntry(entry);
        if (problem !== null) {
            console.warn(`跳过无效条目 ${entry?.name ?? '?'}: ${problem}`);
            skipped++;
            continue;
        }
        if (seenNames.has(entry.name)) {
            console.warn(`跳过重复条目: ${entry.name}`);
            skipped++;
            continue;
        }
        seenNames.add(entry.name);
        rows.push({
            name: entry.name,
            lat: entry.lat,
            lng: entry.lng,
            region: entry.region,
            difficulty: entry.difficulty,
        });
    }

    const pool = new Pool({ connectionString: DATABASE_URL });
    try {
        let affectedRows = 0;
        for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
            const chunk = rows.slice(offset, offset + CHUNK_SIZE);
            affectedRows += await upsertChunk(pool, chunk);
        }
        const chinaCount = rows.filter((row) => row.name.startsWith('中国')).length;
        console.log(`题库迁移完成: 有效 ${rows.length} 条 / 跳过 ${skipped} / 写入影响 ${affectedRows} 行`);
        console.log(`中国条目: ${chinaCount} / 世界条目: ${rows.length - chinaCount}`);
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('题库迁移失败:', err instanceof Error ? err.message : err);
    process.exit(1);
});
