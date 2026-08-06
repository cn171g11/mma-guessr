import type { ZodType } from 'zod';

import { badRequest } from './httpError.js';

function parseOrThrow<T>(schema: ZodType<T>, payload: unknown): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
        const firstIssue = result.error.issues[0];
        throw badRequest(firstIssue?.message ?? '请求参数不合法');
    }
    return result.data;
}

export function parseBody<T>(schema: ZodType<T>, payload: unknown): T {
    return parseOrThrow(schema, payload);
}

export function parseQuery<T>(schema: ZodType<T>, payload: unknown): T {
    return parseOrThrow(schema, payload);
}
