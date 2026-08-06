import { computeRoundScore } from '../src/games/scoring.js';
import type { GameMode } from '../src/games/types.js';

// 反解服务端计分公式：找到能恰好产出 target 分的距离，用于构造必然通过校验的测试提交
function distanceForTargetScore(mode: GameMode, region: string | null, targetScore: number): number {
    if (targetScore >= 5000) {
        return 0;
    }
    let low = 0;
    let high = 40075;
    for (let i = 0; i < 200; i++) {
        const mid = (low + high) / 2;
        if (computeRoundScore(mode, region, mid) >= targetScore) {
            low = mid;
        } else {
            high = mid;
        }
    }
    while (computeRoundScore(mode, region, low) > targetScore) {
        low += 0.5;
    }
    return low;
}

// 单轮合法提交：不带坐标，走"距离→得分"校验路径
export function makeValidRound(mode: GameMode, region: string | null, targetScore: number): Record<string, unknown> {
    return {
        name: '北京·天安门',
        distanceKm: distanceForTargetScore(mode, region, targetScore),
        score: targetScore,
        imageId: null,
        xp: 0,
        difficulty: 3,
    };
}
