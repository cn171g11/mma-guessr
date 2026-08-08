import type { ErrorRequestHandler } from 'express';

import { createLogger } from '../logger/index.js';
import { HttpError } from '../utils/httpError.js';

const log = createLogger('http');

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err.status === 'number' ? err.status : 500;

    if (status >= 500) {
        log.error('未捕获的异常', err);
    }

    // 仅 HttpError（业务主动抛出）透传文案；驱动/依赖层错误可能含 SQL 片段等内部细节,一律固定化
    const isHttpError = err instanceof HttpError;
    res.status(status).json({
        error: status >= 500 || !isHttpError ? 'Internal Server Error' : (err.message ?? '请求失败'),
    });
};
