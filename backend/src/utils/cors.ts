import { env } from '../config/env.js';

// 默认来源：本地开发（任意端口）；生产环境（CORS_ALLOWED_ORIGINS 非空）退化为白名单精确匹配
function isLocalhost(origin: string): boolean {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function isOriginAllowed(origin: string | undefined): boolean {
    if (origin === undefined) {
        // 无 Origin 头（curl / 服务端调用）不受浏览器同源策略约束，放行
        return true;
    }
    if (env.CORS_ALLOWED_ORIGINS !== '') {
        const allowList = env.CORS_ALLOWED_ORIGINS.split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        return allowList.includes(origin);
    }
    return isLocalhost(origin);
}
