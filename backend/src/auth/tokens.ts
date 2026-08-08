import crypto from 'node:crypto';

import jwt, { type JwtPayload } from 'jsonwebtoken';

import { APP_CONSTANTS, env } from '../config/env.js';
import { redis } from '../db/redis.js';
import type { Logger } from '../logger/index.js';
import { createLogger } from '../logger/index.js';
import { HttpError, unauthorized } from '../utils/httpError.js';

const log: Logger = createLogger('auth:tokens');

const ACCESS_TOKEN_TYPE = 'access';
const REFRESH_TOKEN_TYPE = 'refresh';

const REFRESH_KEY_PREFIX = 'refresh:';
const HASH_ALGORITHM = 'sha256';
// 显式固定签名算法，避免 jsonwebtoken 默认算法协商引入混淆攻击面
const TOKEN_ALGORITHMS = ['HS256'] as const;

export type TokenSubjectRole = 'user' | 'guest';

export interface TokenSubject {
    role: TokenSubjectRole;
    subject: string;
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}

function isTokenSubjectRole(value: unknown): value is TokenSubjectRole {
    return value === 'user' || value === 'guest';
}

function tokensMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function extraAccessTokenTtl(role: TokenSubjectRole): number {
    return role === 'guest' ? APP_CONSTANTS.GUEST_TTL_SECONDS : APP_CONSTANTS.ACCESS_TTL_SECONDS;
}

function signAccessToken(subject: TokenSubject): string {
    return jwt.sign(
        {
            sub: subject.subject,
            role: subject.role,
            type: ACCESS_TOKEN_TYPE,
            jti: crypto.randomUUID(),
        },
        env.JWT_ACCESS_SECRET,
        { expiresIn: extraAccessTokenTtl(subject.role) }
    );
}

function signRefreshToken(userId: string): string {
    return jwt.sign(
        { sub: userId, role: 'user', type: REFRESH_TOKEN_TYPE, jti: crypto.randomUUID() },
        env.JWT_REFRESH_SECRET,
        { expiresIn: APP_CONSTANTS.REFRESH_TTL_SECONDS }
    );
}

const refreshKeyFor = (userId: string): string => `${REFRESH_KEY_PREFIX}${userId}`;
const rememberRefreshHash = (refreshToken: string): string =>
    crypto.createHash(HASH_ALGORITHM).update(refreshToken).digest('hex');

export async function issueTokenPair(userId: string): Promise<TokenPair> {
    const accessToken = signAccessToken({ role: 'user', subject: userId });
    const refreshToken = signRefreshToken(userId);
    const tokenHash = rememberRefreshHash(refreshToken);

    await redis.set(refreshKeyFor(userId), tokenHash, 'EX', APP_CONSTANTS.REFRESH_TTL_SECONDS);
    log.info(`为用户 ${userId} 签发了新的令牌对`);
    return { accessToken, refreshToken };
}

export function signGuestToken(guestId: string): string {
    return signAccessToken({ role: 'guest', subject: guestId });
}

export function verifyAccessToken(token: string): TokenSubject {
    try {
        const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
            algorithms: [...TOKEN_ALGORITHMS],
        }) as JwtPayload;
        if (
            payload.type !== ACCESS_TOKEN_TYPE ||
            typeof payload.sub !== 'string' ||
            !isTokenSubjectRole(payload.role)
        ) {
            throw unauthorized('令牌类型不合法');
        }
        return { role: payload.role, subject: payload.sub };
    } catch (err) {
        if (err instanceof HttpError) {
            throw err;
        }
        if (err instanceof jwt.TokenExpiredError) {
            throw unauthorized('访问令牌已过期');
        }
        if (err instanceof jwt.JsonWebTokenError) {
            throw unauthorized('访问令牌无效');
        }
        throw err;
    }
}

export async function exchangeRefreshToken(refreshTokenInput: string, ipAddress: string): Promise<TokenPair> {
    let userId: string;
    try {
        const payload = jwt.verify(refreshTokenInput, env.JWT_REFRESH_SECRET, {
            algorithms: [...TOKEN_ALGORITHMS],
        }) as JwtPayload;
        if (payload.type !== REFRESH_TOKEN_TYPE || typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
            throw unauthorized('刷新令牌类型不合法');
        }
        userId = payload.sub;
    } catch (err) {
        if (err instanceof HttpError) {
            throw err;
        }
        if (err instanceof jwt.TokenExpiredError) {
            throw unauthorized('刷新令牌已过期');
        }
        throw unauthorized('刷新令牌无效');
    }

    const storedHash = await redis.get(refreshKeyFor(userId));
    if (storedHash === null) {
        throw unauthorized('刷新令牌已被吊销');
    }
    if (!tokensMatch(storedHash, rememberRefreshHash(refreshTokenInput))) {
        // 多标签页并发刷新会携带同一旧令牌（前端已用跨标签页锁协调，此处仍保留强吊销语义）
        await redis.del(refreshKeyFor(userId));
        log.warn(`刷新令牌被复用或伪造，已吊销用户 ${userId} 的令牌`, { ip: ipAddress });
        throw unauthorized('刷新令牌与存储不匹配');
    }

    log.info(`用户 ${userId} 刷新令牌成功`, { ip: ipAddress });
    return issueTokenPair(userId);
}

export async function revokeTokens(userId: string, submittedRefreshToken?: string): Promise<void> {
    const storedHash = await redis.get(refreshKeyFor(userId));
    if (storedHash === null) {
        return;
    }
    if (submittedRefreshToken && tokensMatch(storedHash, rememberRefreshHash(submittedRefreshToken))) {
        await redis.del(refreshKeyFor(userId));
        log.info(`用户 ${userId} 已注销`);
        return;
    }
    if (submittedRefreshToken) {
        log.warn(`用户 ${userId} 提交了不匹配的刷新令牌用于注销`);
    }
    await redis.del(refreshKeyFor(userId));
    log.info(`用户 ${userId} 刷新令牌已强制吊销`);
}
