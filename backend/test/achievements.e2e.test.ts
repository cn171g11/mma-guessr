import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import type { GameMode } from '../src/games/types.js';
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

// 得分公式与服务端一致，保证提交通过权威校验
const ANSWER = { lat: 39.9055, lng: 116.3976 };

function makeRound(mode: GameMode, region: string | null, offsetLat = 0.01, offsetLng = 0.01): Record<string, unknown> {
    const guess = { lat: ANSWER.lat + offsetLat, lng: ANSWER.lng + offsetLng };
    const distanceKm = haversineKm(ANSWER.lat, ANSWER.lng, guess.lat, guess.lng);
    return {
        name: '成就测试点位',
        distanceKm,
        score: computeRoundScore(mode, region, distanceKm),
        imageId: `ach-img-${mode}`,
        xp: 0,
        difficulty: 2,
        guessLat: guess.lat,
        guessLng: guess.lng,
        answerLat: ANSWER.lat,
        answerLng: ANSWER.lng,
    };
}

function makePerfectRound(): Record<string, unknown> {
    const round = makeRound('classic', null, 0, 0);
    return { ...round, name: '满分点位' };
}

// 单人模式集：覆盖 7 种模式后 mode_master 应解锁（landmark 计入其中）
const MODE_COVERAGE: Array<{ mode: GameMode; region: string | null }> = [
    { mode: 'classic', region: null },
    { mode: 'challenge', region: null },
    { mode: 'region', region: 'asia' },
    { mode: 'china', region: null },
    { mode: 'endless', region: null },
    { mode: 'landmark', region: null },
    { mode: 'duel', region: null },
];

async function registerUser(): Promise<{ email: string; accessToken: string }> {
    const email = makeRandomEmail('achievements');
    const code = await obtainVerificationCode(email);
    const response = await request(getApp())
        .post('/api/auth/register')
        .send({ username: 'achhunter', email, password: VALID_PASSWORD, code });
    expect(response.status).toBe(201);
    return { email, accessToken: response.body.tokenPair.accessToken as string };
}

function submitGame(token: string, body: Record<string, unknown>) {
    return request(getApp()).post('/api/games').set('Authorization', `Bearer ${token}`).send(body);
}

function getAchievements(token: string) {
    return request(getApp()).get('/api/achievements').set('Authorization', `Bearer ${token}`);
}

function equipTitle(token: string, title: string | null) {
    return request(getApp()).put('/api/achievements/title').set('Authorization', `Bearer ${token}`).send({ title });
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

describe('GET /api/achievements 成就列表', () => {
    it('未登录返回 401', async () => {
        const response = await request(getApp()).get('/api/achievements');
        expect(response.status).toBe(401);
    });

    it('游客返回 400（成就仅对注册用户开放）', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const guestToken = guestResponse.body.guestToken as string;
        const response = await getAchievements(guestToken);
        expect(response.status).toBe(400);
    });

    it('注册用户返回成就定义与解锁状态', async () => {
        const { accessToken } = await registerUser();
        const response = await getAchievements(accessToken);
        expect(response.status).toBe(200);
        expect(response.body.equippedTitle).toBeNull();
        const codes = response.body.achievements.map((entry) => entry.code);
        expect(codes).toContain('first_game');
        expect(codes).toContain('landmark_10');
        const firstGame = response.body.achievements.find((entry) => entry.code === 'first_game');
        expect(firstGame.unlockedAt).toBeNull();
    });
});

describe('POST /api/games 触发成就解锁', () => {
    it('完成各模式与满分局后解锁对应成就并可装备称号', async () => {
        const { accessToken } = await registerUser();

        // 7 种单人模式各一局（含 landmark 与 duel）
        for (const { mode, region } of MODE_COVERAGE) {
            const round = makeRound(mode, region);
            // 区域模式的提交必须携带 region,其余模式一律不得携带
            const game = {
                mode,
                ...(region !== null ? { region } : {}),
                totalScore: round.score as number,
                rounds: [round],
            };
            const response = await submitGame(accessToken, game);
            expect(response.status).toBe(201);
        }
        // 满分局：单轮 5000 → perfect_round / perfect_game
        const perfectGame = {
            mode: 'classic',
            totalScore: 5000,
            rounds: [makePerfectRound()],
        };
        const perfectResponse = await submitGame(accessToken, perfectGame);
        expect(perfectResponse.status).toBe(201);

        const unlockedResponse = await getAchievements(accessToken);
        expect(unlockedResponse.status).toBe(200);
        const unlocked = new Map(unlockedResponse.body.achievements.map((entry) => [entry.code, entry.unlockedAt]));
        expect(unlocked.get('first_game')).toBeTruthy();
        expect(unlocked.get('perfect_round')).toBeTruthy();
        expect(unlocked.get('perfect_game')).toBeTruthy();
        expect(unlocked.get('mode_master')).toBeTruthy();
        expect(unlocked.get('accuracy_90')).toBeTruthy();
        expect(unlocked.get('games_10')).toBeNull();

        // 装备已解锁称号
        const equipResponse = await equipTitle(accessToken, '全能选手');
        expect(equipResponse.status).toBe(200);
        expect(equipResponse.body.equippedTitle).toBe('全能选手');

        // 装备未解锁称号 / 不存在称号 → 400
        const lockedResponse = await equipTitle(accessToken, '百局老兵');
        expect(lockedResponse.status).toBe(400);
        const unknownResponse = await equipTitle(accessToken, '不存在');
        expect(unknownResponse.status).toBe(400);

        // GET 反映装备状态
        const afterEquip = await getAchievements(accessToken);
        expect(afterEquip.body.equippedTitle).toBe('全能选手');

        // 卸下称号
        const clearResponse = await equipTitle(accessToken, null);
        expect(clearResponse.status).toBe(200);
        expect(clearResponse.body.equippedTitle).toBeNull();
    });
});

describe('地标模式（landmark）', () => {
    it('landmark 模式成绩可正常提交并计入排行榜', async () => {
        const { accessToken } = await registerUser();
        const round = makeRound('landmark', null);
        const game = { mode: 'landmark', totalScore: round.score as number, rounds: [round] };
        const response = await submitGame(accessToken, game);
        expect(response.status).toBe(201);
        expect(response.body.game.mode).toBe('landmark');

        const leaderboardResponse = await request(getApp())
            .get('/api/leaderboard')
            .query({ mode: 'landmark', period: 'overall' });
        expect(leaderboardResponse.status).toBe(200);
        expect(leaderboardResponse.body.entries.length).toBeGreaterThanOrEqual(1);
        expect(leaderboardResponse.body.entries[0].username).toBe('achhunter');
    });
});
