import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { closeInfra, getApp, prepareDatabase } from './helpers.js';

beforeAll(async () => {
    await prepareDatabase();
});

afterAll(async () => {
    await closeInfra();
});

describe('GET /api/metrics Prometheus 指标端点', () => {
    it('未配置令牌时开放访问并返回 Prometheus 文本', async () => {
        const response = await request(getApp()).get('/api/metrics');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.text).toContain('http_requests_total');
        expect(response.text).toContain('http_request_duration_seconds_sum');
        expect(response.text).toContain('backend_info');
        expect(response.text).toContain('pg_pool_total');
    });

    it('配置 METRICS_TOKEN 后必须携带 Bearer 令牌', async () => {
        vi.stubEnv('METRICS_TOKEN', 'scrape-secret');
        try {
            const denied = await request(getApp()).get('/api/metrics');
            expect(denied.status).toBe(401);

            const allowed = await request(getApp()).get('/api/metrics').set('Authorization', 'Bearer scrape-secret');
            expect(allowed.status).toBe(200);
            expect(allowed.text).toContain('http_requests_total');
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('记录已发生请求的指标（含路由归一化）', async () => {
        // 触发几个请求后再拉取
        await request(getApp()).get('/api/health');
        const response = await request(getApp()).get('/api/metrics');
        expect(response.status).toBe(200);
        expect(response.text).toContain('route="/api/health"');
    });
});
