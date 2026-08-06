import { APP_CONSTANTS } from '../config/env.js';
import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import * as cache from './cache.js';
import * as repository from './repository.js';
import type { LocationRecord, LocationRegion, LocationStats } from './types.js';

const log = createLogger('locations');

const STATS_KEY = 'locations:stats';

export interface RandomLocationsQuery {
    region?: LocationRegion;
    difficulty?: number;
    count: number;
}

// 命中 Redis 中的题目 ID 池，未命中则从数据库重建并设置 TTL；
// 池中仅存 ID，全量记录只有抽中的少数几条才回源查询，降低数据库压力
async function ensurePool(key: string, region?: LocationRegion, difficulty?: number): Promise<void> {
    if (await cache.poolExists(key)) {
        return;
    }
    const ids = await repository.fetchPoolIds(region, difficulty);
    const ttl =
        ids.length > 0 ? APP_CONSTANTS.LOCATION_POOL_TTL_SECONDS : APP_CONSTANTS.LOCATION_POOL_EMPTY_TTL_SECONDS;
    await cache.warmPool(key, ids, ttl);
    log.info(`题库池 ${key} 已重建（${ids.length} 条，TTL ${ttl}s）`);
}

export async function getRandomLocations(query: RandomLocationsQuery): Promise<LocationRecord[]> {
    const region = query.region ?? cache.POOL_ALL;
    const difficulty = query.difficulty !== undefined ? String(query.difficulty) : cache.POOL_ALL;
    const key = cache.poolKeyFor(region, difficulty);

    await ensurePool(key, query.region, query.difficulty);

    const ids = await cache.randomFromPool(key, query.count);
    if (ids.length === 0) {
        return [];
    }
    return repository.fetchByIds(ids.map((id) => Number(id)));
}

export async function getLocationsByIds(ids: number[]): Promise<LocationRecord[]> {
    return repository.fetchByIds(ids);
}

export async function getLocationStats(): Promise<LocationStats> {
    const cached = await redis.get(STATS_KEY);
    if (cached !== null) {
        return JSON.parse(cached) as LocationStats;
    }

    const counts = await repository.fetchRegionCounts();
    const stats: LocationStats = {
        total: counts.reduce((sum, entry) => sum + entry.count, 0),
        byRegion: Object.fromEntries(counts.map((entry) => [entry.region, entry.count])) as LocationStats['byRegion'],
    };
    await redis.set(STATS_KEY, JSON.stringify(stats), 'EX', APP_CONSTANTS.LOCATION_STATS_TTL_SECONDS);
    return stats;
}
