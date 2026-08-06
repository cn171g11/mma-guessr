import type { QueryResultRow } from 'pg';

import { pool } from '../db/pool.js';

interface BestScoreRow extends QueryResultRow {
    user_id: string;
    mode: string;
    score: string;
}

interface UsernameRow extends QueryResultRow {
    id: string;
    username: string;
}

// 每局上榜成绩落库一份，作为每日校准重建 ZSET 的权威数据源
export async function insertScore(userId: string, mode: string, score: number): Promise<void> {
    await pool.query('INSERT INTO scores (user_id, mode, score) VALUES ($1, $2, $3)', [userId, mode, score]);
}

// date 为 yyyymmdd 时只统计该 UTC 日期的最高分，为 null 时统计全量最高分
export async function fetchBestScores(dateKey: string | null): Promise<BestScoreRow[]> {
    if (dateKey === null) {
        const result = await pool.query<BestScoreRow>(
            'SELECT user_id, mode, MAX(score) AS score FROM scores GROUP BY user_id, mode'
        );
        return result.rows;
    }
    const result = await pool.query<BestScoreRow>(
        `SELECT user_id, mode, MAX(score) AS score
         FROM scores
         WHERE created_at::date = $1::date
         GROUP BY user_id, mode`,
        [dateKey]
    );
    return result.rows;
}

export async function fetchUsernames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) {
        return new Map();
    }
    const result = await pool.query<UsernameRow>('SELECT id::text, username FROM users WHERE id = ANY($1::uuid[])', [
        ids,
    ]);
    return new Map(result.rows.map((row) => [row.id, row.username]));
}
