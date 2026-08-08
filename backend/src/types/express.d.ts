import type { TokenSubject } from '../auth/tokens.js';

declare global {
    namespace Express {
        interface Request {
            auth?: TokenSubject;
            // 原始请求体（JSON 解析前的字节串），供请求签名中间件校验
            rawBody?: string;
        }
    }
}

export {};
