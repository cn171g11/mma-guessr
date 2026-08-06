import { APP_CONSTANTS } from '../config/env.js';
import type { LocationRecord } from '../locations/types.js';
import * as locationsService from '../locations/service.js';
import { badRequest, conflict } from '../utils/httpError.js';
import { secondsUntilUtcMidnight, utcDateString } from '../utils/date.js';
import type { PlayerRef } from '../games/types.js';
import { createLogger } from '../logger/index.js';
import * as cache from './cache.js';
import * as repository from './repository.js';

const log = createLogger('daily');

export interface DailyChallenge {
    date: string;
    locations: LocationRecord[];
    played: boolean;
}

// 惰性抽题：当天首次访问时从题库抽取固定题数入库，全天保持不变
async function resolveTodayIds(): Promise<number[]> {
    const date = utcDateString(new Date());
    const existing = await repository.fetchTodayIds(date);
    if (existing !== null) {
        return existing;
    }

    const drawn = await locationsService.getRandomLocations({ count: APP_CONSTANTS.DAILY_CHALLENGE_ROUNDS });
    const ids = drawn.map((location) => location.id);
    const stored = await repository.upsertToday(date, ids);
    log.info(`每日挑战题单已生成 date=${date} ids=${ids.length}`);
    return stored;
}

export async function getToday(player: PlayerRef): Promise<DailyChallenge> {
    const date = utcDateString(new Date());
    const ids = await resolveTodayIds();
    const locations = await locationsService.getLocationsByIds(ids);
    const played = await cache.isClaimed(cache.dailyPlayedKeyFor(player.id, date));

    // 题库重建（如重跑 seed 变更了题目自增 ID）会使当天已存题单失效，
    // 检测到题目缺失时重新抽题修复，避免当天挑战变成空题单
    if (locations.length < ids.length) {
        const redrawn = await locationsService.getRandomLocations({ count: APP_CONSTANTS.DAILY_CHALLENGE_ROUNDS });
        await repository.upsertToday(date, redrawn.map((location) => location.id));
        log.warn(`每日题单检测到失效条目 ${locations.length}/${ids.length}，已重新抽题 date=${date}`);
        return { date, locations: redrawn, played };
    }
    return { date, locations, played };
}

// 每日挑战提交前置校验：仅注册用户可参与，且当天仅一次
export async function guardDailySubmission(player: PlayerRef): Promise<void> {
    if (player.role !== 'user') {
        throw badRequest('每日挑战需登录后参与');
    }
    const date = utcDateString(new Date());
    const claimed = await cache.tryClaimDaily(cache.dailyPlayedKeyFor(player.id, date), secondsUntilUtcMidnight());
    if (!claimed) {
        throw conflict('今日挑战已完成，不能重复提交');
    }
}
