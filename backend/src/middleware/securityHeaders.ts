import type { RequestHandler } from 'express';

import { env } from '../config/env.js';

// 安全响应头：防 MIME 嗅探、防点击劫持、控制来源泄露；生产环境附加 HSTS
export const securityHeaders: RequestHandler = (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
};
