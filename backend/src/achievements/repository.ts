import type { QueryResultRow } from 'pg';

import { pool } from '../db/pool.js';
import type { AchievementAggregates } from './types.js';

interface AggregateRow extends QueryResultRow {
    total_games: string;
    total_rounds: string;
    total_score: string;
    best_score: string;
    distinct_modes: string;
    daily_count: string;
    china_count: string;
    landmark_count: string;
}

interface RoundStatsRow extends QueryResultRow {
    correct_guesses: string;
    perfect_rounds: string;
}

interface CountRow extends QueryResultRow {
    count: string;
}

interface TitleRow extends QueryResultRow {
    equipped_title: string | null;
}

interface UnlockedRow extends QueryResultRow {
    achievement_code: string;
    unlocked_at: Date;
}

// 整局聚合：局数 / 轮数 / 总分 / 最佳单局 / 各模式局数 / 模式覆盖数
export async function fetchAggregates(userId: string): Promise<AchievementAggregates> {
    const [aggregateResult, roundStatsResult, perfectGamesResult] = await Promise.all([
        pool.query<AggregateRow>(
            `SELECT COUNT(*)::int AS total_games,
                    COALESCE(SUM(jsonb_array_length(rounds)), 0)::int AS total_rounds,
                    COALESCE(SUM(total_score), 0)::int AS total_score,
                    COALESCE(MAX(total_score), 0)::int AS best_score,
                    COUNT(DISTINCT mode)::int AS distinct_modes,
                    COUNT(*) FILTER (WHERE mode = 'daily')::int AS daily_count,
                    COUNT(*) FILTER (WHERE mode = 'china')::int AS china_count,
                    COUNT(*) FILTER (WHERE mode = 'landmark')::int AS landmark_count
             FROM game_results
             WHERE player_type = 'user' AND player_id = $1`,
            [userId]
        ),
        pool.query<RoundStatsRow>(
            `SELECT COUNT(*) FILTER (WHERE (rnd->>'score')::int > 0)::int AS correct_guesses,
                    COUNT(*) FILTER (WHERE (rnd->>'score')::int >= 5000)::int AS perfect_rounds
             FROM game_results
             CROSS JOIN LATERAL jsonb_array_elements(rounds) AS rnd
             WHERE player_type = 'user' AND player_id = $1`,
            [userId]
        ),
        pool.query<CountRow>(
            `SELECT COUNT(*)::int AS count
             FROM game_results
             WHERE player_type = 'user'
               AND player_id = $1
               AND jsonb_array_length(rounds) > 0
               AND (SELECT bool_and((r->>'score')::int >= 5000)
                    FROM jsonb_array_elements(rounds) AS r)`,
            [userId]
        ),
    ]);

    const aggregate = aggregateResult.rows[0];
    const roundStats = roundStatsResult.rows[0];
    return {
        totalGames: Number(aggregate?.total_games ?? 0),
        totalRounds: Number(aggregate?.total_rounds ?? 0),
        totalScore: Number(aggregate?.total_score ?? 0),
        bestScore: Number(aggregate?.best_score ?? 0),
        distinctModes: Number(aggregate?.distinct_modes ?? 0),
        dailyCount: Number(aggregate?.daily_count ?? 0),
        chinaCount: Number(aggregate?.china_count ?? 0),
        landmarkCount: Number(aggregate?.landmark_count ?? 0),
        correctGuesses: Number(roundStats?.correct_guesses ?? 0),
        perfectRounds: Number(roundStats?.perfect_rounds ?? 0),
        perfectGames: Number(perfectGamesResult.rows[0]?.count ?? 0),
    };
}

export async function fetchUnlockedCodes(userId: string): Promise<Map<string, string>> {
    const result = await pool.query<UnlockedRow>(
        `SELECT achievement_code, unlocked_at
         FROM user_achievements
         WHERE user_id = $1`,
        [userId]
    );
    return new Map(result.rows.map((row) => [row.achievement_code, row.unlocked_at.toISOString()]));
}

// 幂等批量解锁：并发重复解锁由 ON CONFLICT 静默跳过
export async function insertUnlockedCodes(userId: string, codes: string[]): Promise<void> {
    if (codes.length === 0) {
        return;
    }
    const placeholders = codes.map((_, index) => `($1,$${index + 2})`).join(',');
    await pool.query(
        `INSERT INTO user_achievements (user_id, achievement_code)
         VALUES ${placeholders}
         ON CONFLICT (user_id, achievement_code) DO NOTHING`,
        [userId, ...codes]
    );
}

export async function fetchEquippedTitle(userId: string): Promise<string | null> {
    const result = await pool.query<TitleRow>('SELECT equipped_title FROM users WHERE id = $1', [userId]);
    return result.rows[0]?.equipped_title ?? null;
}

export async function updateEquippedTitle(userId: string, title: string | null): Promise<void> {
    await pool.query('UPDATE users SET equipped_title = $2, updated_at = now() WHERE id = $1', [userId, title]);
}
