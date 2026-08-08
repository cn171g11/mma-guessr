import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';

import { redis } from '../db/redis.js';
import { createLogger } from '../logger/index.js';
import { badRequest } from '../utils/httpError.js';
import {
    NONCE_HEADER,
    NONCE_PATTERN,
    REQUEST_SIGNATURE_MAX_SKEW_MS,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    buildSignatureMessage,
    computeRequestSignature,
} from '../utils/requestSignature.js';

const log = createLogger('request-signature');

// 无需签名的端点：健康检查（探活）、指标（独立 Bearer 令牌）、图源代理（图片经 <img> 加载无法携带请求头）
const SKIPPED_PATH_PREFIXES = ['/health', '/metrics', '/proxy'];

// nonce 标记 TTL 覆盖时间戳窗口两倍，保证窗口内重放必然被拦截
const NONCE_USED_PREFIX = 'sig:nonce:';
const NONCE_TTL_SECONDS = Math.ceil((REQUEST_SIGNATURE_MAX_SKEW_MS * 2) / 1000);

// 请求时惰性读取密钥：与 mapillary.ts 一致，便于测试注入，服务运行期更新环境变量无需重启
function getSigningSecret(): string {
    return process.env.API_SIGNING_SECRET ?? '';
}

function shouldSkipSignature(pathname: string): boolean {
    return SKIPPED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function readSignatureHeaders(req: Request): { timestamp: string; nonce: string; signature: string } | null {
    const timestamp = req.headers[TIMESTAMP_HEADER];
    const nonce = req.headers[NONCE_HEADER];
    const signature = req.headers[SIGNATURE_HEADER];
    if (typeof timestamp !== 'string' || typeof nonce !== 'string' || typeof signature !== 'string') {
        return null;
    }
    return { timestamp, nonce, signature };
}

function isWithinClockSkew(timestamp: string): boolean {
    const parsed = Number(timestamp);
    if (!Number.isInteger(parsed)) {
        return false;
    }
    return Math.abs(Date.now() - parsed) <= REQUEST_SIGNATURE_MAX_SKEW_MS;
}

function isSignatureValid(expected: string, actual: string): boolean {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(actual);
    if (expectedBuffer.length !== actualBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

// 按规范化报文重新计算签名并与客户端签名做常量时间比较
function verifyRequestSignature(req: Request, timestamp: string, nonce: string, signature: string): boolean {
    const message = buildSignatureMessage({
        timestamp,
        nonce,
        method: req.method,
        path: req.originalUrl,
        body: req.rawBody ?? '',
    });
    return isSignatureValid(computeRequestSignature(getSigningSecret(), message), signature);
}

async function isNonceFresh(nonce: string): Promise<boolean> {
    try {
        const result = await redis.set(`${NONCE_USED_PREFIX}${nonce}`, '1', 'EX', NONCE_TTL_SECONDS, 'NX');
        return result === 'OK';
    } catch (err) {
        // Redis 异常时放行防重放校验，避免签名校验故障断掉整个服务；时间戳窗口仍有效
        log.warn('nonce 去重降级放行（Redis 异常）', err);
        return true;
    }
}

export const apiSignature: RequestHandler = async (req, _res, next) => {
    // 仅在配置 API_SIGNING_SECRET 时启用，未配置（开发/本地直连）完全放行
    if (getSigningSecret() === '' || shouldSkipSignature(req.path)) {
        next();
        return;
    }

    const headers = readSignatureHeaders(req);
    if (headers === null || !isWithinClockSkew(headers.timestamp) || !NONCE_PATTERN.test(headers.nonce)) {
        throw badRequest('请求签名缺失或格式不正确');
    }
    if (!verifyRequestSignature(req, headers.timestamp, headers.nonce, headers.signature)) {
        throw badRequest('请求签名校验失败');
    }
    if (!(await isNonceFresh(headers.nonce))) {
        throw badRequest('请求已被重放');
    }
    next();
};
