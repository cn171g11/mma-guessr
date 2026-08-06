import type { ErrorRequestHandler } from 'express';

import { createLogger } from '../logger/index.js';

const log = createLogger('http');

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err.status === 'number' ? err.status : 500;

    if (status >= 500) {
        log.error('未捕获的异常', err);
    }

    res.status(status).json({
        error: status >= 500 ? 'Internal Server Error' : (err.message ?? '请求失败'),
    });
};
