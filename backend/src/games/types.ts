export const GAME_MODES = ['classic', 'challenge', 'region', 'china', 'endless'] as const;

export type GameMode = (typeof GAME_MODES)[number];

export type PlayerRole = 'guest' | 'user';

export interface PlayerRef {
    role: PlayerRole;
    id: string;
}

export interface GameRoundInput {
    name: string;
    distanceKm: number | null;
    score: number;
    imageId: string | null;
    xp: number;
    difficulty: number;
}

export interface SubmitGameInput {
    mode: GameMode;
    region: string | null;
    totalScore: number;
    rounds: GameRoundInput[];
}

export interface GameRecord extends SubmitGameInput {
    id: number;
    createdAt: string;
}
