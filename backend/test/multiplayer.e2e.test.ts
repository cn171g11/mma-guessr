import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

import { attachSocketServer, stopSocketServer } from '../src/socket.js';
import { roomKeyFor } from '../src/multiplayer/cache.js';
import { redis } from '../src/db/redis.js';
import { closeInfra, getApp, prepareDatabase, resetAuthState } from './helpers.js';

const TOTAL_ROUNDS = 5;

let server: http.Server;
let serverUrl: string;
const liveClients: ClientSocket[] = [];

// 服务端中止对局（mp:error，如题目池为空）时立即拒绝挂起的等待，
// 让失败信息直接指向根因，而不是空等 8 秒后报"事件超时"
function attachAbortHandler(client: ClientSocket, reject: (reason: Error) => void): void {
    client.once('mp:error', (data: unknown) => {
        const message =
            typeof data === 'object' && data !== null && 'message' in data
                ? String((data as { message: unknown }).message)
                : '未知错误';
        reject(new Error(`服务端中止对局：${message}`));
    });
}

function waitFor(client: ClientSocket, event: string, timeoutMs = 8000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        attachAbortHandler(client, reject);
        const timer = setTimeout(() => {
            client.off(event, handler);
            reject(new Error(`等待事件 ${event} 超时`));
        }, timeoutMs);
        const handler = (data: unknown): void => {
            clearTimeout(timer);
            resolve(data);
        };
        client.on(event, handler);
    });
}

// 事件缓冲：注册即收，消费时再取。服务端可能在客户端挂上监听器之前就下发事件
//（例如 mp:matched 之后紧跟的 mp:round），直接 waitFor 会因监听注册太晚而永久丢失
function makeEventBuffer<T>(client: ClientSocket, event: string): { next(timeoutMs?: number): Promise<T> } {
    const queue: T[] = [];
    const waiters: Array<{ resolve: (value: T) => void; timer: NodeJS.Timeout }> = [];
    client.on(event, (data: T) => {
        const waiter = waiters.shift();
        if (waiter !== undefined) {
            clearTimeout(waiter.timer);
            waiter.resolve(data);
        } else {
            queue.push(data);
        }
    });
    return {
        next(timeoutMs = 8000): Promise<T> {
            const queued = queue.shift();
            if (queued !== undefined) {
                return Promise.resolve(queued);
            }
            return new Promise((resolve, reject) => {
                attachAbortHandler(client, reject);
                const timer = setTimeout(() => reject(new Error(`等待事件 ${event} 超时`)), timeoutMs);
                waiters.push({ resolve, timer });
            });
        },
    };
}

function waitForConnect(client: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', (err: Error) => reject(new Error(`连接失败：${err.message}`)));
    });
}

function connectClient(token: string): ClientSocket {
    const client = createClient(serverUrl, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
    });
    liveClients.push(client);
    return client;
}

async function createGuestToken(): Promise<string> {
    const response = await request(getApp()).post('/api/auth/guest');
    expect(response.status).toBe(201);
    return response.body.guestToken as string;
}

// 服务端不再向客户端下发本回合答案坐标（mp:round 仅含渲染街景所需字段），
// 测试需像权威计分那样从房间缓存取得真实坐标来构造"精确命中"与"远离"的猜测
async function currentRoundLocation(roomId: string): Promise<{ lat: number; lng: number } | null> {
    const raw = await redis.hget(roomKeyFor(roomId), 'location');
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }
    return JSON.parse(raw) as { lat: number; lng: number };
}

// 与对局协议联动的完整 5 回合流程：等待 round -> 提交答案 -> 等待 roundEnd
// near = true 的选手提交与答案完全相同的坐标（0km -> 满分），far 的选手提交对跖点（几乎 0 分）
async function playFullMatch(client: ClientSocket, near: boolean): Promise<{ rankings: unknown }> {
    // 在等待 matched 之前就注册 round/roundEnd 缓冲，杜绝服务端先于监听器下发事件导致的丢事件
    const rounds = makeEventBuffer<{ roundIndex: number; location: Record<string, unknown> }>(client, 'mp:round');
    const roundEnds = makeEventBuffer<unknown>(client, 'mp:roundEnd');
    const matched = (await waitFor(client, 'mp:matched')) as { roomId: string };
    for (let roundIndex = 0; roundIndex < TOTAL_ROUNDS; roundIndex++) {
        const roundData = await rounds.next();
        expect(roundData.roundIndex).toBe(roundIndex);
        expect(roundData.location.name).toBeUndefined();
        // 安全回归断言：题目坐标绝不随 mp:round 下发
        expect(roundData.location.lat).toBeUndefined();
        expect(roundData.location.lng).toBeUndefined();
        const location = await currentRoundLocation(matched.roomId);
        if (location === null) {
            throw new Error('无法读取本回合答案坐标');
        }
        client.emit(
            'mp:answer',
            near
                ? { guessLat: location.lat, guessLng: location.lng, roundIndex }
                : { guessLat: -location.lat, guessLng: (location.lng >= 0 ? location.lng - 180 : location.lng + 180), roundIndex }
        );
        await roundEnds.next();
    }
    return (await waitFor(client, 'mp:finished')) as { rankings: unknown };
}

beforeAll(async () => {
    await prepareDatabase();
    server = http.createServer(getApp());
    attachSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as AddressInfo;
    serverUrl = `http://localhost:${address.port}`;
});

beforeEach(async () => {
    await resetAuthState();
});

afterEach(() => {
    for (const client of liveClients) {
        client.disconnect();
    }
    liveClients.length = 0;
});

afterAll(async () => {
    stopSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeInfra();
});

describe('Socket.IO 多人对战', () => {
    it('双人完成 5 回合对局并按服务端计分排出名次', async () => {
        const tokenA = await createGuestToken();
        const tokenB = await createGuestToken();
        const clientA = connectClient(tokenA);
        const clientB = connectClient(tokenB);
        await Promise.all([waitForConnect(clientA), waitForConnect(clientB)]);

        clientA.emit('mp:join', { mode: 'classic' });
        clientB.emit('mp:join', { mode: 'classic' });

        const [finishedA, finishedB] = await Promise.all([
            playFullMatch(clientA, true),
            playFullMatch(clientB, false),
        ]);

        const rankingsA = finishedA.rankings as Array<{ playerId: string; username: string; totalScore: number }>;
        const rankingsB = finishedB.rankings as Array<{ playerId: string; username: string; totalScore: number }>;
        expect(rankingsA).toHaveLength(2);
        expect(rankingsA[0].totalScore).toBeGreaterThan(rankingsA[1].totalScore);
        expect(rankingsA[0]).toEqual(rankingsB[0]);
        expect(rankingsA[0].totalScore).toBe(TOTAL_ROUNDS * 5000);
        expect(rankingsA[1].totalScore).toBe(0);

        clientA.disconnect();
        clientB.disconnect();
    });

    it('对局结束后成绩写入 game_results（duel 模式）', async () => {
        const tokenA = await createGuestToken();
        const tokenB = await createGuestToken();
        const clientA = connectClient(tokenA);
        const clientB = connectClient(tokenB);
        await Promise.all([waitForConnect(clientA), waitForConnect(clientB)]);

        clientA.emit('mp:join', { mode: 'classic' });
        clientB.emit('mp:join', { mode: 'classic' });
        await Promise.all([playFullMatch(clientA, true), playFullMatch(clientB, false)]);
        clientA.disconnect();
        clientB.disconnect();

        const recentA = await request(getApp()).get('/api/games/recent').set('Authorization', `Bearer ${tokenA}`);
        expect(recentA.status).toBe(200);
        expect(recentA.body.games).toHaveLength(1);
        expect(recentA.body.games[0].mode).toBe('duel');
        expect(recentA.body.games[0].rounds).toHaveLength(TOTAL_ROUNDS);
        expect(recentA.body.games[0].totalScore).toBe(TOTAL_ROUNDS * 5000);
    });

    it('未携带有效令牌的连接被拒绝', async () => {
        const client = connectClient('invalid-token');
        await expect(waitForConnect(client)).rejects.toThrow('连接失败');
        client.disconnect();
    });
});
