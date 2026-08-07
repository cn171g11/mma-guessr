import { Router, type Request } from 'express';
import { z } from 'zod';

import { getProgress } from '../auth/guest.js';
import { APP_CONSTANTS } from '../config/env.js';
import { GAME_MODES, type GameMode } from '../games/types.js';
import * as gamesService from '../games/service.js';
import { LOCATION_REGIONS } from '../locations/types.js';
import { requireAuth } from '../middleware/authenticate.js';
import { badRequest } from '../utils/httpError.js';
import { playerRefOf } from '../utils/playerRef.js';
import { slidingWindowRateLimit } from '../utils/slidingWindowRateLimit.js';
import { parseBody, parseQuery } from '../utils/validate.js';

const IMAGE_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;

const roundSchema = z.object({
    name: z.string().min(1, '地点名称不能为空').max(120, '地点名称过长'),
    locationId: z.number().int().positive().nullable().optional(),
    distanceKm: z.number().min(0).max(40075, '距离超出一周范围').nullable(),
    score: z.number().int().min(0).max(APP_CONSTANTS.MAX_ROUND_SCORE, '单轮得分超限'),
    // 与 /api/proxy 相同的严格字符集，避免历史记录渲染时被注入 href 属性
    imageId: z.string().regex(IMAGE_ID_PATTERN, 'imageId 包含非法字符').nullable().optional(),
    xp: z.number().int().min(0).max(APP_CONSTANTS.MAX_ROUND_SCORE).optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    guessLat: z.number().min(-90).max(90).nullable().optional(),
    guessLng: z.number().min(-180).max(180).nullable().optional(),
    answerLat: z.number().min(-90).max(90).nullable().optional(),
    answerLng: z.number().min(-180).max(180).nullable().optional(),
});

const submitSchema = z.object({
    mode: z.enum(GAME_MODES),
    region: z.enum(LOCATION_REGIONS).nullable().optional(),
    totalScore: z.number().int().min(0).max(APP_CONSTANTS.MAX_TOTAL_SCORE, '总分超限'),
    rounds: z.array(roundSchema).min(1, '至少一轮').max(APP_CONSTANTS.MAX_ROUNDS_PER_GAME, '回合数超限'),
});

const recentQuerySchema = z.object({
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(APP_CONSTANTS.GAMES_RECENT_MAX_LIMIT)
        .default(APP_CONSTANTS.GAMES_RECENT_DEFAULT_LIMIT),
});

const bestQuerySchema = z.object({
    mode: z.enum(GAME_MODES),
});

const gameIdSchema = z.coerce.number().int().min(1);

// 区域模式的 region 必填，其他模式一律不允许携带
function resolveRegion(mode: GameMode, region: string | null | undefined): string | null {
    if (mode === 'region') {
        if (region === undefined || region === null) {
            throw badRequest('区域模式必须指定 region');
        }
        return region;
    }
    if (region !== undefined && region !== null) {
        throw badRequest('仅区域模式可携带 region');
    }
    return null;
}

export const gamesRouter: Router = Router();

gamesRouter.post(
    '/',
    requireAuth,
    slidingWindowRateLimit({
        keyPrefix: 'rl:games-submit:',
        windowMs: APP_CONSTANTS.GAMES_RATE_WINDOW_MS,
        maxRequests: APP_CONSTANTS.GAMES_RATE_SUBMIT_MAX,
        identityFor: (req: Request) => `${req.auth?.role ?? 'anon'}:${req.auth?.subject ?? req.ip}`,
    }),
    async (req, res) => {
        const { mode, region, totalScore, rounds: submittedRounds } = parseBody(submitSchema, req.body);
        const rounds = submittedRounds.map((round) => ({
            name: round.name,
            locationId: round.locationId ?? null,
            distanceKm: round.distanceKm,
            score: round.score,
            imageId: round.imageId ?? null,
            xp: round.xp ?? 0,
            difficulty: round.difficulty ?? 1,
            guessLat: round.guessLat ?? null,
            guessLng: round.guessLng ?? null,
            answerLat: round.answerLat ?? null,
            answerLng: round.answerLng ?? null,
        }));
        const game = await gamesService.submitGame(playerRefOf(req), {
            mode,
            region: resolveRegion(mode, region),
            totalScore,
            rounds,
        });
        res.status(201).json({ game });
    }
);

gamesRouter.get('/recent', requireAuth, async (req, res) => {
    const { limit } = parseQuery(recentQuerySchema, req.query);
    const games = await gamesService.getRecentGames(playerRefOf(req), limit);
    res.json({ games });
});

gamesRouter.get('/best', requireAuth, async (req, res) => {
    const { mode } = parseQuery(bestQuerySchema, req.query);
    const best = await gamesService.getBestGame(playerRefOf(req), mode);
    res.json({ best });
});

gamesRouter.get('/summary', requireAuth, async (req, res) => {
    const player = playerRefOf(req);
    const progress = await getProgress(player.role, player.id);
    res.json({ progress });
});

gamesRouter.delete('/:gameId', requireAuth, async (req, res) => {
    const gameId = parseQuery(gameIdSchema, req.params.gameId);
    await gamesService.deleteGame(playerRefOf(req), gameId);
    res.json({ ok: true });
});
