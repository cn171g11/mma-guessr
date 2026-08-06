import { Router } from 'express';

import { requireAuth } from '../middleware/authenticate.js';
import { getProfile } from '../profile/service.js';
import { playerRefOf } from '../utils/playerRef.js';

export const profileRouter = Router();

profileRouter.get('/', requireAuth, async (req, res) => {
    const profile = await getProfile(playerRefOf(req));
    res.json(profile);
});
