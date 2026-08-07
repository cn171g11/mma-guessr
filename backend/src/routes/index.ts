import { Router } from 'express';

import { achievementsRouter } from './achievements.js';
import { authRouter } from './auth.js';
import { checkHealth } from './health.js';
import { dailyRouter } from './daily.js';
import { gamesRouter } from './games.js';
import { leaderboardRouter } from './leaderboard.js';
import { locationsRouter } from './locations.js';
import { metricsRouter } from './metrics.js';
import { profileRouter } from './profile.js';
import { proxyRouter } from './proxy.js';

export const apiRouter = Router();

apiRouter.get('/health', checkHealth);
apiRouter.use('/achievements', achievementsRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/daily', dailyRouter);
apiRouter.use('/games', gamesRouter);
apiRouter.use('/leaderboard', leaderboardRouter);
apiRouter.use('/locations', locationsRouter);
apiRouter.use('/metrics', metricsRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/proxy', proxyRouter);
