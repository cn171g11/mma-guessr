import { getUserProfile } from '../auth/accounts.js';
import { getGuestProfile } from '../auth/guest.js';
import { APP_CONSTANTS } from '../config/env.js';
import { redis } from '../db/redis.js';
import type { PlayerRef } from '../games/types.js';
import { createLogger } from '../logger/index.js';
import * as repository from './repository.js';

const log = createLogger('profile');

const STATS_CACHE_KEY_PREFIX = 'profile:stats:';

export interface PlayerProfile {
    username: string;
    role: PlayerRef['role'];
    stats: repository.ProfileAggregation;
}

function statsCacheKeyFor(player: PlayerRef): string {
    return `${STATS_CACHE_KEY_PREFIX}${player.role}:${player.id}`;
}

async function resolveUsername(player: PlayerRef): Promise<string> {
    if (player.role === 'guest') {
        const profile = await getGuestProfile(player.id);
        return profile?.username ?? `游客_${player.id.slice(0, 4)}`;
    }
    const userProfile = await getUserProfile(player.id);
    return userProfile.username;
}

// 聚合结果缓存 5 分钟；缓存读写失败时回源数据库，统计本身始终可用
async function fetchOrBuildStats(player: PlayerRef): Promise<repository.ProfileAggregation> {
    const cacheKey = statsCacheKeyFor(player);
    try {
        const cached = await redis.get(cacheKey);
        if (cached !== null) {
            return JSON.parse(cached) as repository.ProfileAggregation;
        }
        const stats = await repository.fetchAggregation(player);
        await redis.set(cacheKey, JSON.stringify(stats), 'EX', APP_CONSTANTS.PROFILE_STATS_TTL_SECONDS);
        return stats;
    } catch (err) {
        log.warn('统计缓存读写失败，回源数据库', (err as Error).message);
        return repository.fetchAggregation(player);
    }
}

export async function getProfile(player: PlayerRef): Promise<PlayerProfile> {
    const [username, stats] = await Promise.all([resolveUsername(player), fetchOrBuildStats(player)]);
    return { username, role: player.role, stats };
}

// 新成绩落库后立即使统计缓存失效，避免刚打完一场却看到旧数据
export async function invalidateStatsCache(player: PlayerRef): Promise<void> {
    try {
        await redis.del(statsCacheKeyFor(player));
    } catch (err) {
        log.warn('统计缓存失效失败', (err as Error).message);
    }
}
