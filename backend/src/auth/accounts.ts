import { APP_CONSTANTS } from '../config/env.js';
import bcrypt from 'bcryptjs';
import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import { mergeGuestProgressIntoUser } from './guest.js';
import { hashPassword, verifyPassword } from './password.js';
import { issueTokenPair, type TokenPair } from './tokens.js';
import {
    createUser,
    findUserByIdentifier,
    getRequiredUserById,
    toPublicProfile,
    type PublicUserProfile,
} from './users.js';
import { consumeVerificationCode } from './verificationCode.js';
import { badRequest, unauthorized } from '../utils/httpError.js';

const log = createLogger('auth:accounts');

const LOGIN_LOCK_KEY_PREFIX = 'login_lock:';
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RegisterInput {
    username: string;
    email: string;
    password: string;
    verificationCode: string;
    guestId?: string;
    ipAddress: string;
}

export interface AccountSession {
    user: PublicUserProfile;
    tokenPair: TokenPair;
}

const loginLockKeyFor = (identifier: string): string => `${LOGIN_LOCK_KEY_PREFIX}${identifier.toLowerCase()}`;

// 账号不存在时也执行一次成本相同的假校验，抹平"账号不存在/密码错误"的响应时间差，
// 防止远程时序探测枚举已注册账号
let dummyPasswordHash: string | null = null;
async function verifyPasswordConstantTime(password: string, storedHash: string | null): Promise<boolean> {
    if (storedHash === null) {
        dummyPasswordHash ??= await bcrypt.hash('timing-equal-dummy-password', APP_CONSTANTS.BCRYPT_ROUNDS);
        await verifyPassword(password, dummyPasswordHash);
        return false;
    }
    return verifyPassword(password, storedHash);
}

export function assertValidAccountFields(username: string, email: string, password: string): void {
    if (!USERNAME_PATTERN.test(username)) {
        throw badRequest('用户名需为 3-20 位字母、数字或下划线');
    }
    if (!EMAIL_PATTERN.test(email)) {
        throw badRequest('邮箱格式不正确');
    }
    if (password.length < 8 || password.length > 72) {
        throw badRequest('密码长度需为 8-72 位');
    }
    // bcrypt 仅取前 72 字节，按字符上限会静默截断多字节密码导致哈希碰撞,需按字节校验
    if (Buffer.byteLength(password, 'utf8') > 72) {
        throw badRequest('密码过长（UTF-8 编码后不得超过 72 字节）');
    }
}

export async function registerAccount(registerInput: RegisterInput): Promise<AccountSession> {
    assertValidAccountFields(registerInput.username, registerInput.email, registerInput.password);
    await consumeVerificationCode(registerInput.email, registerInput.verificationCode);

    const passwordHash = await hashPassword(registerInput.password);
    const userRecord = await createUser({
        username: registerInput.username,
        email: registerInput.email.toLowerCase(),
        passwordHash,
    });

    if (registerInput.guestId) {
        await migrateGuestProgressSafely(registerInput.guestId, userRecord.id);
    }

    const tokenPair = await issueTokenPair(userRecord.id);
    log.info(`新用户注册成功 userId=${userRecord.id} ip=${registerInput.ipAddress}`);
    return { user: toPublicProfile(userRecord), tokenPair };
}

async function migrateGuestProgressSafely(guestId: string, userId: string): Promise<void> {
    try {
        await mergeGuestProgressIntoUser(guestId, userId);
    } catch (err) {
        log.warn(`游客进度迁移失败 guestId=${guestId} userId=${userId}`, err);
    }
}

export async function loginAccount(identifier: string, password: string, ipAddress: string): Promise<AccountSession> {
    await assertLoginNotLocked(identifier);

    const userRecord = await findUserByIdentifier(identifier.toLowerCase());
    const verified = await verifyPasswordConstantTime(password, userRecord?.password_hash ?? null);
    if (userRecord === null || !verified) {
        await recordLoginFailure(identifier);
        throw unauthorized('账号或密码错误');
    }

    await redis.del(loginLockKeyFor(identifier));
    const tokenPair = await issueTokenPair(userRecord.id);
    log.info(`用户登录成功 userId=${userRecord.id} ip=${ipAddress}`);
    return { user: toPublicProfile(userRecord), tokenPair };
}

async function assertLoginNotLocked(identifier: string): Promise<void> {
    const currentAttempts = Number((await redis.get(loginLockKeyFor(identifier))) ?? 0);
    if (currentAttempts >= APP_CONSTANTS.LOGIN_MAX_ATTEMPTS) {
        throw unauthorized('尝试次数过多，账号已临时锁定，请 15 分钟后再试');
    }
}

async function recordLoginFailure(identifier: string): Promise<void> {
    const lockKey = loginLockKeyFor(identifier);
    const attempts = await redis.incr(lockKey);
    // 首次失败即设置 TTL：历史失败计数永不残留，避免低频率攻击者借助陈旧计数无限期累积锁定
    if (attempts === 1) {
        await redis.expire(lockKey, APP_CONSTANTS.LOGIN_LOCK_SECONDS);
    }
}

export async function getUserProfile(userId: string): Promise<PublicUserProfile> {
    const userRecord = await getRequiredUserById(userId);
    return toPublicProfile(userRecord);
}
