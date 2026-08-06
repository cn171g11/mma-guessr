import { Router } from 'express';
import { z } from 'zod';

import { getGuestProfile, getGuestProgress } from '../auth/guest.js';
import { createGuestSession } from '../auth/guest.js';
import { loginAccount, registerAccount, getUserProfile } from '../auth/accounts.js';
import { findUserByEmail } from '../auth/users.js';
import { exchangeRefreshToken, revokeTokens, verifyAccessToken } from '../auth/tokens.js';
import { sendVerificationCode } from '../auth/verificationCode.js';
import { requireAuth } from '../middleware/authenticate.js';
import { parseBody } from '../utils/validate.js';
import { badRequest, conflict } from '../utils/httpError.js';

export const authRouter = Router();

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
    refreshToken: z.string().min(1, '缺少刷新令牌'),
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

authRouter.post('/verification-code', async (req, res) => {
    const { email } = parseBody(emailSchema, req.body);
    const normalized = normalizeEmail(email);
    await assertEmailNotRegistered(normalized);
    await sendVerificationCode(normalized);
    res.json({ message: '验证码已发送' });
});

authRouter.post('/register', async (req, res) => {
    const { username, email, password, code, guestToken } = parseBody(registerSchema, req.body);
    const session = await registerAccount({
        username,
        email: normalizeEmail(email),
        password,
        verificationCode: code,
        guestId: guestToken === undefined ? undefined : resolveGuestKey(guestToken),
        ipAddress: clientIp(req),
    });
    res.status(201).json(session);
});

authRouter.post('/guest/bind', async (req, res) => {
    const { username, email, password, code, guestToken } = parseBody(bindSchema, req.body);
    const session = await registerAccount({
        username,
        email: normalizeEmail(email),
        password,
        verificationCode: code,
        guestId: resolveGuestKey(guestToken),
        ipAddress: clientIp(req),
    });
    res.status(201).json(session);
});

authRouter.post('/login', async (req, res) => {
    const { identifier, password } = parseBody(loginSchema, req.body);
    const session = await loginAccount(identifier, password, clientIp(req));
    res.json(session);
});

authRouter.post('/refresh', async (req, res) => {
    const { refreshToken } = parseBody(refreshSchema, req.body);
    const tokenPair = await exchangeRefreshToken(refreshToken, clientIp(req));
    res.json(tokenPair);
});

authRouter.post('/logout', requireAuth, async (req, res) => {
    const { refreshToken } = parseBody(logoutSchema, req.body);
    if (req.auth === undefined) {
        throw badRequest('缺少身份信息');
    }
    await revokeTokens(req.auth.subject, refreshToken);
    res.json({ message: '已注销' });
});

authRouter.post('/guest', async (_req, res) => {
    const guestSession = await createGuestSession();
    res.status(201).json(guestSession);
});

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
    const userProfile = await getUserProfile(subject);
    res.json({ role: 'user', user: userProfile });
});
