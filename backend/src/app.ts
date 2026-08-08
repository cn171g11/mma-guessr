import cors from 'cors';
import express from 'express';

import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { notFound } from './middleware/notFound.js';
import { requestLogger } from './middleware/requestLogger.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { apiSignature } from './middleware/apiSignature.js';
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
    // verify 回调捕获 JSON 解析前的原始字节，供请求签名中间件计算 bodyHash
    app.use(
        express.json({
            limit: '1mb',
            verify: (req, _res, buffer) => {
                (req as express.Request).rawBody = buffer.toString('utf8');
            },
        })
    );
    app.use(requestLogger);
    // 指标中间件须在业务路由之前挂载：命中路由的请求在路由内即结束响应,
    // 若挂在路由之后将永远收不到 finish 事件,导致计数全部丢失。
    // 计数/耗时在 res 的 finish 事件中上报,此时 req.route 已由路由匹配填充,标签不受挂载位置影响
    app.use(metricsMiddleware);

    app.get('/', (_req, res) => {
        res.json({ name: 'mma-guessr-backend', status: 'ok' });
    });

    // 请求签名校验先于业务路由：配置 API_SIGNING_SECRET 后强制校验签名与 nonce
    app.use('/api', apiSignature);
    app.use('/api', apiRouter);
    app.use(notFound);
    app.use(errorHandler);

    return app;
}
