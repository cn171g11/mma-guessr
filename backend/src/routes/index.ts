import { Router } from 'express';

import { authRouter } from './auth.js';
import { checkHealth } from './health.js';
import { dailyRouter } from './daily.js';
import { gamesRouter } from './games.js';
import { leaderboardRouter } from './leaderboard.js';
import { locationsRouter } from './locations.js';
import { profileRouter } from './profile.js';
import { proxyRouter } from './proxy.js';

export const apiRouter = Router();

apiRouter.get('/health', checkHealth);
apiRouter.use('/auth', authRouter);
apiRouter.use('/daily', dailyRouter);
apiRouter.use('/games', gamesRouter);
apiRouter.use('/leaderboard', leaderboardRouter);
apiRouter.use('/locations', locationsRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/proxy', proxyRouter);
