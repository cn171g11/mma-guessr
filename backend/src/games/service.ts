import { getProgress, upsertProgress } from '../auth/guest.js';
import * as dailyService from '../daily/service.js';
import * as leaderboardService from '../leaderboard/service.js';
import * as profileService from '../profile/service.js';
import { createLogger } from '../logger/index.js';
import { badRequest, notFound } from '../utils/httpError.js';
import * as repository from './repository.js';
import { computeRoundScore, haversineKm } from './scoring.js';
import type { GameMode, GameRecord, GameRoundInput, PlayerRef, SubmitGameInput } from './types.js';

const log = createLogger('games');

// 距离重算与前端 Leaflet 结果允许的误差：绝对 50m 或相对 2%，取较大者
const DISTANCE_ABSOLUTE_TOLERANCE_KM = 0.05;
const DISTANCE_RELATIVE_TOLERANCE = 0.02;

interface RoundGeometry {
    guessLat: number;
    guessLng: number;
    answerLat: number;
    answerLng: number;
}

function countScoredRounds(input: SubmitGameInput): number {
    return input.rounds.filter((round) => round.score > 0).length;
}

function roundGeometryOf(round: GameRoundInput): RoundGeometry | null {
    if (
        round.guessLat !== null &&
        round.guessLat !== undefined &&
        round.guessLng !== null &&
        round.guessLng !== undefined &&
        round.answerLat !== null &&
        round.answerLat !== undefined &&
        round.answerLng !== null &&
        round.answerLng !== undefined
    ) {
        return {
            guessLat: round.guessLat,
            guessLng: round.guessLng,
            answerLat: round.answerLat,
            answerLng: round.answerLng,
        };
    }
    return null;
}

function distanceWithinTolerance(computedKm: number, claimedKm: number): boolean {
    const tolerance = Math.max(DISTANCE_ABSOLUTE_TOLERANCE_KM, claimedKm * DISTANCE_RELATIVE_TOLERANCE);
    return Math.abs(computedKm - claimedKm) <= tolerance;
}

// 服务端权威校验单轮：按公式重算得分并与提交值比对，不一致即拒绝
function verifyRoundScore(input: SubmitGameInput, round: GameRoundInput): number {
    if (round.distanceKm === null) {
        if (round.score !== 0) {
            throw badRequest('超时轮得分必须为 0');
        }
        return 0;
    }
    const geometry = roundGeometryOf(round);
    if (geometry !== null) {
        const computedDistance = haversineKm(
            geometry.guessLat,
            geometry.guessLng,
            geometry.answerLat,
            geometry.answerLng
        );
        if (!distanceWithinTolerance(computedDistance, round.distanceKm)) {
            throw badRequest('距离与提交坐标不符');
        }
    }
    const expectedScore = computeRoundScore(input.mode, input.region, round.distanceKm);
    if (round.score !== expectedScore) {
        throw badRequest('单轮得分与距离不符');
    }
    return expectedScore;
}

// 每日挑战整局权威结算：游玩期间答案坐标完全不透出客户端，
// 服务端依据今日题单真实坐标与提交的猜测点重算距离与得分，
// 最终成绩记录中回传答案坐标仅用于整局结束后的结算展示
async function verifyDailyRoundsAuthoritative(
    input: SubmitGameInput
): Promise<Array<{ round: GameRoundInput; score: number }>> {
    const todayLocations = await dailyService.getTodayLocationRecords();
    const locationById = new Map(todayLocations.map((location) => [location.id, location]));
    return input.rounds.map((round) => {
        const location = typeof round.locationId === 'number' ? locationById.get(round.locationId) : undefined;
        if (location === undefined) {
            throw badRequest('回合题目不属于今日挑战题单');
        }
        if (round.distanceKm !== null || round.answerLat !== null || round.answerLng !== null) {
            throw badRequest('每日挑战由服务端权威结算，客户端不得携带距离或答案坐标');
        }
        const hasGuess =
            round.guessLat !== null &&
            round.guessLat !== undefined &&
            round.guessLng !== null &&
            round.guessLng !== undefined;
        if (!hasGuess) {
            return {
                round: {
                    ...round,
                    distanceKm: null,
                    score: 0,
                    answerLat: location.lat,
                    answerLng: location.lng,
                },
                score: 0,
            };
        }
        const distanceKm = haversineKm(round.guessLat!, round.guessLng!, location.lat, location.lng);
        const score = computeRoundScore(input.mode, input.region, distanceKm);
        return {
            round: {
                ...round,
                distanceKm,
                score,
                answerLat: location.lat,
                answerLng: location.lng,
            },
            score,
        };
    });
}

// 进度快照保存在 Redis Hash（guest_progress: / user_progress:），供 /me 与 summary 直接读取
async function accumulateProgress(player: PlayerRef, input: SubmitGameInput): Promise<void> {
    const current = (await getProgress(player.role, player.id)) ?? {
        totalRounds: 0,
        totalScore: 0,
        bestScore: 0,
        correctGuesses: 0,
    };
    await upsertProgress(player.role, player.id, {
        totalRounds: current.totalRounds + input.rounds.length,
        totalScore: current.totalScore + input.totalScore,
        bestScore: Math.max(current.bestScore, input.totalScore),
        correctGuesses: current.correctGuesses + countScoredRounds(input),
    });
}

export async function submitGame(player: PlayerRef, input: SubmitGameInput): Promise<GameRecord> {
    let verified: Array<{ round: GameRoundInput; score: number }>;
    if (input.mode === 'daily') {
        // 每日挑战：距离/得分/答案全部由服务端权威结算，客户端提交的总分不参与校验
        verified = await verifyDailyRoundsAuthoritative(input);
        await dailyService.guardDailySubmission(player);
    } else {
        verified = input.rounds.map((round) => ({ round, score: verifyRoundScore(input, round) }));
        const verifiedTotal = verified.reduce((total, entry) => total + entry.score, 0);
        if (input.totalScore !== verifiedTotal) {
            throw badRequest('总分与回合得分不符');
        }
    }
    const verifiedTotal = verified.reduce((total, entry) => total + entry.score, 0);
    const verifiedInput: SubmitGameInput = {
        ...input,
        totalScore: verifiedTotal,
        rounds: verified.map((entry) => ({ ...entry.round, score: entry.score })),
    };

    const game = await repository.insertGameRecord(player, verifiedInput);
    await accumulateProgress(player, verifiedInput);
    await profileService.invalidateStatsCache(player);
    if (player.role === 'user') {
        await leaderboardService.recordScore(player.id, input.mode, verifiedTotal);
    }
    log.info(`游戏成绩已记录 player=${player.role}:${player.id} mode=${input.mode} score=${verifiedTotal}`);
    return game;
}

export async function getRecentGames(player: PlayerRef, limit: number): Promise<GameRecord[]> {
    return repository.fetchRecentGames(player, limit);
}

export async function getBestGame(player: PlayerRef, mode: GameMode): Promise<GameRecord | null> {
    return repository.fetchBestGame(player, mode);
}

export async function deleteGame(player: PlayerRef, gameId: number): Promise<void> {
    const deleted = await repository.deleteGameRecord(player, gameId);
    if (!deleted) {
        throw notFound('游戏记录不存在');
    }
}
