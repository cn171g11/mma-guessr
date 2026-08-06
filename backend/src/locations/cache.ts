import { redis } from '../db/redis.js';

const POOL_KEY_PREFIX = 'locations:pool:';

// 未指定区域/难度时使用该占位符，保证 key 结构统一：locations:pool:<region|all>:<difficulty|all>
export const POOL_ALL = 'all';

export const poolKeyFor = (region: string, difficulty: string): string => `${POOL_KEY_PREFIX}${region}:${difficulty}`;

export async function poolExists(key: string): Promise<boolean> {
    return (await redis.exists(key)) === 1;
}

export async function dropPool(key: string): Promise<void> {
    await redis.del(key);
}

// 空池也写入 TTL，避免无数据的分区在 TTL 内反复触发数据库查询
export async function warmPool(key: string, ids: string[], ttlSeconds: number): Promise<void> {
    const pipeline = redis.multi();
    if (ids.length > 0) {
        pipeline.sadd(key, ...ids);
    }
    pipeline.expire(key, ttlSeconds);
    const results = await pipeline.exec();
    for (const result of results ?? []) {
        if (result[0] !== null) {
            throw result[0];
        }
    }
}

export async function randomFromPool(key: string, count: number): Promise<string[]> {
    return redis.srandmember(key, count);
}
