import { randomUUID } from 'node:crypto';

import { redis } from '../db/redis.js';
import type { LocationRecord } from '../locations/types.js';
import type { MPRoomState } from './types.js';

const ROOM_KEY_PREFIX = 'mp:room:';

export const QUEUE_KEY = 'mp:queue';

export interface QueueEntry {
    socketId: string;
    playerId: string;
    role: 'user' | 'guest';
    username: string;
    mode: string;
}

export const roomKeyFor = (roomId: string): string => `${ROOM_KEY_PREFIX}${roomId}`;
export const newRoomId = (): string => randomUUID();

export async function saveRoom(state: MPRoomState): Promise<void> {
    await redis.hset(roomKeyFor(state.id), {
        id: state.id,
        mode: state.mode,
        status: state.status,
        roundIndex: String(state.roundIndex),
        roundEndsAt: String(state.roundEndsAt),
        players: JSON.stringify(state.players),
        location: state.location === null ? '' : JSON.stringify(state.location),
        rounds: JSON.stringify(state.rounds),
    });
}

export async function loadRoom(roomId: string): Promise<MPRoomState | null> {
    const raw = await redis.hgetall(roomKeyFor(roomId));
    if (Object.keys(raw).length === 0) {
        return null;
    }
    return {
        id: raw.id ?? '',
        mode: raw.mode as MPRoomState['mode'],
        status: raw.status as MPRoomState['status'],
        roundIndex: Number(raw.roundIndex ?? 0),
        roundEndsAt: Number(raw.roundEndsAt ?? 0),
        players: JSON.parse(raw.players ?? '[]') as MPRoomState['players'],
        location:
            raw.location === undefined || raw.location === '' ? null : (JSON.parse(raw.location) as LocationRecord),
        rounds: JSON.parse(raw.rounds ?? '[]') as MPRoomState['rounds'],
    };
}

export async function deleteRoom(roomId: string): Promise<void> {
    await redis.del(roomKeyFor(roomId));
}

export async function expireRoom(roomId: string, ttlSeconds: number): Promise<void> {
    await redis.expire(roomKeyFor(roomId), ttlSeconds);
}

export async function enqueue(entry: QueueEntry): Promise<void> {
    await redis.lpush(QUEUE_KEY, JSON.stringify(entry));
}

// 事务性弹出两个成员：中途掉线的成员会在去重时被重新入队，避免队列丢失
export async function dequeueTwo(): Promise<QueueEntry[]> {
    const results = await redis.multi().rpop(QUEUE_KEY).rpop(QUEUE_KEY).exec();
    const entries: QueueEntry[] = [];
    for (const result of results ?? []) {
        if (result[0] === null && typeof result[1] === 'string') {
            entries.push(JSON.parse(result[1]) as QueueEntry);
        }
    }
    return entries;
}

export async function removeFromQueue(socketId: string): Promise<void> {
    const entries = await redis.lrange(QUEUE_KEY, 0, -1);
    for (const entry of entries) {
        const parsed = JSON.parse(entry) as QueueEntry;
        if (parsed.socketId === socketId) {
            await redis.lrem(QUEUE_KEY, 0, entry);
        }
    }
}

export async function queueLength(): Promise<number> {
    return redis.llen(QUEUE_KEY);
}

// 原子提交单名选手回合结果：并发双答时每个请求都会读-改-写整个房间，会互相覆盖彼此的回答
// 导致整局永不结算。改用 Lua 脚本原子更新单个玩家字段并返回当前已答人数，从而正确触发整局
export async function applyAnswer(
    roomId: string,
    socketId: string,
    distanceKm: number,
    score: number
): Promise<number> {
    const script = `
        local players = redis.call('HGET', KEYS[1], 'players')
        if not players then
            return 0
        end
        local playerList = cjson.decode(players)
        for i, p in ipairs(playerList) do
            if p.socketId == ARGV[1] then
                if p.hasAnswered then
                    return 0
                end
                p.roundDistanceKm = tonumber(ARGV[2])
                p.roundScore = tonumber(ARGV[3])
                p.totalScore = p.totalScore + tonumber(ARGV[3])
                p.hasAnswered = true
                playerList[i] = p
                redis.call('HSET', KEYS[1], 'players', cjson.encode(playerList))
                return #playerList
            end
        end
        return 0
    `;
    const result = await redis.eval(script, 1, roomKeyFor(roomId), socketId, String(distanceKm), String(score));
    return Number(result);
}
