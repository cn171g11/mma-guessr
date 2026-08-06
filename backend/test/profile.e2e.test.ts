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
import { makeValidRound } from './scoreFixtures.js';
import type { GameMode } from '../src/games/types.js';

const VALID_PASSWORD = 'secret123';

function makeUniqueUsername(prefix: string): string {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}_${suffix}`;
}

async function createUserSession(): Promise<{ accessToken: string; username: string }> {
    const email = makeRandomEmail('profile');
    const code = await obtainVerificationCode(email);
    const response = await request(getApp())
        .post('/api/auth/register')
        .send({
            username: makeUniqueUsername('pf'),
            email,
            password: VALID_PASSWORD,
            code,
        });
    expect(response.status).toBe(201);
    return {
        accessToken: response.body.tokenPair.accessToken as string,
        username: response.body.user.username as string,
    };
}

function fetchProfile(token: string): request.Test {
    return request(getApp()).get('/api/profile').set('Authorization', `Bearer ${token}`);
}

function submitGame(token: string, mode: GameMode, totalScore: number): request.Test {
    return request(getApp())
        .post('/api/games')
        .set('Authorization', `Bearer ${token}`)
        .send({ mode, totalScore, rounds: [makeValidRound(mode, null, totalScore)] });
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

describe('GET /api/profile 用户资料与统计', () => {
    it('返回用户名与空统计', async () => {
        const session = await createUserSession();
        const response = await fetchProfile(session.accessToken);
        expect(response.status).toBe(200);
        expect(response.body.username).toBe(session.username);
        expect(response.body.role).toBe('user');
        expect(response.body.stats).toMatchObject({
            totalGames: 0,
            totalRounds: 0,
            totalScore: 0,
            bestScore: 0,
            correctGuesses: 0,
            accuracy: 0,
            bestMode: null,
            byMode: {},
        });
    });

    it('提交成绩后统计生效并分模式聚合', async () => {
        const session = await createUserSession();
        await submitGame(session.accessToken, 'classic', 4800);
        await submitGame(session.accessToken, 'china', 2500);

        const response = await fetchProfile(session.accessToken);
        expect(response.status).toBe(200);
        expect(response.body.stats).toMatchObject({
            totalGames: 2,
            totalRounds: 2,
            totalScore: 7300,
            bestScore: 4800,
            bestMode: 'classic',
            correctGuesses: 2,
            accuracy: 100,
        });
        expect(response.body.stats.byMode.classic).toMatchObject({ games: 1, bestScore: 4800 });
        expect(response.body.stats.byMode.china).toMatchObject({ games: 1, bestScore: 2500 });
    });

    it('游客资料返回游客昵称与统计', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const token = guestResponse.body.guestToken as string;
        await submitGame(token, 'classic', 4800);

        const response = await fetchProfile(token);
        expect(response.status).toBe(200);
        expect(response.body.role).toBe('guest');
        expect(response.body.username).toMatch(/^游客_/);
        expect(response.body.stats.totalGames).toBe(1);
    });

    it('未登录返回 401', async () => {
        const response = await request(getApp()).get('/api/profile');
        expect(response.status).toBe(401);
    });
});
