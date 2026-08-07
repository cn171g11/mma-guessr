import type { PlayerRef } from '../games/types.js';
import { createLogger } from '../logger/index.js';
import { badRequest } from '../utils/httpError.js';
import { ACHIEVEMENT_BY_CODE } from './definitions.js';
import * as repository from './repository.js';
import type { AchievementAggregates, AchievementsPayload, AchievementView } from './types.js';

const log = createLogger('achievements');

// 成就解锁判定：命中条件即纳入本次解锁集合。
// 条件基于服务端权威的 game_results 聚合，玩家无法伪造数据触发。
export function evaluateUnlocked(aggregates: AchievementAggregates): string[] {
    const accuracy = aggregates.totalRounds > 0 ? (aggregates.correctGuesses / aggregates.totalRounds) * 100 : 0;
    const conditions: ReadonlyArray<[string, boolean]> = [
        ['first_game', aggregates.totalGames >= 1],
        ['games_10', aggregates.totalGames >= 10],
        ['games_100', aggregates.totalGames >= 100],
        ['rounds_100', aggregates.totalRounds >= 100],
        ['score_100k', aggregates.totalScore >= 100_000],
        ['perfect_round', aggregates.perfectRounds >= 1],
        ['perfect_game', aggregates.perfectGames >= 1],
        ['mode_master', aggregates.distinctModes >= 7],
        ['daily_regular', aggregates.dailyCount >= 7],
        ['daily_30', aggregates.dailyCount >= 30],
        ['accuracy_90', accuracy >= 90],
        ['best_20k', aggregates.bestScore >= 20_000],
        ['china_10', aggregates.chinaCount >= 10],
        ['landmark_10', aggregates.landmarkCount >= 10],
    ];
    return conditions.filter(([, met]) => met).map(([code]) => code);
}

// 新成绩落库后调用：聚合 → 判定 → 只插入新增项。
// 内部捕获异常，成就系统故障绝不影响成绩上报主流程。
export async function evaluateAndUnlock(userId: string): Promise<void> {
    try {
        const [aggregates, unlocked] = await Promise.all([
            repository.fetchAggregates(userId),
            repository.fetchUnlockedCodes(userId),
        ]);
        const newlyUnlocked = evaluateUnlocked(aggregates).filter((code) => !unlocked.has(code));
        if (newlyUnlocked.length === 0) {
            return;
        }
        await repository.insertUnlockedCodes(userId, newlyUnlocked);
        log.info(`成就解锁 user=${userId} codes=${newlyUnlocked.join(',')}`);
    } catch (err) {
        log.warn('成就判定失败（不影响成绩上报）', (err as Error).message);
    }
}

// 成就仅对注册用户开放（游客不上榜、不参与成就体系）
function requireUser(player: PlayerRef): void {
    if (player.role !== 'user') {
        throw badRequest('成就系统仅对注册用户开放，请先登录');
    }
}

export async function getAchievements(player: PlayerRef): Promise<AchievementsPayload> {
    requireUser(player);
    const [unlocked, equippedTitle] = await Promise.all([
        repository.fetchUnlockedCodes(player.id),
        repository.fetchEquippedTitle(player.id),
    ]);
    const achievements: AchievementView[] = [...ACHIEVEMENT_BY_CODE.values()].map((meta) => ({
        ...meta,
        unlockedAt: unlocked.get(meta.code) ?? null,
    }));
    return { achievements, equippedTitle };
}

// 装备 / 卸下称号：仅允许玩家已解锁且可作称号的成就
export async function equipTitle(player: PlayerRef, title: string | null): Promise<string | null> {
    requireUser(player);
    if (title === null || title === '') {
        await repository.updateEquippedTitle(player.id, null);
        return null;
    }
    const unlocked = await repository.fetchUnlockedCodes(player.id);
    const matching = [...ACHIEVEMENT_BY_CODE.values()].find((meta) => meta.hasTitle && meta.title === title);
    if (matching === undefined) {
        throw badRequest('该称号不存在');
    }
    if (!unlocked.has(matching.code)) {
        throw badRequest('尚未解锁该称号对应的成就');
    }
    await repository.updateEquippedTitle(player.id, title);
    return title;
}
