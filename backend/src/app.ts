import cors from 'cors';
import express from 'express';

import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRouter } from './routes/index.js';

export function createApp(): express.Express {
    const app = express();

    app.disable('x-powered-by');
    app.use(cors());
    app.use(express.json({ limit: '1mb' }));
    app.use(requestLogger);

    app.get('/', (_req, res) => {
        res.json({ name: 'mma-guessr-backend', status: 'ok' });
    });

    app.use('/api', apiRouter);

    app.use(notFound);
    app.use(errorHandler);

    return app;
}
