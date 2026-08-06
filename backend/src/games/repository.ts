import type { QueryResultRow } from 'pg';

import { pool } from '../db/pool.js';
import type { GameMode, GameRecord, GameRoundInput, PlayerRef, SubmitGameInput } from './types.js';

interface GameRow extends QueryResultRow {
    id: string;
    mode: string;
    region: string | null;
    total_score: string;
    rounds: unknown;
    created_at: string;
}

function mapGameRow(row: GameRow): GameRecord {
    return {
        id: Number(row.id),
        mode: row.mode as GameMode,
        region: row.region,
        totalScore: Number(row.total_score),
        rounds: row.rounds as GameRoundInput[],
        createdAt: new Date(row.created_at).toISOString(),
    };
}

export async function insertGameRecord(player: PlayerRef, input: SubmitGameInput): Promise<GameRecord> {
    const result = await pool.query<GameRow>(
        `INSERT INTO game_results (player_type, player_id, mode, region, total_score, rounds)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [player.role, player.id, input.mode, input.region, input.totalScore, JSON.stringify(input.rounds)]
    );
    const gameRow = result.rows[0];
    if (gameRow === undefined) {
        throw new Error('写入游戏记录失败：未返回记录');
    }
    return mapGameRow(gameRow);
}

export async function fetchRecentGames(player: PlayerRef, limit: number): Promise<GameRecord[]> {
    const result = await pool.query<GameRow>(
        `SELECT * FROM game_results
         WHERE player_type = $1 AND player_id = $2
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [player.role, player.id, limit]
    );
    return result.rows.map(mapGameRow);
}

export async function fetchBestGame(player: PlayerRef, mode: GameMode): Promise<GameRecord | null> {
    const result = await pool.query<GameRow>(
        `SELECT * FROM game_results
         WHERE player_type = $1 AND player_id = $2 AND mode = $3
         ORDER BY total_score DESC, created_at DESC
         LIMIT 1`,
        [player.role, player.id, mode]
    );
    const gameRow = result.rows[0];
    return gameRow === undefined ? null : mapGameRow(gameRow);
}

export async function deleteGameRecord(player: PlayerRef, gameId: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM game_results WHERE id = $1 AND player_type = $2 AND player_id = $3', [
        gameId,
        player.role,
        player.id,
    ]);
    return (result.rowCount ?? 0) > 0;
}
