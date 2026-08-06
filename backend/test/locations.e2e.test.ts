import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { pool } from '../src/db/pool.js';
import { redis } from '../src/db/redis.js';
import { closeInfra, getApp, prepareDatabase } from './helpers.js';

const FIXTURES = [
    { name: '日本东京·东京塔', lat: 35.6586, lng: 139.7454, region: 'asia', difficulty: 1 },
    { name: '法国巴黎·埃菲尔铁塔', lat: 48.8584, lng: 2.2945, region: 'europe', difficulty: 2 },
    { name: '巴西里约·科帕卡巴纳海滩', lat: -22.9711, lng: -43.1822, region: 'southamerica', difficulty: 3 },
];

async function seedFixtures(): Promise<void> {
    for (const fixture of FIXTURES) {
        await pool.query('INSERT INTO locations (name, lat, lng, region, difficulty) VALUES ($1, $2, $3, $4, $5)', [
            fixture.name,
            fixture.lat,
            fixture.lng,
            fixture.region,
            fixture.difficulty,
        ]);
    }
}

beforeAll(async () => {
    await prepareDatabase();
});

beforeEach(async () => {
    await pool.query('DELETE FROM locations');
    await redis.flushall();
    await seedFixtures();
});

afterAll(async () => {
    await closeInfra();
});

describe('GET /api/locations/random', () => {
    it('默认返回 1 个完整地点的地点记录', async () => {
        const response = await request(getApp()).get('/api/locations/random');
        expect(response.status).toBe(200);
        expect(response.body.locations).toHaveLength(1);
        const location = response.body.locations[0];
        expect(location).toMatchObject({
            id: expect.any(Number),
            name: expect.any(String),
            region: expect.any(String),
            difficulty: expect.any(Number),
        });
        expect(location.lat).toBeTypeOf('number');
        expect(location.lng).toBeTypeOf('number');
    });

    it('count 参数返回指定数量且不重复', async () => {
        const response = await request(getApp()).get('/api/locations/random?count=3');
        expect(response.status).toBe(200);
        const names = response.body.locations.map((location) => (location as { name: string }).name);
        expect(names).toHaveLength(3);
        expect(new Set(names).size).toBe(3);
    });

    it('region 过滤只返回该大洲题目', async () => {
        const response = await request(getApp()).get('/api/locations/random?region=europe&count=5');
        expect(response.status).toBe(200);
        const regions = response.body.locations.map((location: { region: string }) => location.region);
        expect(regions.length).toBeGreaterThan(0);
        expect(regions.every((region: string) => region === 'europe')).toBe(true);
    });

    it('difficulty 过滤生效', async () => {
        const response = await request(getApp()).get('/api/locations/random?difficulty=2&count=5');
        expect(response.status).toBe(200);
        const difficulties = response.body.locations.map((location: { difficulty: number }) => location.difficulty);
        expect(difficulties.length).toBeGreaterThan(0);
        expect(difficulties.every((difficulty: number) => difficulty === 2)).toBe(true);
    });

    it('非法 region 返回 400', async () => {
        const response = await request(getApp()).get('/api/locations/random?region=atlantis');
        expect(response.status).toBe(400);
    });

    it('count 越界返回 400', async () => {
        expect((await request(getApp()).get('/api/locations/random?count=0')).status).toBe(400);
        expect((await request(getApp()).get('/api/locations/random?count=21')).status).toBe(400);
    });

    it('题目 ID 池写入 Redis 并带 TTL（热数据缓存）', async () => {
        await request(getApp()).get('/api/locations/random?count=2');
        const key = 'locations:pool:all:all';
        const members = await redis.smembers(key);
        expect(members).toHaveLength(3);
        expect(await redis.ttl(key)).toBeGreaterThan(0);
    });

    it('按区域维度建池：region=europe 时池中仅含欧洲 ID', async () => {
        await request(getApp()).get('/api/locations/random?region=europe');
        const members = await redis.smembers('locations:pool:europe:all');
        expect(members).toHaveLength(1);
    });
});

describe('GET /api/locations/stats', () => {
    it('返回总数与各洲计数（缓存于 Redis）', async () => {
        const response = await request(getApp()).get('/api/locations/stats');
        expect(response.status).toBe(200);
        expect(response.body.total).toBe(3);
        expect(response.body.byRegion).toMatchObject({ asia: 1, europe: 1, southamerica: 1 });
        expect(await redis.exists('locations:stats')).toBe(1);
    });
});
