import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import {
    closeInfra,
    getApp,
    makeRandomEmail,
    obtainVerificationCode,
    prepareDatabase,
    resetAuthState,
} from './helpers.js';

const VALID_PASSWORD = 'secret123';

function sampleRounds(overrides: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
    return [
        { name: '北京·天安门', distanceKm: 2.5, score: 4800, imageId: 'img-1', xp: 0, difficulty: 3 },
        { name: '上海·外滩', distanceKm: 12, score: 3200, imageId: null, xp: 0, difficulty: 3 },
        { name: '广州·珠江', distanceKm: null, score: 0, imageId: null, xp: 0, difficulty: 2 },
        ...overrides,
    ];
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
        const rounds = sampleRounds();
        const response = await submitGame(token, {
            mode: 'challenge',
            totalScore: 8000,
            rounds,
        });
        expect(response.status).toBe(201);
        expect(response.body.game.id).toBeTruthy();
        expect(response.body.game.rounds).toHaveLength(3);
        expect(response.body.game.totalScore).toBe(8000);
    });

    it('未登录返回 401', async () => {
        const response = await request(getApp())
            .post('/api/games')
            .send({ mode: 'classic', totalScore: 100, rounds: sampleRounds().slice(0, 1) });
        expect(response.status).toBe(401);
    });

    it('总分与回合明细不一致返回 400', async () => {
        const token = await createGuestToken();
        const response = await submitGame(token, {
            mode: 'classic',
            totalScore: 9999,
            rounds: sampleRounds().slice(0, 1),
        });
        expect(response.status).toBe(400);
    });

    it('非法模式返回 400', async () => {
        const token = await createGuestToken();
        const response = await submitGame(token, {
            mode: 'unknown',
            totalScore: 100,
            rounds: sampleRounds().slice(0, 1),
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
        const response = await submitGame(token, {
            mode: 'region',
            totalScore: 100,
            rounds: sampleRounds().slice(0, 1),
        });
        expect(response.status).toBe(400);
    });

    it('非区域模式携带 region 返回 400', async () => {
        const token = await createGuestToken();
        const response = await submitGame(token, {
            mode: 'classic',
            region: 'asia',
            totalScore: 100,
            rounds: sampleRounds().slice(0, 1),
        });
        expect(response.status).toBe(400);
    });

    it('注册用户提交成绩成功', async () => {
        const session = await createUserSession();
        const response = await submitGame(session.accessToken, {
            mode: 'classic',
            totalScore: 4800,
            rounds: sampleRounds().slice(0, 1),
        });
        expect(response.status).toBe(201);
    });
});

describe('GET /api/games/recent 历史记录', () => {
    it('按时间倒序返回最近记录，并受 limit 约束', async () => {
        const token = await createGuestToken();
        await submitGame(token, { mode: 'classic', totalScore: 4800, rounds: sampleRounds().slice(0, 1) });
        await submitGame(token, { mode: 'challenge', totalScore: 8000, rounds: sampleRounds() });

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
        await submitGame(tokenA, { mode: 'classic', totalScore: 4800, rounds: sampleRounds().slice(0, 1) });

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
        await submitGame(token, { mode: 'classic', totalScore: 3000, rounds: sampleRounds().slice(0, 1) });
        await submitGame(token, { mode: 'classic', totalScore: 4800, rounds: sampleRounds().slice(0, 1) });

        const response = await request(getApp())
            .get('/api/games/best?mode=classic')
            .set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.best.totalScore).toBe(4800);
    });

    it('不同模式互不干扰', async () => {
        const token = await createGuestToken();
        await submitGame(token, { mode: 'classic', totalScore: 4800, rounds: sampleRounds().slice(0, 1) });
        await submitGame(token, { mode: 'china', totalScore: 25000, rounds: sampleRounds() });

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
        await submitGame(token, { mode: 'challenge', totalScore: 8000, rounds: sampleRounds() });

        const response = await request(getApp()).get('/api/games/summary').set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(200);
        expect(response.body.progress).toMatchObject({
            totalRounds: 3,
            totalScore: 8000,
            bestScore: 8000,
            correctGuesses: 2,
        });
    });

    it('注册用户 /me 返回进度', async () => {
        const session = await createUserSession();
        await submitGame(session.accessToken, {
            mode: 'classic',
            totalScore: 4800,
            rounds: sampleRounds().slice(0, 1),
        });

        const meResponse = await request(getApp())
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${session.accessToken}`);
        expect(meResponse.body.progress).toMatchObject({ totalRounds: 1, bestScore: 4800 });
    });
});

describe('DELETE /api/games/:id 删除记录', () => {
    it('删除自己的记录成功', async () => {
        const token = await createGuestToken();
        const submitResponse = await submitGame(token, {
            mode: 'classic',
            totalScore: 4800,
            rounds: sampleRounds().slice(0, 1),
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
        const submitResponse = await submitGame(tokenA, {
            mode: 'classic',
            totalScore: 4800,
            rounds: sampleRounds().slice(0, 1),
        });
        const gameId = submitResponse.body.game.id as number;

        const deleteResponse = await request(getApp())
            .delete(`/api/games/${gameId}`)
            .set('Authorization', `Bearer ${tokenB}`);
        expect(deleteResponse.status).toBe(404);
    });
});
