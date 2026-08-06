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

function makeUniqueUsername(prefix: string): string {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}_${suffix}`;
}

async function createUserSession(): Promise<string> {
    const email = makeRandomEmail('daily');
    const code = await obtainVerificationCode(email);
    const response = await request(getApp())
        .post('/api/auth/register')
        .send({
            username: makeUniqueUsername('dl'),
            email,
            password: VALID_PASSWORD,
            code,
        });
    expect(response.status).toBe(201);
    return response.body.tokenPair.accessToken as string;
}

function fetchToday(token: string): request.Test {
    return request(getApp()).get('/api/daily/today').set('Authorization', `Bearer ${token}`);
}

function submitGame(token: string, body: Record<string, unknown>): request.Test {
    return request(getApp()).post('/api/games').set('Authorization', `Bearer ${token}`).send(body);
}

function dailySubmitBody(): Record<string, unknown> {
    return {
        mode: 'daily',
        totalScore: 4800,
        rounds: [{ name: '北京·天安门', distanceKm: 1, score: 4800, imageId: null, xp: 0, difficulty: 3 }],
    };
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

describe('GET /api/daily/today 每日挑战', () => {
    it('返回当天 10 道题目与未参与状态', async () => {
        const token = await createUserSession();
        const response = await fetchToday(token);
        expect(response.status).toBe(200);
        expect(response.body.date).toBeTruthy();
        expect(response.body.locations).toHaveLength(10);
        expect(response.body.played).toBe(false);
    });

    it('同一天多次获取返回相同题单', async () => {
        const token = await createUserSession();
        const first = await fetchToday(token);
        const second = await fetchToday(token);
        expect(second.body.locations.map((location: { id: number }) => location.id)).toEqual(
            first.body.locations.map((location: { id: number }) => location.id)
        );
    });

    it('游客可查看今日题单', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const response = await fetchToday(guestResponse.body.guestToken as string);
        expect(response.status).toBe(200);
        expect(response.body.locations).toHaveLength(10);
    });

    it('未登录返回 401', async () => {
        const response = await request(getApp()).get('/api/daily/today');
        expect(response.status).toBe(401);
    });
});

describe('每日挑战提交', () => {
    it('注册用户提交成功，且当天不能重复提交', async () => {
        const token = await createUserSession();
        await fetchToday(token);

        const first = await submitGame(token, dailySubmitBody());
        expect(first.status).toBe(201);

        const second = await submitGame(token, dailySubmitBody());
        expect(second.status).toBe(409);

        const after = await fetchToday(token);
        expect(after.body.played).toBe(true);
    });

    it('游客提交每日挑战返回 400', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const response = await submitGame(guestResponse.body.guestToken as string, dailySubmitBody());
        expect(response.status).toBe(400);
    });
});
