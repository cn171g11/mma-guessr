import crypto from 'node:crypto';

import { APP_CONSTANTS } from '../config/env.js';
import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import { badRequest } from '../utils/httpError.js';
import { sendVerificationEmail } from './email.js';

const log = createLogger('auth:verification');

const CODE_KEY_PREFIX = 'verify_code:';
const ATTEMPTS_KEY_PREFIX = 'verify_code_attempts:';
const RESEND_KEY_PREFIX = 'verify_code_resend:';
const CODE_DIGITS = 6;
const HASH_ALGORITHM = 'sha256';

const codeKeyFor = (email: string): string => `${CODE_KEY_PREFIX}${email}`;
const attemptsKeyFor = (email: string): string => `${ATTEMPTS_KEY_PREFIX}${email}`;
const resendKeyFor = (email: string): string => `${RESEND_KEY_PREFIX}${email}`;
const hashOfCode = (code: string): string => crypto.createHash(HASH_ALGORITHM).update(code).digest('hex');

function generateCode(): string {
    const randomValue = crypto.randomInt(0, 10 ** CODE_DIGITS);
    return randomValue.toString().padStart(CODE_DIGITS, '0');
}

export function assertCodeFormat(submittedCode: unknown): asserts submittedCode is string {
    if (typeof submittedCode !== 'string' || !/^\d{6}$/.test(submittedCode)) {
        throw badRequest('验证码格式不正确');
    }
}

export async function sendVerificationCode(email: string): Promise<void> {
    const resendLocked = await redis.get(resendKeyFor(email));
    if (resendLocked !== null) {
        throw badRequest('发送过于频繁，请稍后再试');
    }

    const verificationCode = generateCode();
    await redis.set(codeKeyFor(email), hashOfCode(verificationCode), 'EX', APP_CONSTANTS.VERIFY_CODE_TTL_SECONDS);
    await redis.set(resendKeyFor(email), '1', 'EX', APP_CONSTANTS.VERIFY_CODE_RESEND_SECONDS);
    await redis.del(attemptsKeyFor(email));

    await sendVerificationEmail(email, verificationCode);
}

export async function consumeVerificationCode(email: string, submittedCode: string): Promise<void> {
    const codeKey = codeKeyFor(email);
    const storedHash = await redis.get(codeKey);
    if (storedHash === null) {
        throw badRequest('验证码不存在或已过期，请重新获取');
    }

    const attemptsKey = attemptsKeyFor(email);
    const attempts = Number((await redis.get(attemptsKey)) ?? 0);
    if (attempts >= APP_CONSTANTS.VERIFY_CODE_MAX_ATTEMPTS) {
        await redis.del(codeKey);
        await redis.del(attemptsKey);
        throw badRequest('验证码错误次数过多，请重新获取');
    }

    const submittedHash = hashOfCode(submittedCode);
    if (!crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(submittedHash))) {
        await redis.incr(attemptsKey);
        await redis.expire(attemptsKey, APP_CONSTANTS.VERIFY_CODE_TTL_SECONDS);
        throw badRequest('验证码错误');
    }

    await redis.del(codeKey);
    await redis.del(attemptsKey);
    log.info(`邮箱 ${email} 验证码校验通过`);
}
