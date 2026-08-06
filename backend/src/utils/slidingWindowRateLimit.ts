import crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import { tooManyRequests } from './httpError.js';

const log = createLogger('rate-limit');

// 滑动窗口计数：清理过期成员后，窗口内成员数达到上限则拒绝
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - windowMs)
local count = redis.call('ZCARD', key)
if count >= maxRequests then
    return 0
end
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, math.ceil(windowMs / 1000))
return 1
`;

export interface SlidingWindowOptions {
    keyPrefix: string;
    windowMs: number;
    maxRequests: number;
    identityFor?: (req: Request) => string;
}

export function slidingWindowRateLimit(options: SlidingWindowOptions): RequestHandler {
    const { keyPrefix, windowMs, maxRequests, identityFor } = options;
    const resolveIdentity = identityFor ?? ((req: Request) => req.ip ?? 'unknown');

    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        const key = `${keyPrefix}${resolveIdentity(req)}`;
        const member = `${Date.now()}:${crypto.randomUUID()}`;

        let allowed: boolean;
        try {
            const result = await redis.eval(RATE_LIMIT_SCRIPT, 1, key, Date.now(), windowMs, maxRequests, member);
            allowed = result === 1;
        } catch (err) {
            // Redis 异常时放行，避免限频器故障断掉整个代理服务；额度由上游限速兜底
            log.warn('限频器降级放行（Redis 异常）', err);
            next();
            return;
        }

        if (!allowed) {
            throw tooManyRequests('请求过于频繁，请稍后再试');
        }
        next();
    };
}
