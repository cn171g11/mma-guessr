import type { QueryResultRow } from 'pg';

import { pool } from '../db/pool.js';
import type { GameMode, PlayerRef } from '../games/types.js';

interface AggregateRow extends QueryResultRow {
    total_games: string;
    total_rounds: string;
    total_score: string;
    avg_score: string;
    best_score: string;
}

interface CountRow extends QueryResultRow {
    count: string;
}

interface ModeRow extends QueryResultRow {
    mode: string;
}

interface ByModeRow extends QueryResultRow {
    mode: string;
    games: string;
    rounds: string;
    best_score: string;
    avg_score: string;
}

export interface ModeStats {
    games: number;
    rounds: number;
    bestScore: number;
    avgScore: number;
}

export interface ProfileAggregation {
    totalGames: number;
    totalRounds: number;
    totalScore: number;
    avgScore: number;
    bestScore: number;
    bestMode: GameMode | null;
    correctGuesses: number;
    accuracy: number;
    byMode: Partial<Record<GameMode, ModeStats>>;
}

export async function fetchAggregation(player: PlayerRef): Promise<ProfileAggregation> {
    const [aggregateRows, correctRows, bestModeRows, byModeRows] = await Promise.all([
        pool.query<AggregateRow>(
            `SELECT COUNT(*)::int AS total_games,
                    COALESCE(SUM(jsonb_array_length(rounds)), 0)::int AS total_rounds,
                    COALESCE(SUM(total_score), 0)::int AS total_score,
                    ROUND(COALESCE(AVG(total_score), 0), 1)::float AS avg_score,
                    COALESCE(MAX(total_score), 0)::int AS best_score
             FROM game_results
             WHERE player_type = $1 AND player_id = $2`,
            [player.role, player.id]
        ),
        pool.query<CountRow>(
            `SELECT COUNT(*)::int AS count
             FROM game_results
             CROSS JOIN LATERAL jsonb_array_elements(rounds) AS rnd
             WHERE player_type = $1 AND player_id = $2 AND (rnd->>'score')::int > 0`,
            [player.role, player.id]
        ),
        pool.query<ModeRow>(
            `SELECT mode FROM game_results
             WHERE player_type = $1 AND player_id = $2
             ORDER BY total_score DESC, id DESC
             LIMIT 1`,
            [player.role, player.id]
        ),
        pool.query<ByModeRow>(
            `SELECT mode,
                    COUNT(*)::int AS games,
                    COALESCE(SUM(jsonb_array_length(rounds)), 0)::int AS rounds,
                    COALESCE(MAX(total_score), 0)::int AS best_score,
                    ROUND(COALESCE(AVG(total_score), 0), 1)::float AS avg_score
             FROM game_results
             WHERE player_type = $1 AND player_id = $2
             GROUP BY mode`,
            [player.role, player.id]
        ),
    ]);

    const aggregate = aggregateRows.rows[0];
    if (aggregate === undefined) {
        throw new Error('游戏统计聚合失败：未返回记录');
    }

    const totalRounds = Number(aggregate.total_rounds);
    const correctGuesses = Number(correctRows.rows[0]?.count ?? 0);
    const bestModeRow = bestModeRows.rows[0];
    return {
        totalGames: Number(aggregate.total_games),
        totalRounds,
        totalScore: Number(aggregate.total_score),
        avgScore: Number(aggregate.avg_score),
        bestScore: Number(aggregate.best_score),
        bestMode: bestModeRow === undefined ? null : (bestModeRow.mode as GameMode),
        correctGuesses,
        accuracy: totalRounds > 0 ? Number(((correctGuesses / totalRounds) * 100).toFixed(1)) : 0,
        byMode: Object.fromEntries(
            byModeRows.rows.map((row) => [
                row.mode,
                {
                    games: Number(row.games),
                    rounds: Number(row.rounds),
                    bestScore: Number(row.best_score),
                    avgScore: Number(row.avg_score),
                },
            ])
        ) as ProfileAggregation['byMode'],
    };
}
