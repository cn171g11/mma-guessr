import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';

import { attachSocketServer, stopSocketServer } from '../src/socket.js';
import { closeInfra, getApp, prepareDatabase, resetAuthState } from './helpers.js';

const TOTAL_ROUNDS = 5;
const NEAR_DISTANCE_KM = 0.01;
const FAR_DISTANCE_KM = 5000;

let server: http.Server;
let serverUrl: string;
const liveClients: ClientSocket[] = [];

function waitFor(client: ClientSocket, event: string, timeoutMs = 8000): Promise<unknown> {
    return new Promise((resolve, reject) => {
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

// 与对局协议联动的完整 5 回合流程：等待 round -> 提交答案 -> 等待 roundEnd
async function playFullMatch(client: ClientSocket, distanceKm: number): Promise<{ rankings: unknown }> {
    await waitFor(client, 'mp:matched');
    for (let roundIndex = 0; roundIndex < TOTAL_ROUNDS; roundIndex++) {
        const roundData = (await waitFor(client, 'mp:round')) as {
            roundIndex: number;
            location: Record<string, unknown>;
        };
        expect(roundData.roundIndex).toBe(roundIndex);
        expect(roundData.location.name).toBeUndefined();
        client.emit('mp:answer', { distanceKm, roundIndex });
        await waitFor(client, 'mp:roundEnd');
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
            playFullMatch(clientA, NEAR_DISTANCE_KM),
            playFullMatch(clientB, FAR_DISTANCE_KM),
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
        await Promise.all([playFullMatch(clientA, NEAR_DISTANCE_KM), playFullMatch(clientB, FAR_DISTANCE_KM)]);
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
