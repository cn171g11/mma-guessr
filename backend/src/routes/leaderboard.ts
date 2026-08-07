import { Router } from 'express';
import { z } from 'zod';

import { APP_CONSTANTS } from '../config/env.js';
import { GAME_MODES } from '../games/types.js';
import { getRankings } from '../leaderboard/service.js';
import { LEADERBOARD_PERIODS } from '../leaderboard/types.js';
import { slidingWindowRateLimit } from '../utils/slidingWindowRateLimit.js';
import { parseQuery } from '../utils/validate.js';

const LEADERBOARD_RATE_WINDOW_MS = 60 * 1000;
const LEADERBOARD_RATE_MAX = 120;

const leaderboardQuerySchema = z.object({
    mode: z.enum(GAME_MODES).default('classic'),
    period: z.enum(LEADERBOARD_PERIODS).default('overall'),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(APP_CONSTANTS.LEADERBOARD_MAX_LIMIT)
        .default(APP_CONSTANTS.LEADERBOARD_DEFAULT_LIMIT),
    date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'date 需为 YYYY-MM-DD')
        .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'date 不是有效日期')
        .optional(),
});

export const leaderboardRouter = Router();

leaderboardRouter.get(
    '/',
    slidingWindowRateLimit({
        keyPrefix: 'rl:leaderboard:',
        windowMs: LEADERBOARD_RATE_WINDOW_MS,
        maxRequests: LEADERBOARD_RATE_MAX,
    }),
    async (req, res) => {
        const query = parseQuery(leaderboardQuerySchema, req.query);
        const entries = await getRankings({
            period: query.period,
            mode: query.mode,
            limit: query.limit,
            date: query.date,
        });
        res.json({ period: query.period, mode: query.mode, date: query.date ?? null, entries });
    }
);
