import type { GameMode } from '../games/types.js';

export const LEADERBOARD_PERIODS = ['daily', 'overall'] as const;

export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export interface LeaderboardQuery {
    period: LeaderboardPeriod;
    mode: GameMode;
    limit: number;
    date?: string;
}

export interface LeaderboardEntry {
    id: string;
    username: string;
    score: number;
}
