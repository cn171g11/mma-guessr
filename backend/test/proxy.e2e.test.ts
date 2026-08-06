import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { closeInfra, getApp, prepareDatabase, resetAppRedis } from './helpers.js';

beforeAll(async () => {
    await prepareDatabase();
});

beforeEach(async () => {
    await resetAppRedis();
});

afterAll(async () => {
    await closeInfra();
});

describe('GET /api/proxy/mapillary/search（未配置密钥时）', () => {
    it('缺少 MAPILLARY_TOKEN 返回 503', async () => {
        const response = await request(getApp()).get('/api/proxy/mapillary/search?bbox=2.2,48.8,2.4,48.9');
        expect(response.status).toBe(503);
    });

    it('bbox 格式非法返回 400', async () => {
        const response = await request(getApp()).get('/api/proxy/mapillary/search?bbox=not-a-bbox');
        expect(response.status).toBe(400);
    });

    it('limit 越界返回 400', async () => {
        const response = await request(getApp()).get('/api/proxy/mapillary/search?bbox=2.2,48.8,2.4,48.9&limit=999');
        expect(response.status).toBe(400);
    });
});

describe('GET /api/proxy/mapillary/image/:imageId（未配置密钥时）', () => {
    it('缺少 MAPILLARY_TOKEN 返回 503', async () => {
        const response = await request(getApp()).get('/api/proxy/mapillary/image/123');
        expect(response.status).toBe(503);
    });

    it('imageId 非法返回 400', async () => {
        const response = await request(getApp()).get('/api/proxy/mapillary/image/bad%20id!');
        expect(response.status).toBe(400);
    });

    it('width 越界返回 400', async () => {
        const response = await request(getApp()).get('/api/proxy/mapillary/image/123?width=4096');
        expect(response.status).toBe(400);
    });
});
