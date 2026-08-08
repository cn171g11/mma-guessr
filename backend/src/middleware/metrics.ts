import type { Request, RequestHandler } from 'express';

import { recordHttpRequest } from '../metrics/registry.js';

// 路由标签在 res 的 finish 事件中读取：此时 req.route 已由路由匹配填充，数字段等动态部分以 :id 形式呈现（基数有界）。
// 未命中任何路由的请求（404 等）统一折叠为固定标签，避免任意路径刷指标导致内存无限增长
const NOT_FOUND_ROUTE_LABEL = 'not_found';

function matchedRouteLabel(req: Request): string {
    if (typeof req.route?.path !== 'string') {
        return NOT_FOUND_ROUTE_LABEL;
    }
    const fullPath = `${req.baseUrl ?? ''}${req.route.path}`.replace(/\/+$/, '');
    return fullPath === '' ? '/' : fullPath;
}

// 挂载在业务路由之前（见 app.ts），保证命中路由的请求也能被记录：
// 计数在 finish 事件中上报，此时 req.route 已就绪，挂载位置不影响标签准确性
export const metricsMiddleware: RequestHandler = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        recordHttpRequest(req.method, matchedRouteLabel(req), res.statusCode, durationMs);
    });
    next();
};
