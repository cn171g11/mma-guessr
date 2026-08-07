import { redis } from '../db/redis.js';
import { utcDateKey } from '../utils/date.js';

const OVERALL_KEY_PREFIX = 'lb:overall:';
const DAILY_KEY_PREFIX = 'lb:daily:';

// 惰性重建锁：重建是公开接口可能触发的全表聚合，用 Redis NX 锁把重建频率限制为
// 60 秒一次，防止未认证请求反复触发全量重建拖垮数据库
const REBUILD_LOCK_KEY = 'lb:rebuild-lock';
const REBUILD_LOCK_TTL_SECONDS = 60;

// 榜单 key 使用 UTC 日期，日榜按天隔离，无需跨天清零
export function overallKeyFor(mode: string): string {
    return `${OVERALL_KEY_PREFIX}${mode}`;
}

export function dailyKeyFor(mode: string, yyyymmdd: string): string {
    return `${DAILY_KEY_PREFIX}${mode}:${yyyymmdd}`;
}

export { utcDateKey };

export async function keyExists(key: string): Promise<boolean> {
    return (await redis.exists(key)) === 1;
}

export async function tryAcquireRebuildLock(): Promise<boolean> {
    const result = await redis.set(REBUILD_LOCK_KEY, '1', 'EX', REBUILD_LOCK_TTL_SECONDS, 'NX');
    return result === 'OK';
}

export async function releaseRebuildLock(): Promise<void> {
    await redis.del(REBUILD_LOCK_KEY);
}

// GT：仅当新分数高于当前分数时更新已有成员，新成员直接写入，天然保持"最高分上榜"语义
export async function upsertBestScore(key: string, member: string, score: number): Promise<void> {
    await redis.zadd(key, 'GT', score, member);
}

export async function fetchTopScores(key: string, limit: number): Promise<Array<{ id: string; score: number }>> {
    const raw = await redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
    const entries: Array<{ id: string; score: number }> = [];
    for (let index = 0; index + 1 < raw.length; index += 2) {
        const member = raw[index];
        const score = raw[index + 1];
        if (member === undefined || score === undefined) {
            continue;
        }
        entries.push({ id: member, score: Number(score) });
    }
    return entries;
}

// 清理超过保留天数的旧日榜 key，重建任务在写入新数据后调用
export async function deleteStaleDailyKeys(boundaryKey: string): Promise<void> {
    const staleKeys: string[] = [];
    const stream = redis.scanStream({ match: 'lb:daily:*', count: 200 });
    for await (const batch of stream) {
        for (const key of batch) {
            if (typeof key !== 'string') {
                continue;
            }
            const datePart = key.slice(key.lastIndexOf(':') + 1);
            if (datePart < boundaryKey) {
                staleKeys.push(key);
            }
        }
    }
    if (staleKeys.length > 0) {
        await redis.del(...staleKeys);
    }
}
