import crypto from 'node:crypto';

import { APP_CONSTANTS } from '../config/env.js';
import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import { signGuestToken } from './tokens.js';

const log = createLogger('auth:guest');

const GUEST_PROFILE_KEY_PREFIX = 'guest:';
const GUEST_PROGRESS_KEY_PREFIX = 'guest_progress:';
const USER_PROGRESS_KEY_PREFIX = 'user_progress:';
const TTL_SECONDS = APP_CONSTANTS.GUEST_TTL_SECONDS;

export interface GuestSession {
    guestId: string;
    guestToken: string;
    username: string;
}

export interface GuestProfile {
    guestId: string;
    username: string;
    createdAt: string;
}

export interface GameProgressSnapshot {
    totalRounds: number;
    totalScore: number;
    bestScore: number;
    correctGuesses: number;
}

type ProgressHash = Partial<GameProgressSnapshot>;

const profileKeyFor = (guestId: string): string => `${GUEST_PROFILE_KEY_PREFIX}${guestId}`;
const guestProgressKeyFor = (guestId: string): string => `${GUEST_PROGRESS_KEY_PREFIX}${guestId}`;
const userProgressKeyFor = (userId: string): string => `${USER_PROGRESS_KEY_PREFIX}${userId}`;

function buildGuestUsername(guestId: string): string {
    return `游客_${guestId.slice(0, 4)}`;
}

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export async function createGuestSession(): Promise<GuestSession> {
    const guestId = crypto.randomUUID();
    const username = buildGuestUsername(guestId);

    await redis.hset(profileKeyFor(guestId), { username, createdAt: new Date().toISOString() });
    await redis.expire(profileKeyFor(guestId), TTL_SECONDS);

    log.info(`创建游客会话 guestId=${guestId}`);
    return { guestId, guestToken: signGuestToken(guestId), username };
}

export async function getGuestProfile(guestId: string): Promise<GuestProfile | null> {
    const rawProfile = await redis.hgetall(profileKeyFor(guestId));
    if (Object.keys(rawProfile).length === 0) {
        return null;
    }
    return {
        guestId,
        username: rawProfile.username ?? buildGuestUsername(guestId),
        createdAt: rawProfile.createdAt ?? new Date(0).toISOString(),
    };
}

export async function getGuestProgress(guestId: string): Promise<GameProgressSnapshot | null> {
    const rawValues = await redis.hgetall(guestProgressKeyFor(guestId));
    if (Object.keys(rawValues).length === 0) {
        return null;
    }
    return {
        totalRounds: toNumber(rawValues.totalRounds),
        totalScore: toNumber(rawValues.totalScore),
        bestScore: toNumber(rawValues.bestScore),
        correctGuesses: toNumber(rawValues.correctGuesses),
    };
}

export async function upsertGuestProgress(guestId: string, snapshot: GameProgressSnapshot): Promise<void> {
    await redis.hset(guestProgressKeyFor(guestId), snapshot);
    await redis.expire(guestProgressKeyFor(guestId), TTL_SECONDS);
}

export async function mergeGuestProgressIntoUser(guestId: string, userId: string): Promise<number> {
    const profileKey = profileKeyFor(guestId);
    const guestProgressKey = guestProgressKeyFor(guestId);
    const userProgressKey = userProgressKeyFor(userId);

    const [profileExists, guestRawValues] = await Promise.all([
        redis.exists(profileKey),
        redis.hgetall(guestProgressKey),
    ]);
    if (profileExists === 0) {
        throw new Error(`游客身份不存在或已过期：${guestId}`);
    }

    const guestProgress = {
        totalRounds: toNumber(guestRawValues.totalRounds),
        totalScore: toNumber(guestRawValues.totalScore),
        bestScore: toNumber(guestRawValues.bestScore),
        correctGuesses: toNumber(guestRawValues.correctGuesses),
    };

    if (Object.keys(guestRawValues).length > 0) {
        const userRawValues = await redis.hgetall(userProgressKey);
        const mergedProgress = mergeProgress(guestProgress, {
            totalRounds: toNumber(userRawValues.totalRounds),
            totalScore: toNumber(userRawValues.totalScore),
            bestScore: toNumber(userRawValues.bestScore),
            correctGuesses: toNumber(userRawValues.correctGuesses),
        });
        await redis.hset(userProgressKey, mergedProgress);
        await redis.expire(userProgressKey, TTL_SECONDS);
        log.info(`游客 ${guestId} 的游戏进度已迁移至用户 ${userId}`);
    }

    await redis.del(profileKey);
    await redis.del(guestProgressKey);
    return Object.keys(guestRawValues).length;
}

function mergeProgress(guestProgress: GameProgressSnapshot, userProgress: ProgressHash): ProgressHash {
    return {
        totalRounds: guestProgress.totalRounds + toNumber(userProgress.totalRounds),
        totalScore: guestProgress.totalScore + toNumber(userProgress.totalScore),
        bestScore: Math.max(guestProgress.bestScore, toNumber(userProgress.bestScore)),
        correctGuesses: guestProgress.correctGuesses + toNumber(userProgress.correctGuesses),
    };
}
