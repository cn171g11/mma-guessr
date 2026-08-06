import { Router } from 'express';

import { authRouter } from './auth.js';
import { checkHealth } from './health.js';
import { gamesRouter } from './games.js';
import { locationsRouter } from './locations.js';
import { proxyRouter } from './proxy.js';

export const apiRouter = Router();

apiRouter.get('/health', checkHealth);
apiRouter.use('/auth', authRouter);
apiRouter.use('/games', gamesRouter);
apiRouter.use('/locations', locationsRouter);
apiRouter.use('/proxy', proxyRouter);
