import cors from 'cors';
import express from 'express';

import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestLogger } from './middleware/requestLogger.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { apiRouter } from './routes/index.js';
import { isOriginAllowed } from './utils/cors.js';

export function createApp(): express.Express {
    const app = express();

    app.disable('x-powered-by');
    // 来源白名单：仅放行配置的前端域名（开发默认 localhost）；拒绝时不下发 CORS 头，浏览器侧拦截。
    // credentials 开启以支持刷新令牌 HttpOnly Cookie 随请求回传
    app.use(
        cors({
            origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
            credentials: true,
        })
    );
    app.use(securityHeaders);
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
