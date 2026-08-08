import { Router, type Response } from 'express';
import { z } from 'zod';

import { getGuestProfile, getGuestProgress, getUserProgress } from '../auth/guest.js';
import { createGuestSession } from '../auth/guest.js';
import { loginAccount, registerAccount, getUserProfile } from '../auth/accounts.js';
import { findUserByEmail } from '../auth/users.js';
import { exchangeRefreshToken, revokeTokens, verifyAccessToken, type TokenPair } from '../auth/tokens.js';
import { sendVerificationCode } from '../auth/verificationCode.js';
import { requireAuth } from '../middleware/authenticate.js';
import { slidingWindowRateLimit } from '../utils/slidingWindowRateLimit.js';
import { clearRefreshCookie, refreshTokenFromCookie, setRefreshCookie } from '../utils/cookies.js';
import { parseBody } from '../utils/validate.js';
import { badRequest, conflict } from '../utils/httpError.js';

export const authRouter = Router();

// 按 IP 限频：防邮箱轰炸、批量游客会话与分布式密码爆破（清水账号级锁定在 accounts.ts）
const CODE_RATE_WINDOW_MS = 10 * 60 * 1000;
const CODE_RATE_MAX = 60;
const GUEST_RATE_WINDOW_MS = 5 * 60 * 1000;
const GUEST_RATE_MAX = 60;
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_MAX = 30;
const REGISTER_RATE_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_RATE_MAX = 30;
const REFRESH_RATE_WINDOW_MS = 10 * 60 * 1000;
const REFRESH_RATE_MAX = 120;

const emailSchema = z.object({
    email: z.string().email('邮箱格式不正确'),
});

const registerSchema = z.object({
    username: z.string().min(3, '用户名至少 3 位').max(20, '用户名最多 20 位'),
    email: z.string().email('邮箱格式不正确'),
    password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
    code: z.string().regex(/^\d{6}$/, '验证码格式不正确'),
    guestToken: z.string().min(1, '游客令牌不能为空').optional(),
});

const bindSchema = registerSchema.extend({
    guestToken: z.string().min(1, '游客令牌不能为空'),
});

const loginSchema = z.object({
    identifier: z.string().min(1, '请输入账号'),
    password: z.string().min(1, '请输入密码'),
});

const refreshSchema = z.object({
    refreshToken: z.string().min(1, '缺少刷新令牌').optional(),
});

const logoutSchema = z.object({
    refreshToken: z.string().min(1, '缺少刷新令牌').optional(),
});

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

async function assertEmailNotRegistered(email: string): Promise<void> {
    const existingUser = await findUserByEmail(email);
    if (existingUser !== null) {
        throw conflict('该邮箱已被注册');
    }
}

function resolveGuestKey(guestToken: string): string {
    const subject = verifyAccessToken(guestToken);
    if (subject.role !== 'guest') {
        throw badRequest('提供的不是游客令牌');
    }
    return subject.subject;
}

const clientIp = (req: { ip?: string }): string => req.ip ?? 'unknown';

// 登录/刷新后经由 HttpOnly Cookie 下发刷新令牌，响应体仅含短期访问令牌
function attachSession(res: Response, session: TokenPair): { accessToken: string } {
    setRefreshCookie(res, session.refreshToken);
    return { accessToken: session.accessToken };
}

authRouter.post(
    '/verification-code',
    slidingWindowRateLimit({ keyPrefix: 'rl:auth-code:', windowMs: CODE_RATE_WINDOW_MS, maxRequests: CODE_RATE_MAX }),
    async (req, res) => {
        const { email } = parseBody(emailSchema, req.body);
        const normalized = normalizeEmail(email);
        // 已注册邮箱与未注册邮箱返回一致的 200，避免被用于枚举存量账号；
        // 注册阶段仍会对已占用邮箱返回冲突
        await sendVerificationCode(normalized);
        res.json({ message: '验证码已发送' });
    }
);

authRouter.post(
    '/register',
    slidingWindowRateLimit({
        keyPrefix: 'rl:auth-register:',
        windowMs: REGISTER_RATE_WINDOW_MS,
        maxRequests: REGISTER_RATE_MAX,
    }),
    async (req, res) => {
        const { username, email, password, code, guestToken } = parseBody(registerSchema, req.body);
        const normalizedEmail = normalizeEmail(email);
        // 注册本身仍要拒绝已占用邮箱；未注册邮箱的枚举风险已在 verification-code 接口消除
        await assertEmailNotRegistered(normalizedEmail);
        const session = await registerAccount({
            username,
            email: normalizedEmail,
            password,
            verificationCode: code,
            guestId: guestToken === undefined ? undefined : resolveGuestKey(guestToken),
            ipAddress: clientIp(req),
        });
        res.status(201).json({ ...session, tokenPair: attachSession(res, session.tokenPair) });
    }
);

authRouter.post('/guest/bind', async (req, res) => {
    const { username, email, password, code, guestToken } = parseBody(bindSchema, req.body);
    const normalizedEmail = normalizeEmail(email);
    await assertEmailNotRegistered(normalizedEmail);
    const session = await registerAccount({
        username,
        email: normalizedEmail,
        password,
        verificationCode: code,
        guestId: resolveGuestKey(guestToken),
        ipAddress: clientIp(req),
    });
    res.status(201).json({ ...session, tokenPair: attachSession(res, session.tokenPair) });
});

authRouter.post(
    '/login',
    slidingWindowRateLimit({
        keyPrefix: 'rl:auth-login:',
        windowMs: LOGIN_RATE_WINDOW_MS,
        maxRequests: LOGIN_RATE_MAX,
    }),
    async (req, res) => {
        const { identifier, password } = parseBody(loginSchema, req.body);
        const session = await loginAccount(identifier, password, clientIp(req));
        res.json({ ...session, tokenPair: attachSession(res, session.tokenPair) });
    }
);

authRouter.post(
    '/refresh',
    slidingWindowRateLimit({
        keyPrefix: 'rl:auth-refresh:',
        windowMs: REFRESH_RATE_WINDOW_MS,
        maxRequests: REFRESH_RATE_MAX,
    }),
    async (req, res) => {
        const { refreshToken } = parseBody(refreshSchema, req.body);
        const submitted = refreshTokenFromCookie(req) ?? refreshToken;
        if (submitted === undefined) {
            throw badRequest('缺少刷新令牌');
        }
        const tokenPair = await exchangeRefreshToken(submitted, clientIp(req));
        res.json({ tokenPair: attachSession(res, tokenPair) });
    }
);

authRouter.post('/logout', requireAuth, async (req, res) => {
    const { refreshToken } = parseBody(logoutSchema, req.body);
    if (req.auth === undefined) {
        throw badRequest('缺少身份信息');
    }
    await revokeTokens(req.auth.subject, refreshTokenFromCookie(req) ?? refreshToken);
    clearRefreshCookie(res);
    res.json({ message: '已注销' });
});

authRouter.post(
    '/guest',
    slidingWindowRateLimit({
        keyPrefix: 'rl:auth-guest:',
        windowMs: GUEST_RATE_WINDOW_MS,
        maxRequests: GUEST_RATE_MAX,
    }),
    async (_req, res) => {
        const guestSession = await createGuestSession();
        res.status(201).json(guestSession);
    }
);

authRouter.get('/me', requireAuth, async (req, res) => {
    if (req.auth === undefined) {
        throw badRequest('缺少身份信息');
    }
    const subject = req.auth.subject;
    if (req.auth.role === 'guest') {
        const [guestProfile, progress] = await Promise.all([getGuestProfile(subject), getGuestProgress(subject)]);
        res.json({ role: 'guest', profile: guestProfile, progress });
        return;
    }
    const [userProfile, progress] = await Promise.all([getUserProfile(subject), getUserProgress(subject)]);
    res.json({ role: 'user', user: userProfile, progress });
});
