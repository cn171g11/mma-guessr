import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';

import { redis } from '../src/db/redis.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { slidingWindowRateLimit } from '../src/utils/slidingWindowRateLimit.js';

let defaultApp: express.Express;

function buildApp(maxRequests: number): express.Express {
    const app = express();
    app.get(
        '/limited',
        slidingWindowRateLimit({
            keyPrefix: 'test:rl:',
            windowMs: 60_000,
            maxRequests,
            // 测试用身份：优先取客户端头，便于模拟多客户端；默认回退到请求 IP
            identityFor: (req) => (req.headers['x-client-id'] as string | undefined) ?? req.ip ?? 'unknown',
        }),
        (_req, res) => res.json({ ok: true })
    );
    // 与应用一致：在路由后挂全局错误处理
    app.use(errorHandler);
    return app;
}

beforeAll(async () => {
    defaultApp = buildApp(3);
});

beforeEach(async () => {
    await redis.flushall();
});

afterAll(async () => {
    await redis.quit();
});

describe('slidingWindowRateLimit（Redis 滑动窗口计数器）', () => {
    it('窗口内放行前 N 个请求，之后拒绝并返回 429', async () => {
        for (let i = 0; i < 3; i++) {
            const response = await request(defaultApp).get('/limited');
            expect(response.status).toBe(200);
        }
        const blocked = await request(defaultApp).get('/limited');
        expect(blocked.status).toBe(429);
        expect(blocked.body.error).toBeTruthy();
    });

    it('过期成员被清理，滑动窗口放行新请求', async () => {
        const app = buildApp(1);
        await redis.zadd('test:rl:127.0.0.1', Date.now() - 60_000 - 1, 'expired-member');
        const response = await request(app).get('/limited');
        expect(response.status).toBe(200);
        expect(await redis.zcard('test:rl:127.0.0.1')).toBe(1);
    });

    it('不同客户端独立计数', async () => {
        const app = buildApp(1);
        await request(app).get('/limited').set('x-client-id', 'client-a');
        const secondCall = await request(app).get('/limited').set('x-client-id', 'client-b');
        expect(secondCall.status).toBe(200);
    });
});
