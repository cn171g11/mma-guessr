import { Router } from 'express';

import { checkHealth } from './health.js';

export const apiRouter = Router();

apiRouter.get('/health', checkHealth);
