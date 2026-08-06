import { getProgress, upsertProgress } from '../auth/guest.js';
import { createLogger } from '../logger/index.js';
import { badRequest, notFound } from '../utils/httpError.js';
import * as repository from './repository.js';
import type { GameMode, GameRecord, PlayerRef, SubmitGameInput } from './types.js';

const log = createLogger('games');

// 乐观校验：客户端计分的总分必须与回合明细一致，堵住明显刷分请求
function assertScoreConsistent(input: SubmitGameInput): void {
    const sum = input.rounds.reduce((total, round) => total + round.score, 0);
    if (sum !== input.totalScore) {
        throw badRequest('总分与回合明细不一致');
    }
}

function countScoredRounds(input: SubmitGameInput): number {
    return input.rounds.filter((round) => round.score > 0).length;
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
    assertScoreConsistent(input);
    const game = await repository.insertGameRecord(player, input);
    await accumulateProgress(player, input);
    log.info(`游戏成绩已记录 player=${player.role}:${player.id} mode=${input.mode} score=${input.totalScore}`);
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
