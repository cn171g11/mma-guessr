export const GAME_MODES = ['classic', 'challenge', 'region', 'china', 'endless', 'daily', 'duel', 'landmark'] as const;

export type GameMode = (typeof GAME_MODES)[number];

export type PlayerRole = 'guest' | 'user';

export interface PlayerRef {
    role: PlayerRole;
    id: string;
}

export interface GameRoundInput {
    name: string;
    locationId?: number | null;
    distanceKm: number | null;
    score: number;
    imageId: string | null;
    xp: number;
    difficulty: number;
    guessLat?: number | null;
    guessLng?: number | null;
    answerLat?: number | null;
    answerLng?: number | null;
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
