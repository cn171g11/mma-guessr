import { Router } from 'express';

import { authRouter } from './auth.js';
import { checkHealth } from './health.js';

export const apiRouter = Router();

apiRouter.get('/health', checkHealth);
apiRouter.use('/auth', authRouter);
