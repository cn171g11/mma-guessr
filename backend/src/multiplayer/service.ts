import type { Server, Socket } from 'socket.io';

import { getUserProfile } from '../auth/accounts.js';
import { getGuestProfile } from '../auth/guest.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { APP_CONSTANTS } from '../config/env.js';
import * as gamesService from '../games/service.js';
import type { PlayerRef } from '../games/types.js';
import { haversineKm } from '../games/scoring.js';
import * as locationsService from '../locations/service.js';
import { createLogger } from '../logger/index.js';
import * as cache from './cache.js';
import type { MPPlayerState, MPRoomState, MPRoundHistory } from './types.js';

const log = createLogger('multiplayer');

// 与前端 config.js SCORE_CONFIG.global 保持一致的计分公式：
// score = 5000 × e^(-10 × max(d, dMinKm) / (D × α))，D=2000、α=2.3、dMin=30m
const DUEL_MAX_SCORE = 5000;
const DUEL_REFERENCE_SPAN_KM = 2000;
const DUEL_BALANCE_FACTOR = 2.3;
const DUEL_MIN_DISTANCE_KM = 30 / 1000;

function computeScore(distanceKm: number): number {
    const effectiveDistance = Math.max(distanceKm, DUEL_MIN_DISTANCE_KM);
    const referenceSpan = DUEL_REFERENCE_SPAN_KM * DUEL_BALANCE_FACTOR;
    const score = Math.round(DUEL_MAX_SCORE * Math.exp((-10 * effectiveDistance) / referenceSpan));
    return Math.max(0, Math.min(DUEL_MAX_SCORE, score));
}

interface QueuePlayerInfo {
    playerId: string;
    role: 'user' | 'guest';
    username: string;
}

interface PlayerIdentity extends PlayerRef {
    username: string;
}

function toRoundHistory(room: MPRoomState): MPRoundHistory {
    return {
        locationId: room.location?.id ?? 0,
        locationName: room.location?.name ?? '',
        results: room.players.map((player) => ({
            playerId: player.playerId,
            distanceKm: player.roundDistanceKm,
            score: player.roundScore,
        })),
    };
}

export class MultiplayerService {
    private readonly io: Server;
    private readonly roomTimers = new Map<string, NodeJS.Timeout>();
    private readonly socketRooms = new Map<string, string>();
    private readonly endingRooms = new Set<string>();
    private readonly matchmakerTimer: NodeJS.Timeout;

    constructor(io: Server) {
        this.io = io;
        this.matchmakerTimer = setInterval(() => void this.tickMatchmaker(), APP_CONSTANTS.MP_MATCHMAKER_TICK_MS);
        this.matchmakerTimer.unref();
    }

    public stop(): void {
        clearInterval(this.matchmakerTimer);
        for (const timer of this.roomTimers.values()) {
            clearTimeout(timer);
        }
        this.roomTimers.clear();
    }

    // 握手阶段完成令牌校验与身份解析（含 Redis/DB 查询）：
    // 中间件先于客户端的 connect 事件执行，保证连接建立后客户端第一条事件（如 mp:join）
    // 到达时监听器与 socket.data.identity 均已就绪，避免事件在监听注册前被丢弃
    public async authenticate(socket: Socket, next: (err?: Error) => void): Promise<void> {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string' || token.length === 0) {
            next(new Error('缺少身份令牌'));
            return;
        }
        let auth: { role: PlayerRef['role']; subject: string };
        try {
            auth = verifyAccessToken(token);
        } catch (err) {
            next(err instanceof Error ? err : new Error('身份验证失败'));
            return;
        }
        try {
            const identity = await this.resolveIdentity({ role: auth.role, id: auth.subject });
            socket.data.auth = auth;
            socket.data.identity = identity;
            next();
        } catch (err) {
            next(err instanceof Error ? err : new Error('身份信息解析失败'));
        }
    }

    public handleConnection(socket: Socket): void {
        const identity = socket.data.identity as PlayerIdentity | undefined;
        if (identity === undefined) {
            socket.emit('mp:error', { message: '缺少身份信息' });
            socket.disconnect(true);
            return;
        }
        // 监听器必须在连接事件后同步注册（无 await），与握手中间件配合杜绝事件丢失
        socket.on('mp:join', (payload: unknown) => void this.handleJoin(socket, identity, payload));
        socket.on('mp:leave', () => void this.handleLeave(socket));
        socket.on('mp:answer', (payload: unknown) => void this.handleAnswer(socket, payload));
        socket.on('disconnect', () => void this.handleDisconnect(socket));
        log.info(`对战连接建立 player=${identity.role}:${identity.id} (${identity.username})`);
    }

    private async resolveIdentity(player: PlayerRef): Promise<PlayerIdentity> {
        if (player.role === 'user') {
            const profile = await getUserProfile(player.id);
            return { ...player, username: profile.username };
        }
        const profile = await getGuestProfile(player.id);
        return { ...player, username: profile?.username ?? `游客_${player.id.slice(0, 4)}` };
    }

    private toPlayerState(socketId: string, player: QueuePlayerInfo): MPPlayerState {
        return {
            socketId,
            playerId: player.playerId,
            role: player.role,
            username: player.username,
            totalScore: 0,
            roundScore: 0,
            roundDistanceKm: null,
            hasAnswered: false,
        };
    }

    private async handleJoin(socket: Socket, identity: PlayerIdentity, payload: unknown): Promise<void> {
        if (this.socketRooms.has(socket.id)) {
            socket.emit('mp:error', { message: '你已在队列或对战中' });
            return;
        }
        const mode = typeof payload === 'object' && payload !== null ? (payload as { mode?: unknown }).mode : undefined;
        const entry: cache.QueueEntry = {
            socketId: socket.id,
            playerId: identity.id,
            role: identity.role,
            username: identity.username,
            mode: typeof mode === 'string' && mode.length > 0 ? mode : 'classic',
        };
        await cache.enqueue(entry);
        const position = await cache.queueLength();
        socket.emit('mp:queued', { position });
        log.info(`玩家 ${identity.username} 已进入匹配队列`);
    }

    private async handleLeave(socket: Socket): Promise<void> {
        await cache.removeFromQueue(socket.id);
        socket.emit('mp:leftQueue');
    }

    private async tickMatchmaker(): Promise<void> {
        const entries = await cache.dequeueTwo();
        const [first, second] = entries;
        if (first !== undefined && second !== undefined) {
            await this.createRoom(first, second);
        } else if (first !== undefined) {
            await cache.enqueue(first);
        }
    }

    private async createRoom(entryA: cache.QueueEntry, entryB: cache.QueueEntry): Promise<void> {
        const socketA = this.io.sockets.sockets.get(entryA.socketId);
        const socketB = this.io.sockets.sockets.get(entryB.socketId);
        if (socketA === undefined || socketB === undefined) {
            for (const entry of [entryA, entryB]) {
                if (this.io.sockets.sockets.get(entry.socketId) !== undefined) {
                    await cache.enqueue(entry);
                }
            }
            return;
        }

        const roomId = cache.newRoomId();
        const room: MPRoomState = {
            id: roomId,
            mode: 'duel',
            status: 'playing',
            roundIndex: 0,
            players: [this.toPlayerState(entryA.socketId, entryA), this.toPlayerState(entryB.socketId, entryB)],
            location: null,
            roundEndsAt: 0,
            rounds: [],
        };
        await cache.saveRoom(room);
        socketA.join(roomId);
        socketB.join(roomId);
        this.socketRooms.set(entryA.socketId, roomId);
        this.socketRooms.set(entryB.socketId, roomId);
        socketA.emit('mp:matched', { roomId, mode: room.mode, opponentUsername: entryB.username });
        socketB.emit('mp:matched', { roomId, mode: room.mode, opponentUsername: entryA.username });
        log.info(`房间 ${roomId} 创建成功：${entryA.username} vs ${entryB.username}`);
        await this.startRound(roomId);
    }

    private async startRound(roomId: string): Promise<void> {
        const room = await cache.loadRoom(roomId);
        if (room === null || room.status !== 'playing') {
            return;
        }
        const drawn = await locationsService.getRandomLocations({ count: 1 });
        const location = drawn[0];
        if (location === undefined) {
            this.abortRoom(roomId, '题目池为空，对局中止');
            return;
        }

        room.location = location;
        room.roundEndsAt = Date.now() + APP_CONSTANTS.MP_ROUND_SECONDS * 1000;
        for (const player of room.players) {
            player.roundScore = 0;
            player.roundDistanceKm = null;
            player.hasAnswered = false;
        }
        await cache.saveRoom(room);

        // 不向客户端下发答案坐标，仅下发渲染街景所需的字段；距离由服务端在 handleAnswer 权威计算
        this.io.to(roomId).emit('mp:round', {
            roundIndex: room.roundIndex,
            totalRounds: APP_CONSTANTS.MP_TOTAL_ROUNDS,
            timeLimitMs: APP_CONSTANTS.MP_ROUND_SECONDS * 1000,
            location: {
                id: location.id,
                panoramaUrl: location.panoramaUrl,
                mapillaryId: location.mapillaryId,
            },
        });

        const timer = setTimeout(() => void this.endRound(roomId), APP_CONSTANTS.MP_ROUND_SECONDS * 1000);
        this.roomTimers.set(roomId, timer);
    }

    private async handleAnswer(socket: Socket, payload: unknown): Promise<void> {
        const roomId = this.socketRooms.get(socket.id);
        if (roomId === undefined) {
            socket.emit('mp:error', { message: '你不在对局中' });
            return;
        }
        const body = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};

        const room = await cache.loadRoom(roomId);
        if (room === null || room.status !== 'playing') {
            return;
        }
        // 迟到答案可能落在下一回合（上一回合超时结算后），按回合号过滤防止串回合
        const claimedRound = typeof body.roundIndex === 'number' ? body.roundIndex : room.roundIndex;
        if (claimedRound !== room.roundIndex) {
            return;
        }
        if (room.location === null) {
            socket.emit('mp:error', { message: '对局状态异常' });
            return;
        }

        const guess = this.parseGuessCoordinates(body);
        if (guess === null) {
            socket.emit('mp:error', { message: '无效的坐标提交' });
            return;
        }
        // 客户端只上报猜测坐标，答案距离由服务器依本房间题目权威计算，防止客户端刷分
        const distanceKm = haversineKm(guess.lat, guess.lng, room.location.lat, room.location.lng);
        const answeredCount = await cache.applyAnswer(roomId, socket.id, distanceKm, computeScore(distanceKm));
        if (answeredCount === room.players.length) {
            await this.endRound(roomId);
        }
    }

    private parseGuessCoordinates(body: Record<string, unknown>): { lat: number; lng: number } | null {
        const lat = typeof body.guessLat === 'number' ? body.guessLat : Number.NaN;
        const lng = typeof body.guessLng === 'number' ? body.guessLng : Number.NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return null;
        }
        return { lat, lng };
    }

    // 回合结束与结算：answer 触达与 60s 定时器可能并发触发，用 endingRooms 保证只结算一次
    private async endRound(roomId: string): Promise<void> {
        if (this.endingRooms.has(roomId)) {
            return;
        }
        this.endingRooms.add(roomId);
        try {
            await this.settleRound(roomId);
        } finally {
            this.endingRooms.delete(roomId);
        }
    }

    private async settleRound(roomId: string): Promise<void> {
        const timer = this.roomTimers.get(roomId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.roomTimers.delete(roomId);
        }
        const room = await cache.loadRoom(roomId);
        if (room === null || room.status !== 'playing') {
            return;
        }
        if (room.location === null) {
            this.abortRoom(roomId, '对局状态异常');
            return;
        }

        const history = toRoundHistory(room);
        room.rounds.push(history);
        await cache.saveRoom(room);
        this.io.to(roomId).emit('mp:roundEnd', {
            roundIndex: room.roundIndex,
            answer: { name: room.location.name, lat: room.location.lat, lng: room.location.lng },
            results: history.results,
        });

        if (room.roundIndex + 1 < APP_CONSTANTS.MP_TOTAL_ROUNDS) {
            room.roundIndex += 1;
            await cache.saveRoom(room);
            await this.startRound(roomId);
            return;
        }
        await this.finishRoom(roomId);
    }

    private async finishRoom(roomId: string): Promise<void> {
        const room = await cache.loadRoom(roomId);
        if (room === null || room.status !== 'playing') {
            return;
        }
        room.status = 'finished';
        await cache.saveRoom(room);

        // 先落库再通知：客户端收到 finished 时成绩必须已持久化，避免前端刷新后记录缺失
        await this.recordDuelGames(room);

        const rankings = [...room.players].sort((left, right) => right.totalScore - left.totalScore);
        this.io.to(roomId).emit('mp:finished', {
            rankings: rankings.map((player) => ({
                playerId: player.playerId,
                username: player.username,
                totalScore: player.totalScore,
            })),
        });
        log.info(`房间 ${roomId} 对局结束`);

        await cache.expireRoom(roomId, APP_CONSTANTS.MP_ROOM_TTL_SECONDS);
    }

    private async recordDuelGames(room: MPRoomState): Promise<void> {
        for (const player of room.players) {
            const rounds = room.rounds.map((history) => {
                const result = history.results.find((entry) => entry.playerId === player.playerId);
                return {
                    name: history.locationName,
                    locationId: history.locationId,
                    distanceKm: result?.distanceKm ?? null,
                    score: result?.score ?? 0,
                    imageId: null,
                    xp: 0,
                    difficulty: 1,
                };
            });
            try {
                await gamesService.submitGame(
                    { role: player.role, id: player.playerId },
                    { mode: 'duel', region: null, totalScore: player.totalScore, rounds }
                );
            } catch (err) {
                log.warn(`对战成绩记录失败 player=${player.role}:${player.playerId}`, (err as Error).message);
            }
        }
    }

    private async abortRoom(roomId: string, reason: string): Promise<void> {
        this.io.to(roomId).emit('mp:error', { message: reason });
        await cache.deleteRoom(roomId);
    }

    private async handleDisconnect(socket: Socket): Promise<void> {
        await cache.removeFromQueue(socket.id);
        const roomId = this.socketRooms.get(socket.id);
        this.socketRooms.delete(socket.id);
        if (roomId === undefined) {
            return;
        }

        const room = await cache.loadRoom(roomId);
        if (room === null || room.status !== 'playing') {
            return;
        }
        this.io.to(roomId).emit('mp:opponentLeft', { reason: '对手已离开，对局中止' });
        const timer = this.roomTimers.get(roomId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.roomTimers.delete(roomId);
        }
        await cache.deleteRoom(roomId);
        log.info(`房间 ${roomId} 因玩家离线而中止`);
    }
}

export function createMultiplayerService(io: Server): MultiplayerService {
    const service = new MultiplayerService(io);
    io.use((socket, next) => service.authenticate(socket, next));
    io.on('connection', (socket) => void service.handleConnection(socket));
    return service;
}
