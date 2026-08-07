import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { pool } from '../src/db/pool.js';
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

interface PublicChallengeLocation {
    id: number;
    name: string;
    difficulty: number;
}

interface LocationWithCoords {
    id: number;
    name: string;
    lat: number;
    lng: number;
    difficulty: number;
}

async function fetchTodayLocationsWithCoords(token: string): Promise<LocationWithCoords[]> {
    const response = await fetchToday(token);
    expect(response.status).toBe(200);
    const ids = (response.body.locations as PublicChallengeLocation[]).map((location) => location.id);
    const { rows } = await pool.query<LocationWithCoords>(
        'SELECT id, name, lat, lng, difficulty FROM locations WHERE id = ANY($1::int[])',
        [ids]
    );
    return rows;
}

// 每日挑战客户端提交：只上报猜测点与题目 ID，距离/得分/答案坐标一律不带（服务端权威结算）
function dailySubmitBody(records: LocationWithCoords[]): {
    totalScore: number;
    guesses: Array<{ lat: number; lng: number }>;
    rounds: Array<Record<string, unknown>>;
} {
    const guesses: Array<{ lat: number; lng: number }> = [];
    const rounds = records.slice(0, 3).map((record, index) => {
        const offset = index === 2 ? { lat: 0, lng: 0 } : { lat: 0.004, lng: 0.004 };
        const guess = { lat: record.lat + offset.lat, lng: record.lng + offset.lng };
        guesses.push(guess);
        return {
            name: record.name,
            locationId: record.id,
            distanceKm: null,
            score: 0,
            imageId: null,
            xp: 0,
            difficulty: record.difficulty,
            guessLat: guess.lat,
            guessLng: guess.lng,
            answerLat: null,
            answerLng: null,
        };
    });
    return { total: 0, guesses, rounds };
}

// 服务端应返回与今日题单一致的权威结算：距离=谜底与猜测的大圆距离，得分=同款公式
function expectedAuthoritative(records: LocationWithCoords[], guesses: Array<{ lat: number; lng: number }>): number {
    return guesses.reduce((sum, guess, index) => {
        const record = records[index];
        if (record === undefined) {
            return sum;
        }
        const distanceKm = haversineKm(record.lat, record.lng, guess.lat, guess.lng);
        return sum + computeRoundScore('daily', null, distanceKm);
    }, 0);
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
    it('返回当天 10 道题目与未参与状态，且不下发答案坐标', async () => {
        const token = await createUserSession();
        const response = await fetchToday(token);
        expect(response.status).toBe(200);
        expect(response.body.date).toBeTruthy();
        expect(response.body.locations).toHaveLength(10);
        expect(response.body.played).toBe(false);
        // H1 回归断言：题目只包含展示所需字段，绝不携带 lat/lng
        for (const location of response.body.locations) {
            expect(location).not.toHaveProperty('lat');
            expect(location).not.toHaveProperty('lng');
        }
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
    it('注册用户提交成功，服务端权威结算并回传答案坐标，且当天不能重复提交', async () => {
        const token = await createUserSession();
        const records = await fetchTodayLocationsWithCoords(token);

        const { guesses, rounds } = dailySubmitBody(records);
        const first = await submitGame(token, { mode: 'daily', totalScore: 0, rounds });
        expect(first.status).toBe(201);

        // 服务端返回权威结算：距离/得分按公式重算，答案坐标在整局提交后回传（此前不泄露）
        const serverGame = first.body.game;
        expect(serverGame.totalScore).toBe(expectedAuthoritative(records, guesses));
        records.slice(0, 3).forEach((record, index) => {
            const verified = serverGame.rounds[index];
            const guess = guesses[index];
            const expectedDistance = haversineKm(record.lat, record.lng, guess.lat, guess.lng);
            expect(verified.distanceKm).toBeCloseTo(expectedDistance, 6);
            expect(verified.answerLat).toBe(record.lat);
            expect(verified.answerLng).toBe(record.lng);
        });

        const second = await submitGame(token, { mode: 'daily', totalScore: 0, rounds });
        expect(second.status).toBe(409);

        const after = await fetchToday(token);
        expect(after.body.played).toBe(true);
    });

    it('提交客户端伪造的距离/答案坐标拒绝（必须由服务端权威结算）', async () => {
        const token = await createUserSession();
        const records = await fetchTodayLocationsWithCoords(token);
        const { rounds } = dailySubmitBody(records);
        const forged = {
            ...rounds[0],
            distanceKm: 0.5,
            answerLat: records[0]?.lat,
            answerLng: records[0]?.lng,
        };
        const response = await submitGame(token, { mode: 'daily', totalScore: 0, rounds: [forged] });
        expect(response.status).toBe(400);
    });

    it('提交不属于今日题单的题目返回 400 且不消耗当日机会', async () => {
        const token = await createUserSession();
        const records = await fetchTodayLocationsWithCoords(token);
        const { rounds } = dailySubmitBody(records);

        // 仅伪造题目 ID，确保命中"不在今日题单"分支
        const firstRound = rounds[0] ?? {};
        const forged = { ...firstRound, locationId: 999999999 };
        const response = await submitGame(token, { mode: 'daily', totalScore: 0, rounds: [forged] });
        expect(response.status).toBe(400);

        const after = await fetchToday(token);
        expect(after.body.played).toBe(false);
    });

    it('游客提交每日挑战返回 400', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const guestToken = guestResponse.body.guestToken as string;
        const records = await fetchTodayLocationsWithCoords(guestToken);
        const { rounds } = dailySubmitBody(records);

        const response = await submitGame(guestToken, { mode: 'daily', totalScore: 0, rounds });
        expect(response.status).toBe(400);
    });
});
