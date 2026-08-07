import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

import { redis } from '../src/db/redis.js';
import {
    closeInfra,
    getApp,
    makeRandomEmail,
    obtainVerificationCode,
    prepareDatabase,
    resetAuthState,
} from './helpers.js';

const VALID_PASSWORD = 'secret123';
const VERIFY_CODE_KEY_PREFIX = 'verify_code:';
const VERIFY_CODE_TTL_SECONDS = 600;

// 从 Set-Cookie 提取指定名称的 Cookie 值（刷新令牌只在 HttpOnly Cookie 中下发）
function cookieValueOf(res: request.Response, name: string): string | null {
    const header = res.headers['set-cookie'];
    if (header === undefined) {
        return null;
    }
    const cookieLines = Array.isArray(header) ? header : [header];
    for (const line of cookieLines) {
        const match = new RegExp(`(?:^|;)\\s*${name}=([^;]*)`).exec(line);
        if (match !== null) {
            return match[1] as string;
        }
    }
    return null;
}

async function primeVerificationCode(email: string): Promise<string> {
    const verificationCode = '123456';
    const codeHash = crypto.createHash('sha256').update(verificationCode).digest('hex');
    await redis.set(`${VERIFY_CODE_KEY_PREFIX}${email}`, codeHash, 'EX', VERIFY_CODE_TTL_SECONDS);
    return verificationCode;
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

describe('POST /api/auth/verification-code 邮箱验证码', () => {
    it('发送验证码成功，返回 200', async () => {
        const email = makeRandomEmail('code');
        const response = await request(getApp()).post('/api/auth/verification-code').send({ email });
        expect(response.status).toBe(200);
        expect(response.body.message).toBeTruthy();
    });

    it('60 秒内重复发送被拒绝（限频）', async () => {
        const email = makeRandomEmail('code');
        await request(getApp()).post('/api/auth/verification-code').send({ email });
        const secondSend = await request(getApp()).post('/api/auth/verification-code').send({ email });
        expect(secondSend.status).toBe(400);
    });

    it('邮箱格式非法返回 400', async () => {
        const response = await request(getApp()).post('/api/auth/verification-code').send({ email: 'not-an-email' });
        expect(response.status).toBe(400);
    });

    it('已注册邮箱与未注册邮箱返回一致（防账号枚举）', async () => {
        const email = makeRandomEmail('code');
        const code = await obtainVerificationCode(email);
        const registerResponse = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code });
        expect(registerResponse.status).toBe(201);

        const again = await request(getApp()).post('/api/auth/verification-code').send({ email });
        expect(again.status).toBe(200);
        expect(again.body.message).toBeTruthy();
    });
});

describe('POST /api/auth/register 注册', () => {
    it('携带正确验证码注册成功，返回令牌对与用户信息', async () => {
        const email = makeRandomEmail('reg');
        const code = await obtainVerificationCode(email);
        const response = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code });
        expect(response.status).toBe(201);
        expect(response.body.user).toMatchObject({ username: 'tester01', email });
        expect(response.body.tokenPair.accessToken).toBeTruthy();
        // H1/M2 回归断言：刷新令牌只经 HttpOnly Cookie 下发，绝不进入响应体
        expect(response.body.tokenPair.refreshToken).toBeUndefined();
        expect(cookieValueOf(response, 'mma_refresh')).toBeTruthy();

        const meResponse = await request(getApp())
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${response.body.tokenPair.accessToken}`);
        expect(meResponse.status).toBe(200);
        expect(meResponse.body.role).toBe('user');
        expect(meResponse.body.user.id).toBe(response.body.user.id);
    });

    it('邮箱重复注册返回 409', async () => {
        const email = makeRandomEmail('reg');
        const firstCode = await obtainVerificationCode(email);
        await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code: firstCode });

        const secondCode = await primeVerificationCode(email);
        const duplicate = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester02', email, password: VALID_PASSWORD, code: secondCode });
        expect(duplicate.status).toBe(409);
    });

    it('验证码错误返回 400', async () => {
        const email = makeRandomEmail('reg');
        await obtainVerificationCode(email);
        const response = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code: '000000' });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('验证码');
    });

    it('非法用户名返回 400', async () => {
        const email = makeRandomEmail('reg');
        const code = await obtainVerificationCode(email);
        const response = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'x', email, password: VALID_PASSWORD, code });
        expect(response.status).toBe(400);
    });

    it('密码过短返回 400', async () => {
        const email = makeRandomEmail('reg');
        const code = await obtainVerificationCode(email);
        const response = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: '123', code });
        expect(response.status).toBe(400);
    });
});

describe('POST /api/auth/login 登录', () => {
    async function createAccount(): Promise<string> {
        const email = makeRandomEmail('login');
        const code = await obtainVerificationCode(email);
        const registerResponse = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code });
        expect(registerResponse.status).toBe(201);
        return email;
    }

    it('邮箱 + 密码登录成功', async () => {
        const email = await createAccount();
        const response = await request(getApp())
            .post('/api/auth/login')
            .send({ identifier: email, password: VALID_PASSWORD });
        expect(response.status).toBe(200);
        expect(response.body.tokenPair.accessToken).toBeTruthy();
    });

    it('用户名 + 密码登录成功', async () => {
        await createAccount();
        const response = await request(getApp())
            .post('/api/auth/login')
            .send({ identifier: 'tester01', password: VALID_PASSWORD });
        expect(response.status).toBe(200);
    });

    it('密码错误返回 401', async () => {
        const email = await createAccount();
        const response = await request(getApp())
            .post('/api/auth/login')
            .send({ identifier: email, password: 'wrong-password' });
        expect(response.status).toBe(401);
    });

    it('连续失败 5 次后账号被临时锁定', async () => {
        const email = await createAccount();
        for (let attemptIndex = 0; attemptIndex < 5; attemptIndex += 1) {
            const failedResponse = await request(getApp())
                .post('/api/auth/login')
                .send({ identifier: email, password: 'wrong-password' });
            expect(failedResponse.status).toBe(401);
        }
        const lockedResponse = await request(getApp())
            .post('/api/auth/login')
            .send({ identifier: email, password: VALID_PASSWORD });
        expect(lockedResponse.status).toBe(401);
        expect(lockedResponse.body.error).toContain('锁定');
    });
});

describe('令牌生命周期（refresh / logout）', () => {
    async function createSession(): Promise<{ email: string; accessToken: string; refreshToken: string }> {
        const email = makeRandomEmail('token');
        const code = await obtainVerificationCode(email);
        const registerResponse = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code });
        const refreshToken = cookieValueOf(registerResponse, 'mma_refresh');
        if (refreshToken === null) {
            throw new Error('注册响应未下发刷新令牌 Cookie');
        }
        return {
            email,
            accessToken: registerResponse.body.tokenPair.accessToken,
            refreshToken,
        };
    }

    it('refresh 返回新访问令牌并轮换 Cookie，旧 refresh 立即作废', async () => {
        const session = await createSession();
        const refreshResponse = await request(getApp())
            .post('/api/auth/refresh')
            .send({ refreshToken: session.refreshToken });
        expect(refreshResponse.status).toBe(200);
        expect(refreshResponse.body.tokenPair.accessToken).not.toBe(session.accessToken);
        expect(refreshResponse.body.tokenPair.refreshToken).toBeUndefined();
        expect(cookieValueOf(refreshResponse, 'mma_refresh')).toBeTruthy();

        const reusedResponse = await request(getApp())
            .post('/api/auth/refresh')
            .send({ refreshToken: session.refreshToken });
        expect(reusedResponse.status).toBe(401);
    });

    it('logout 后 refresh 返回 401', async () => {
        const session = await createSession();
        const logoutResponse = await request(getApp())
            .post('/api/auth/logout')
            .set('Authorization', `Bearer ${session.accessToken}`)
            .send({ refreshToken: session.refreshToken });
        expect(logoutResponse.status).toBe(200);

        const refreshResponse = await request(getApp())
            .post('/api/auth/refresh')
            .send({ refreshToken: session.refreshToken });
        expect(refreshResponse.status).toBe(401);
    });

    it('无令牌访问 /me 返回 401', async () => {
        const response = await request(getApp()).get('/api/auth/me');
        expect(response.status).toBe(401);
    });

    it('伪造 access token 访问 /me 返回 401', async () => {
        const response = await request(getApp()).get('/api/auth/me').set('Authorization', 'Bearer forged-token');
        expect(response.status).toBe(401);
    });
});

describe('游客模式与绑定注册', () => {
    it('创建游客会话并可通过 /me 获取游客身份', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        expect(guestResponse.status).toBe(201);
        expect(guestResponse.body.guestId).toBeTruthy();
        expect(guestResponse.body.guestToken).toBeTruthy();

        const meResponse = await request(getApp())
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${guestResponse.body.guestToken}`);
        expect(meResponse.status).toBe(200);
        expect(meResponse.body.role).toBe('guest');
        expect(meResponse.body.profile.guestId).toBe(guestResponse.body.guestId);
    });

    it('游客绑定注册：游戏进度迁移到正式账号并清理游客数据', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const guestId = guestResponse.body.guestId as string;
        const guestToken = guestResponse.body.guestToken as string;

        await redis.hset(`guest_progress:${guestId}`, {
            totalRounds: '12',
            totalScore: '3450',
            bestScore: '8900',
            correctGuesses: '9',
        });

        const email = makeRandomEmail('bind');
        const code = await obtainVerificationCode(email);
        const bindResponse = await request(getApp())
            .post('/api/auth/guest/bind')
            .send({ username: 'guestuser', email, password: VALID_PASSWORD, code, guestToken });
        expect(bindResponse.status).toBe(201);

        const userId = bindResponse.body.user.id as string;
        const migratedProgress = await redis.hgetall(`user_progress:${userId}`);
        expect(migratedProgress).toMatchObject({
            totalRounds: '12',
            totalScore: '3450',
            bestScore: '8900',
            correctGuesses: '9',
        });

        expect(await redis.exists(`guest:${guestId}`)).toBe(0);
        expect(await redis.exists(`guest_progress:${guestId}`)).toBe(0);
    });

    it('注册接口携带 guestToken 同样完成游客进度迁移', async () => {
        const guestResponse = await request(getApp()).post('/api/auth/guest');
        const guestId = guestResponse.body.guestId as string;

        await redis.hset(`guest_progress:${guestId}`, {
            totalRounds: '5',
            totalScore: '1200',
            bestScore: '2200',
            correctGuesses: '3',
        });

        const email = makeRandomEmail('bind');
        const code = await obtainVerificationCode(email);
        const registerResponse = await request(getApp()).post('/api/auth/register').send({
            username: 'binduser',
            email,
            password: VALID_PASSWORD,
            code,
            guestToken: guestResponse.body.guestToken,
        });
        expect(registerResponse.status).toBe(201);

        const userId = registerResponse.body.user.id as string;
        const migratedProgress = await redis.hgetall(`user_progress:${userId}`);
        expect(migratedProgress.totalRounds).toBe('5');
        expect(migratedProgress.totalScore).toBe('1200');
    });

    it('绑定接口拒绝普通用户令牌', async () => {
        const email = makeRandomEmail('bind');
        const code = await obtainVerificationCode(email);
        const registerResponse = await request(getApp())
            .post('/api/auth/register')
            .send({ username: 'tester01', email, password: VALID_PASSWORD, code });
        const userAccessToken = registerResponse.body.tokenPair.accessToken as string;

        const bindEmail = makeRandomEmail('bind');
        const bindCode = await obtainVerificationCode(bindEmail);
        const bindResponse = await request(getApp()).post('/api/auth/guest/bind').send({
            username: 'binduser',
            email: bindEmail,
            password: VALID_PASSWORD,
            code: bindCode,
            guestToken: userAccessToken,
        });
        expect(bindResponse.status).toBe(400);
    });
});
