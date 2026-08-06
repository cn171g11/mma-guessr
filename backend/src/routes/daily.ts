import { Router } from 'express';

import * as dailyService from '../daily/service.js';
import { requireAuth } from '../middleware/authenticate.js';
import { playerRefOf } from '../utils/playerRef.js';

export const dailyRouter = Router();

dailyRouter.get('/today', requireAuth, async (req, res) => {
    const challenge = await dailyService.getToday(playerRefOf(req));
    res.json(challenge);
});
