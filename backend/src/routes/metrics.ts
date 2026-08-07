import { timingSafeEqual } from 'node:crypto';

import { Router } from 'express';

import { pool } from '../db/pool.js';
import { renderMetrics } from '../metrics/registry.js';
import { unauthorized } from '../utils/httpError.js';

const router = Router();

function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}

// 指标端点：设置 METRICS_TOKEN 后必须携带 Bearer 令牌（Prometheus scrape 支持）。
// 未配置令牌时开放访问，便于开发环境直接查看。
router.get('/', (_req, res) => {
    const expectedToken = process.env.METRICS_TOKEN ?? '';
    if (expectedToken !== '') {
        const header = _req.headers.authorization ?? '';
        const bearerToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
        if (bearerToken === '' || !safeEqual(bearerToken, expectedToken)) {
            throw unauthorized('获取指标需要有效令牌');
        }
    }

    const snapshot = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
    };
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(renderMetrics(snapshot));
});

export const metricsRouter = router;
