import type { QueryResultRow } from 'pg';

import { pool } from '../db/pool.js';

interface DailyChallengeRow extends QueryResultRow {
    date: string;
    location_ids: string[];
}

// location_ids 为 int8[]，pg 会解析成字符串数组，统一转数字供业务层使用
function mapLocationIds(row: DailyChallengeRow): number[] {
    return row.location_ids.map((id) => Number(id));
}

export async function fetchTodayIds(date: string): Promise<number[] | null> {
    const result = await pool.query<DailyChallengeRow>('SELECT location_ids FROM daily_challenges WHERE date = $1', [
        date,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : mapLocationIds(row);
}

// 幂等写入当天题单：并发抽题只允许一方生效，其余通过回读既有结果保持一致；
// 题单失效需要重抽时，用 DO UPDATE 覆盖当天内容而不新增行
export async function upsertToday(date: string, ids: number[]): Promise<number[]> {
    const result = await pool.query<DailyChallengeRow>(
        `INSERT INTO daily_challenges (date, location_ids) VALUES ($1, $2)
         ON CONFLICT (date) DO UPDATE SET location_ids = EXCLUDED.location_ids
         RETURNING location_ids`,
        [date, ids]
    );
    const row = result.rows[0];
    if (row === undefined) {
        throw new Error('每日挑战题单写入失败：未返回记录');
    }
    return mapLocationIds(row);
}
