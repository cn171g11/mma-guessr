import type { RequestHandler } from 'express';

import { createLogger } from '../logger/index.js';

const log = createLogger('http');

export const requestLogger: RequestHandler = (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        const message = `${req.method} ${req.originalUrl} -> ${res.statusCode} (${elapsedMs.toFixed(1)}ms)`;

        if (res.statusCode >= 500) {
            log.error(message, { ip: req.ip });
        } else if (res.statusCode >= 400) {
            log.warn(message, { ip: req.ip });
        } else {
            log.info(message);
        }
    });

    next();
};
