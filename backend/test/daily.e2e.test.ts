import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { computeRoundScore, haversineKm } from '../src/games/scoring.js';
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

// 用今日题单的真实题目构造提交：坐标偏移 + 服务端同款计分，保证通过服务端校验
function dailySubmitBody(challenge: { locations: Array<{ id: number; name: string; lat: number; lng: number; difficulty: number }> }): {
    totalScore: number;
    rounds: Array<Record<string, unknown>>;
} {
    const rounds = challenge.locations.slice(0, 3).map((location, index) => {
        const offset = index === 2 ? { lat: 0, lng: 0 } : { lat: 0.004, lng: 0.004 };
        const guess = { lat: location.lat + offset.lat, lng: location.lng + offset.lng };
        const distanceKm = haversineKm(location.lat, location.lng, guess.lat, guess.lng);
        return {
            name: location.name,
            locationId: location.id,
            distanceKm,
            score: computeRoundScore('daily', null, distanceKm),
            imageId: null,
            xp: 0,
            difficulty: location.difficulty,
            guessLat: guess.lat,
            guessLng: guess.lng,
            answerLat: location.lat,
            answerLng: location.lng,
        };
    });
    const totalScore = rounds.reduce((sum, round) => sum + (round.score as number), 0);
    return { totalScore, rounds };
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
        const challenge = await fetchToday(token);

        const body = dailySubmitBody(challenge.body);
        const first = await submitGame(token, { mode: 'daily', totalScore: body.totalScore, rounds: body.rounds });
        expect(first.status).toBe(201);

        const second = await submitGame(token, { mode: 'daily', totalScore: body.totalScore, rounds: body.rounds });
        expect(second.status).toBe(409);

        const after = await fetchToday(token);
        expect(after.body.played).toBe(true);
    });

    it('提交不属于今日题单的题目返回 400 且不消耗当日机会', async () => {
        const token = await createUserSession();
        const challenge = await fetchToday(token);
        const body = dailySubmitBody(challenge.body);

        // 仅伪造题目 ID（几何与得分保持一致，确保校验命中"不在今日题单"分支）
        const firstRound = body.rounds[0] ?? {};
        const forged = { ...firstRound, locationId: 999999999 };
        const response = await submitGame(token, {
            mode: 'daily',
            totalScore: (firstRound.score as number) ?? 0,
            rounds: [forged],
        });
        expect(response.status).toBe(400);

        const after = await fetchToday(token);
        expect(after.body.played).toBe(false);
    });

    it('游客提交每日挑战返回 400', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const guestToken = guestResponse.body.guestToken as string;
        const challenge = await fetchToday(guestToken);
        const body = dailySubmitBody(challenge.body);

        const response = await submitGame(guestToken, { mode: 'daily', totalScore: body.totalScore, rounds: body.rounds });
        expect(response.status).toBe(400);
    });
});
