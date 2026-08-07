import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { computeRoundScore, haversineKm } from '../src/games/scoring.js';
import type { GameMode } from '../src/games/types.js';
import {
    closeInfra,
    getApp,
    makeRandomEmail,
    obtainVerificationCode,
    prepareDatabase,
    resetAuthState,
} from './helpers.js';

const VALID_PASSWORD = 'secret123';

// 每轮：给定答案/猜测坐标，用服务端同款公式生成必然一致的得分，保证提交通过校验
const ANSWERS = [
    { lat: 39.9055, lng: 116.3976 }, // 北京
    { lat: 31.2304, lng: 121.4737 }, // 上海
    { lat: 23.1291, lng: 113.2644 }, // 广州
];
const GUESS_OFFSETS = [
    { lat: 0.01, lng: 0.01 },
    { lat: 0.05, lng: -0.05 },
    { lat: 0.002, lng: 0.002 },
];
const DEFAULT_ANSWER = ANSWERS[0]!;
const DEFAULT_OFFSET = GUESS_OFFSETS[0]!;

function makeRound(mode: GameMode, region: string | null, index: number): Record<string, unknown> {
    const answer = ANSWERS[index] ?? DEFAULT_ANSWER;
    const offset = GUESS_OFFSETS[index] ?? DEFAULT_OFFSET;
    const guess = { lat: answer.lat + offset.lat, lng: answer.lng + offset.lng };
    const distanceKm = haversineKm(answer.lat, answer.lng, guess.lat, guess.lng);
    return {
        name: `测试点${index + 1}`,
        distanceKm,
        score: computeRoundScore(mode, region, distanceKm),
        imageId: `img-${index}`,
        xp: 0,
        difficulty: 3,
        guessLat: guess.lat,
        guessLng: guess.lng,
        answerLat: answer.lat,
        answerLng: answer.lng,
    };
}

function makeTimeoutRound(): Record<string, unknown> {
    const answer = ANSWERS[2] ?? DEFAULT_ANSWER;
    return {
        name: '超时点位',
        distanceKm: null,
        score: 0,
        imageId: null,
        xp: 0,
        difficulty: 2,
        guessLat: null,
        guessLng: null,
        answerLat: answer.lat,
        answerLng: answer.lng,
    };
}

function makeGame(
    mode: GameMode,
    region: string | null,
    roundCount: number,
    withTimeout = false
): { totalScore: number; rounds: Array<Record<string, unknown>> } {
    const rounds = Array.from({ length: roundCount }, (_, index) => makeRound(mode, region, index));
    if (withTimeout) {
        rounds.push(makeTimeoutRound());
    }
    const totalScore = rounds.reduce((sum, round) => sum + (round.score as number), 0);
    return { totalScore, rounds };
}

async function createGuestToken(): Promise<string> {
    const response = await request(getApp()).post('/api/auth/guest');
    expect(response.status).toBe(201);
    return response.body.guestToken as string;
}

async function createUserSession(): Promise<{ email: string; accessToken: string; guestToken?: string }> {
    const email = makeRandomEmail('games');
    const code = await obtainVerificationCode(email);
    const response = await request(getApp())
        .post('/api/auth/register')
        .send({ username: 'gamer01', email, password: VALID_PASSWORD, code });
    expect(response.status).toBe(201);
    return { email, accessToken: response.body.tokenPair.accessToken as string };
}

function submitGame(token: string, body: Record<string, unknown>) {
    return request(getApp()).post('/api/games').set('Authorization', `Bearer ${token}`).send(body);
}

beforeAll(async () => {
    await prepareDatabase();
});

beforeEach(async () => {
    await resetAuthState();
});

afterAll(async () => {
    await closeInfra();
});

describe('POST /api/games 提交成绩', () => {
    it('游客提交成绩成功并写入回合明细', async () => {
        const token = await createGuestToken();
        const game = makeGame('challenge', null, 3, true);
        const response = await submitGame(token, {
            mode: 'challenge',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        expect(response.status).toBe(201);
        expect(response.body.game.id).toBeTruthy();
        expect(response.body.game.rounds).toHaveLength(4);
        expect(response.body.game.totalScore).toBe(game.totalScore);
    });

    it('未登录返回 401', async () => {
        const game = makeGame('classic', null, 1);
        const response = await request(getApp())
            .post('/api/games')
            .send({ mode: 'classic', totalScore: game.totalScore, rounds: game.rounds });
        expect(response.status).toBe(401);
    });

    it('总分与回合明细不一致返回 400', async () => {
        const token = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const response = await submitGame(token, {
            mode: 'classic',
            totalScore: 9999,
            rounds: game.rounds,
        });
        expect(response.status).toBe(400);
    });

    it('单轮得分与距离不符返回 400', async () => {
        const token = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const forgedRounds = [{ ...game.rounds[0], score: 5000 }];
        const response = await submitGame(token, {
            mode: 'classic',
            totalScore: 5000,
            rounds: forgedRounds,
        });
        expect(response.status).toBe(400);
    });

    it('距离与提交坐标不符返回 400', async () => {
        const token = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const forgedDistance = 0.1;
        const forgedRounds = [
            {
                ...game.rounds[0],
                distanceKm: forgedDistance,
                score: computeRoundScore('classic', null, forgedDistance),
            },
        ];
        const response = await submitGame(token, {
            mode: 'classic',
            totalScore: forgedRounds[0]!.score as number,
            rounds: forgedRounds,
        });
        expect(response.status).toBe(400);
    });

    it('非法模式返回 400', async () => {
        const token = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const response = await submitGame(token, {
            mode: 'unknown',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        expect(response.status).toBe(400);
    });

    it('空回合列表返回 400', async () => {
        const token = await createGuestToken();
        const response = await submitGame(token, { mode: 'classic', totalScore: 0, rounds: [] });
        expect(response.status).toBe(400);
    });

    it('单轮得分超限返回 400', async () => {
        const token = await createGuestToken();
        const response = await submitGame(token, {
            mode: 'classic',
            totalScore: 99999,
            rounds: [{ name: '北京', distanceKm: 0.1, score: 99999 }],
        });
        expect(response.status).toBe(400);
    });

    it('区域模式缺少 region 返回 400', async () => {
        const token = await createGuestToken();
        const game = makeGame('region', 'asia', 1);
        const response = await submitGame(token, {
            mode: 'region',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        expect(response.status).toBe(400);
    });

    it('非区域模式携带 region 返回 400', async () => {
        const token = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const response = await submitGame(token, {
            mode: 'classic',
            region: 'asia',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        expect(response.status).toBe(400);
    });

    it('注册用户提交成绩成功', async () => {
        const session = await createUserSession();
        const game = makeGame('classic', null, 1);
        const response = await submitGame(session.accessToken, {
            mode: 'classic',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        expect(response.status).toBe(201);
    });
});

describe('GET /api/games/recent 历史记录', () => {
    it('按时间倒序返回最近记录，并受 limit 约束', async () => {
        const token = await createGuestToken();
        const classic = makeGame('classic', null, 1);
        const challenge = makeGame('challenge', null, 3, true);
        await submitGame(token, { mode: 'classic', totalScore: classic.totalScore, rounds: classic.rounds });
        await submitGame(token, { mode: 'challenge', totalScore: challenge.totalScore, rounds: challenge.rounds });

        const response = await request(getApp())
            .get('/api/games/recent?limit=1')
            .set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.games).toHaveLength(1);
        expect(response.body.games[0].mode).toBe('challenge');
    });

    it('只能看到自己的记录', async () => {
        const tokenA = await createGuestToken();
        const tokenB = await createGuestToken();
        const classic = makeGame('classic', null, 1);
        await submitGame(tokenA, { mode: 'classic', totalScore: classic.totalScore, rounds: classic.rounds });

        const response = await request(getApp()).get('/api/games/recent').set('Authorization', `Bearer ${tokenB}`);
        expect(response.status).toBe(200);
        expect(response.body.games).toHaveLength(0);
    });

    it('无记录时返回空数组', async () => {
        const token = await createGuestToken();
        const response = await request(getApp()).get('/api/games/recent').set('Authorization', `Bearer ${token}`);
        expect(response.body.games).toEqual([]);
    });
});

describe('GET /api/games/best 最佳成绩', () => {
    it('返回该模式最高分记录', async () => {
        const token = await createGuestToken();
        const low = makeGame('classic', null, 1);
        const high = makeGame('classic', null, 2);
        await submitGame(token, { mode: 'classic', totalScore: low.totalScore, rounds: low.rounds });
        await submitGame(token, { mode: 'classic', totalScore: high.totalScore, rounds: high.rounds });

        const response = await request(getApp())
            .get('/api/games/best?mode=classic')
            .set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.best.totalScore).toBe(high.totalScore);
    });

    it('不同模式互不干扰', async () => {
        const token = await createGuestToken();
        const classic = makeGame('classic', null, 1);
        const china = makeGame('china', null, 3, true);
        await submitGame(token, { mode: 'classic', totalScore: classic.totalScore, rounds: classic.rounds });
        await submitGame(token, { mode: 'china', totalScore: china.totalScore, rounds: china.rounds });

        const challengeResponse = await request(getApp())
            .get('/api/games/best?mode=challenge')
            .set('Authorization', `Bearer ${token}`);
        expect(challengeResponse.body.best).toBeNull();
    });

    it('无记录时返回 null', async () => {
        const token = await createGuestToken();
        const response = await request(getApp())
            .get('/api/games/best?mode=classic')
            .set('Authorization', `Bearer ${token}`);
        expect(response.body.best).toBeNull();
    });
});

describe('GET /api/games/summary 进度统计', () => {
    it('累计轮数/总分/最佳/猜中轮数', async () => {
        const token = await createGuestToken();
        const game = makeGame('challenge', null, 3, true);
        await submitGame(token, { mode: 'challenge', totalScore: game.totalScore, rounds: game.rounds });

        const response = await request(getApp()).get('/api/games/summary').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.progress).toMatchObject({
            totalRounds: 4,
            totalScore: game.totalScore,
            bestScore: game.totalScore,
            correctGuesses: 3,
        });
    });

    it('注册用户 /me 返回进度', async () => {
        const session = await createUserSession();
        const game = makeGame('classic', null, 1);
        await submitGame(session.accessToken, {
            mode: 'classic',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });

        const meResponse = await request(getApp())
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${session.accessToken}`);
        expect(meResponse.body.progress).toMatchObject({ totalRounds: 1, bestScore: game.totalScore });
    });
});

describe('DELETE /api/games/:id 删除记录', () => {
    it('删除自己的记录成功', async () => {
        const token = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const submitResponse = await submitGame(token, {
            mode: 'classic',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        const gameId = submitResponse.body.game.id as number;

        const deleteResponse = await request(getApp())
            .delete(`/api/games/${gameId}`)
            .set('Authorization', `Bearer ${token}`);
        expect(deleteResponse.status).toBe(200);

        const recentResponse = await request(getApp()).get('/api/games/recent').set('Authorization', `Bearer ${token}`);
        expect(recentResponse.body.games).toEqual([]);
    });

    it('删除他人记录返回 404', async () => {
        const tokenA = await createGuestToken();
        const tokenB = await createGuestToken();
        const game = makeGame('classic', null, 1);
        const submitResponse = await submitGame(tokenA, {
            mode: 'classic',
            totalScore: game.totalScore,
            rounds: game.rounds,
        });
        const gameId = submitResponse.body.game.id as number;

        const deleteResponse = await request(getApp())
            .delete(`/api/games/${gameId}`)
            .set('Authorization', `Bearer ${tokenB}`);
        expect(deleteResponse.status).toBe(404);
    });
});
