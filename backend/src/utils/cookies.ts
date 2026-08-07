import type { Request, Response } from 'express';

import { APP_CONSTANTS, env } from '../config/env.js';

// 刷新令牌仅经 HttpOnly Cookie 下发，前端 JS 无法读取，降低 XSS 下的账号接管面
export const REFRESH_COOKIE_NAME = 'mma_refresh';

type SameSiteMode = 'strict' | 'lax' | 'none';

function parseSameSiteMode(value: string): SameSiteMode {
    if (value === 'strict' || value === 'none') {
        return value;
    }
    return 'lax';
}

export function refreshTokenFromCookie(req: Request): string | undefined {
    const header = req.headers.cookie;
    if (header === undefined) {
        return undefined;
    }
    for (const part of header.split(';')) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }
        if (part.slice(0, separatorIndex).trim() !== REFRESH_COOKIE_NAME) {
            continue;
        }
        try {
            return decodeURIComponent(part.slice(separatorIndex + 1).trim());
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: parseSameSiteMode(env.COOKIE_SAME_SITE),
        maxAge: APP_CONSTANTS.REFRESH_TTL_SECONDS * 1000,
        path: '/',
    });
}

export function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, { path: '/' });
}
