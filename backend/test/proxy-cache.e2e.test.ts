import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { redis } from '../src/db/redis.js';
import { closeInfra, getApp, prepareDatabase } from './helpers.js';

const SEARCH_PAYLOAD = JSON.stringify({
    data: [
        {
            id: 'mock-image-1',
            geometry: { type: 'Point', coordinates: [2.2945, 48.8584] },
            is_pano: true,
        },
    ],
});

const MEDIA_PAYLOAD = JSON.stringify({
    id: 'mock-image-1',
    thumb_1024_url: 'https://images.example.com/mock-image-1/thumb-1024.jpg',
});

async function stubMapillaryNetwork(): Promise<void> {
    vi.mocked(fetch)
        .mockReset()
        .mockImplementation(async (input) => {
            const url = typeof input === 'string' ? input : (input as globalThis.Request).url;
            if (url.includes('graph.mapillary.com/images')) {
                return new Response(SEARCH_PAYLOAD, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.includes('graph.mapillary.com/mock-image-1')) {
                return new Response(MEDIA_PAYLOAD, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
            if (url.includes('images.example.com')) {
                return new Response(Buffer.from('mock-image-bytes'), {
                    status: 200,
                    headers: { 'Content-Type': 'image/jpeg' },
                });
            }
            return new Response('not found', { status: 404 });
        });
}

function countUpstreamCallsTo(endpointFragment: string): number {
    return vi.mocked(fetch).mock.calls.filter((call) => {
        const url = typeof call[0] === 'string' ? call[0] : String(call[0]);
        return url.includes(endpointFragment);
    }).length;
}

beforeAll(async () => {
    await prepareDatabase();
    vi.stubEnv('MAPILLARY_TOKEN', 'test-mapillary-token');
    vi.stubGlobal('fetch', vi.fn());
});

beforeEach(async () => {
    await redis.flushall();
    await stubMapillaryNetwork();
});

afterEach(() => {
    vi.mocked(fetch).mockClear();
});

afterAll(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await closeInfra();
});

describe('GET /api/proxy/mapillary/search（Redis 缓存 + 服务端密钥）', () => {
    it('搜索请求携带服务端密钥代理给上游，并写入 Redis 缓存', async () => {
        const app = getApp();
        const response = await request(app).get('/api/proxy/mapillary/search?bbox=2.29,48.85,2.30,48.86&limit=20');
        expect(response.status).toBe(200);
        expect(response.body.data[0].id).toBe('mock-image-1');

        const upstreamCall = vi.mocked(fetch).mock.calls.find((call) => {
            const url = typeof call[0] === 'string' ? call[0] : String(call[0]);
            return url.includes('graph.mapillary.com/images');
        });
        expect(upstreamCall).toBeDefined();
        expect(String(upstreamCall?.[0])).toContain('access_token=test-mapillary-token');

        expect(await redis.exists('mly:search:2.29,48.85,2.30,48.86:20')).toBe(1);
        expect(await redis.ttl('mly:search:2.29,48.85,2.30,48.86:20')).toBeGreaterThan(0);
    });

    it('相同 bbox 二次请求命中缓存，不再访问上游', async () => {
        const app = getApp();
        await request(app).get('/api/proxy/mapillary/search?bbox=2.29,48.85,2.30,48.86&limit=20');
        const visitedBefore = countUpstreamCallsTo('graph.mapillary.com/images');
        const second = await request(app).get('/api/proxy/mapillary/search?bbox=2.29,48.85,2.30,48.86&limit=20');
        expect(second.status).toBe(200);
        expect(countUpstreamCallsTo('graph.mapillary.com/images')).toBe(visitedBefore);
    });
});

describe('GET /api/proxy/mapillary/image/:imageId（图片字节代理 + 缓存）', () => {
    it('返回图片字节并写入 Redis 缓存（带 TTL）', async () => {
        const app = getApp();
        const response = await request(app).get('/api/proxy/mapillary/image/mock-image-1');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('image/jpeg');
        expect(Buffer.from(response.body).toString()).toBe('mock-image-bytes');

        const cacheKey = 'mly:img:mock-image-1:1024';
        expect(await redis.exists(cacheKey)).toBe(1);
        expect(await redis.ttl(cacheKey)).toBeGreaterThan(0);
    });

    it('自定义 width 时缓存键包含宽度，且重复请求不再访问上游', async () => {
        const app = getApp();
        await request(app).get('/api/proxy/mapillary/image/mock-image-1?width=2048');
        expect(await redis.exists('mly:img:mock-image-1:2048')).toBe(1);

        const callsBefore = countUpstreamCallsTo('/mock-image-1');
        await request(app).get('/api/proxy/mapillary/image/mock-image-1?width=2048');
        expect(countUpstreamCallsTo('/mock-image-1')).toBe(callsBefore);
    });
});
