import cors from 'cors';
import express from 'express';

import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { notFound } from './middleware/notFound.js';
import { requestLogger } from './middleware/requestLogger.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { apiRouter } from './routes/index.js';
import { env } from './config/env.js';
import { isOriginAllowed } from './utils/cors.js';

export function createApp(): express.Express {
    const app = express();

    app.disable('x-powered-by');
    // TRUST_PROXY 显式设置时信任反向代理的 X-Forwarded-For，保证 req.ip / 按 IP 限频按真实客户端生效；
    // 默认不信任，防止端口直连时客户端伪造 XFF 头绕过限频
    if (env.TRUST_PROXY !== undefined) {
        app.set('trust proxy', env.TRUST_PROXY);
    }
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
    app.use(metricsMiddleware);

    app.use(notFound);
    app.use(errorHandler);

    return app;
}
