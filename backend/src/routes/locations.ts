import { Router } from 'express';
import { z } from 'zod';

import { APP_CONSTANTS } from '../config/env.js';
import { getLocationStats, getRandomLocations } from '../locations/service.js';
import { LOCATION_REGIONS } from '../locations/types.js';
import { parseQuery } from '../utils/validate.js';

export const locationsRouter = Router();

const randomQuerySchema = z.object({
    region: z.enum(LOCATION_REGIONS).optional(),
    difficulty: z.coerce.number().int().min(1).max(5).optional(),
    count: z.coerce.number().int().min(1).max(APP_CONSTANTS.LOCATION_RANDOM_MAX_COUNT).default(1),
});

locationsRouter.get('/random', async (req, res) => {
    const query = parseQuery(randomQuerySchema, req.query);
    const locations = await getRandomLocations({ ...query });
    res.json({ locations });
});

locationsRouter.get('/stats', async (_req, res) => {
    res.json(await getLocationStats());
});
