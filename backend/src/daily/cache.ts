import { redis } from '../db/redis.js';

const DAILY_PLAYED_KEY_PREFIX = 'user_daily:';

// Redis 防重复提交：user_daily:<user_id>:<date>，TTL 为当天剩余秒数
export function dailyPlayedKeyFor(userId: string, date: string): string {
    return `${DAILY_PLAYED_KEY_PREFIX}${userId}:${date}`;
}

// 原子占位：不存在时写入并返回 true，已存在返回 false，避免并发重复提交
export async function tryClaimDaily(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
}

export async function isClaimed(key: string): Promise<boolean> {
    return (await redis.exists(key)) === 1;
}
