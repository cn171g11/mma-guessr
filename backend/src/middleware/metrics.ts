import type { Request, RequestHandler } from 'express';

import { recordHttpRequest } from '../metrics/registry.js';

// 路由标签只取已注册路由的模板路径（数字段等动态部分以 :id 形式呈现，基数有界）。
// 未命中任何路由的请求（404 等）统一折叠为固定标签，避免任意路径刷指标导致内存无限增长
const NOT_FOUND_ROUTE_LABEL = 'not_found';

function matchedRouteLabel(req: Request): string {
    if (typeof req.route?.path !== 'string') {
        return NOT_FOUND_ROUTE_LABEL;
    }
    const fullPath = `${req.baseUrl ?? ''}${req.route.path}`.replace(/\/+$/, '');
    return fullPath === '' ? '/' : fullPath;
}

// 注册在 apiRouter 之后：此时 req.route 已由具体路由匹配，未命中路由的请求记固定标签
export const metricsMiddleware: RequestHandler = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        recordHttpRequest(req.method, matchedRouteLabel(req), res.statusCode, durationMs);
    });
    next();
};
