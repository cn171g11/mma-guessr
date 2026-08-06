import type { RequestHandler } from 'express';

import { verifyAccessToken } from '../auth/tokens.js';
import { unauthorized } from '../utils/httpError.js';

const BEARER_PREFIX = 'Bearer ';
const AUTH_HEADER_NAME = 'authorization';

function extractBearerToken(requestHeaderValue: string | undefined): string | null {
    if (requestHeaderValue === undefined || !requestHeaderValue.startsWith(BEARER_PREFIX)) {
        return null;
    }
    const token = requestHeaderValue.slice(BEARER_PREFIX.length).trim();
    return token.length > 0 ? token : null;
}

function getAuthenticatedSubject(requestHeaderValue: string | undefined) {
    const token = extractBearerToken(requestHeaderValue);
    if (token === null) {
        throw unauthorized('请先登录');
    }
    return verifyAccessToken(token);
}

export const requireAuth: RequestHandler = (req, _res, next) => {
    req.auth = getAuthenticatedSubject(req.headers[AUTH_HEADER_NAME]);
    next();
};

export const requireRegisteredUser: RequestHandler = (req, _res, next) => {
    req.auth = getAuthenticatedSubject(req.headers[AUTH_HEADER_NAME]);
    if (req.auth.role !== 'user') {
        throw unauthorized('该接口需要注册用户身份');
    }
    next();
};
