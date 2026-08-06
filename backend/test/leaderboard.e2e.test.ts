import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import {
    closeInfra,
    getApp,
    makeRandomEmail,
    obtainVerificationCode,
    prepareDatabase,
    resetAppRedis,
    resetAuthState,
} from './helpers.js';

const VALID_PASSWORD = 'secret123';

function makeUniqueUsername(prefix: string): string {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}_${suffix}`;
}

async function createUserSession(): Promise<{ accessToken: string; userId: string }> {
    const email = makeRandomEmail('lb');
    const code = await obtainVerificationCode(email);
    const response = await request(getApp())
        .post('/api/auth/register')
        .send({
            username: makeUniqueUsername('lb'),
            email,
            password: VALID_PASSWORD,
            code,
        });
    expect(response.status).toBe(201);
    return {
        accessToken: response.body.tokenPair.accessToken as string,
        userId: response.body.user.id as string,
    };
}

function submitGame(token: string, score: number) {
    return request(getApp())
        .post('/api/games')
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'classic', totalScore: score, rounds: [{ name: '北京·天安门', distanceKm: 1, score }] });
}

function fetchLeaderboard(query = ''): request.Test {
    return request(getApp()).get(`/api/leaderboard${query}`);
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

describe('GET /api/leaderboard 排行榜', () => {
    it('注册用户提交后出现在总榜', async () => {
        const session = await createUserSession();
        await submitGame(session.accessToken, 4800);

        const response = await fetchLeaderboard('?mode=classic');
        expect(response.status).toBe(200);
        expect(response.body.entries).toHaveLength(1);
        expect(response.body.entries[0]).toMatchObject({ id: session.userId, score: 4800 });
        expect(response.body.entries[0].username).toBeTruthy();
    });

    it('同用户多次提交保留最高分', async () => {
        const session = await createUserSession();
        await submitGame(session.accessToken, 4800);
        await submitGame(session.accessToken, 3000);

        const response = await fetchLeaderboard('?mode=classic');
        expect(response.body.entries).toHaveLength(1);
        expect(response.body.entries[0].score).toBe(4800);
    });

    it('按分数降序返回，日榜参数生效', async () => {
        const userA = await createUserSession();
        const userB = await createUserSession();
        await submitGame(userA.accessToken, 5000);
        await submitGame(userB.accessToken, 2500);

        const overall = await fetchLeaderboard('?mode=classic&period=overall');
        expect(overall.body.entries.map((entry: { id: string }) => entry.id)).toEqual([userA.userId, userB.userId]);

        const daily = await fetchLeaderboard('?mode=classic&period=daily');
        expect(daily.body.entries).toHaveLength(2);
        expect(daily.body.entries[0].score).toBe(5000);
    });

    it('游客成绩不上榜', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        await submitGame(guestResponse.body.guestToken as string, 4800);

        const response = await fetchLeaderboard('?mode=classic');
        expect(response.body.entries).toEqual([]);
    });

    it('无成绩时返回空榜', async () => {
        const response = await fetchLeaderboard('?mode=classic');
        expect(response.body.entries).toEqual([]);
    });

    it('limit 生效', async () => {
        const userA = await createUserSession();
        const userB = await createUserSession();
        await submitGame(userA.accessToken, 5000);
        await submitGame(userB.accessToken, 2500);

        const response = await fetchLeaderboard('?mode=classic&limit=1');
        expect(response.body.entries).toHaveLength(1);
        expect(response.body.entries[0].score).toBe(5000);
    });

    it('ZSET 缓存丢失后从 DB 自动重建（校准）', async () => {
        const session = await createUserSession();
        await submitGame(session.accessToken, 4800);
        await resetAppRedis();

        const response = await fetchLeaderboard('?mode=classic');
        expect(response.status).toBe(200);
        expect(response.body.entries).toHaveLength(1);
        expect(response.body.entries[0].score).toBe(4800);
        expect(response.body.entries[0].id).toBe(session.userId);
    });

    it('非法 date 返回 400', async () => {
        const response = await fetchLeaderboard('?mode=classic&period=daily&date=2026-13-99');
        expect(response.status).toBe(400);
    });
});
