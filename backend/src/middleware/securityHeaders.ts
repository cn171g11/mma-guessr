import type { RequestHandler } from 'express';

import { env } from '../config/env.js';

// 与前端页面级 CSP（index.html meta）同规则下发,保证 API 域响应同样受限
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss: ws:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ');

// 安全响应头：防 MIME 嗅探、防点击劫持、控制来源泄露、限资源来源；生产环境附加 HSTS
export const securityHeaders: RequestHandler = (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    if (env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
};
