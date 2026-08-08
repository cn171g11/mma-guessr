import { Router } from 'express';
import { z } from 'zod';

import { APP_CONSTANTS } from '../config/env.js';
import { getLocationStats, getRandomLocations } from '../locations/service.js';
import { LOCATION_REGIONS, LOCATION_SOURCES } from '../locations/types.js';
import { parseQuery } from '../utils/validate.js';
import { slidingWindowRateLimit } from '../utils/slidingWindowRateLimit.js';

export const locationsRouter = Router();

// 无鉴权接口的宽容限频：防批量枚举题库（攻击者建 id→坐标映射表破解对局）,正常游玩远低于该频率
const RANDOM_RATE_WINDOW_MS = 60 * 1000;
const RANDOM_RATE_MAX = 120;

const randomQuerySchema = z.object({
    region: z.enum(LOCATION_REGIONS).optional(),
    difficulty: z.coerce.number().int().min(1).max(5).optional(),
    source: z.enum(LOCATION_SOURCES).optional(),
    count: z.coerce.number().int().min(1).max(APP_CONSTANTS.LOCATION_RANDOM_MAX_COUNT).default(1),
});

locationsRouter.get(
    '/random',
    slidingWindowRateLimit({
        keyPrefix: 'rl:locations-random:',
        windowMs: RANDOM_RATE_WINDOW_MS,
        maxRequests: RANDOM_RATE_MAX,
    }),
    async (req, res) => {
        const query = parseQuery(randomQuerySchema, req.query);
        const locations = await getRandomLocations({ ...query });
        res.json({ locations });
    }
);

locationsRouter.get('/stats', async (_req, res) => {
    res.json(await getLocationStats());
});
