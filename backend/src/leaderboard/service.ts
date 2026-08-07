import { APP_CONSTANTS } from '../config/env.js';
import { redis } from '../db/redis.js';
import type { GameMode } from '../games/types.js';
import { createLogger } from '../logger/index.js';
import * as cache from './cache.js';
import * as repository from './repository.js';
import type { LeaderboardEntry, LeaderboardQuery } from './types.js';

const log = createLogger('leaderboard');

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

let nightlyRebuildTimer: NodeJS.Timeout | null = null;

// 先落库后更新 ZSET：DB 是权威数据源，ZSET 更新失败静默降级，由每日重建校准
export async function recordScore(userId: string, mode: GameMode, score: number): Promise<void> {
    await repository.insertScore(userId, mode, score);
    const keys = [cache.overallKeyFor(mode), cache.dailyKeyFor(mode, cache.utcDateKey(new Date()))];
    for (const key of keys) {
        try {
            await cache.upsertBestScore(key, userId, score);
        } catch (err) {
            log.warn(`排行榜缓存更新失败 key=${key}，等待每日重建校准`, (err as Error).message);
        }
    }
}

export async function getRankings(query: LeaderboardQuery): Promise<LeaderboardEntry[]> {
    const todayKey = cache.utcDateKey(new Date());
    const dateKey = query.date === undefined ? todayKey : cache.utcDateKey(new Date(`${query.date}T00:00:00Z`));
    const isOverall = query.period === 'overall';
    const key = isOverall ? cache.overallKeyFor(query.mode) : cache.dailyKeyFor(query.mode, dateKey);

    if (!(await cache.keyExists(key))) {
        // 惰性重建只覆盖总榜与“今天”的日榜；历史日榜数据已按保留期清理，
        // 缺键直接返回空榜，防止任意旧日期被用作全表扫描放大器。
        // 重建以 Redis NX 锁限频（60s 一次），避免公开接口并发触发重复重建。
        if (isOverall || dateKey === todayKey) {
            if (await cache.tryAcquireRebuildLock()) {
                try {
                    await rebuildRankings();
                } finally {
                    await cache.releaseRebuildLock();
                }
            }
        }
    }

    const scores = await cache.fetchTopScores(key, query.limit);
    const usernames = await repository.fetchUsernames(scores.map((entry) => entry.id));
    return scores.map((entry) => ({
        id: entry.id,
        username: usernames.get(entry.id) ?? '未知玩家',
        score: entry.score,
    }));
}

export async function rebuildRankings(): Promise<void> {
    const todayKey = cache.utcDateKey(new Date());
    const [overallRows, dailyRows] = await Promise.all([
        repository.fetchBestScores(null),
        repository.fetchBestScores(todayKey),
    ]);

    const pipeline = redis.multi();
    for (const row of overallRows) {
        pipeline.zadd(cache.overallKeyFor(row.mode), Number(row.score), row.user_id);
    }
    for (const row of dailyRows) {
        pipeline.zadd(cache.dailyKeyFor(row.mode, todayKey), Number(row.score), row.user_id);
    }
    const results = await pipeline.exec();
    for (const result of results ?? []) {
        if (result[0] !== null) {
            throw result[0];
        }
    }

    const boundary = cache.utcDateKey(
        new Date(Date.now() - APP_CONSTANTS.LEADERBOARD_DAILY_RETENTION_DAYS * MILLISECONDS_PER_DAY)
    );
    await cache.deleteStaleDailyKeys(boundary);

    log.info(`排行榜缓存已重建 overall=${overallRows.length} daily=${dailyRows.length}`);
}

// 每天 UTC 0:00 校准一次；生产环境外不启用定时器，测试用 lazy rebuild 等价覆盖
export function scheduleNightlyRebuild(): void {
    const now = new Date();
    const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const delayMs = nextMidnight - now.getTime();
    nightlyRebuildTimer = setTimeout(() => {
        void rebuildRankings()
            .catch((err: unknown) => log.error('每日重建失败', err))
            .finally(scheduleNightlyRebuild);
    }, delayMs);
    nightlyRebuildTimer.unref();
}

export function stopNightlyRebuild(): void {
    if (nightlyRebuildTimer !== null) {
        clearTimeout(nightlyRebuildTimer);
        nightlyRebuildTimer = null;
    }
}
