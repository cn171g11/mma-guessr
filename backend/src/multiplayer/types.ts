import type { GameMode } from '../games/types.js';
import type { LocationRecord } from '../locations/types.js';

export interface MPPlayerState {
    socketId: string;
    playerId: string;
    role: 'user' | 'guest';
    username: string;
    totalScore: number;
    roundScore: number;
    roundDistanceKm: number | null;
    hasAnswered: boolean;
}

export interface MPRoundResult {
    playerId: string;
    distanceKm: number | null;
    score: number;
}

export interface MPRoundHistory {
    locationId: number;
    locationName: string;
    results: MPRoundResult[];
}

export type MPRoomStatus = 'playing' | 'finished';

export interface MPRoomState {
    id: string;
    mode: GameMode;
    status: MPRoomStatus;
    roundIndex: number;
    players: MPPlayerState[];
    location: LocationRecord | null;
    roundEndsAt: number;
    rounds: MPRoundHistory[];
}
