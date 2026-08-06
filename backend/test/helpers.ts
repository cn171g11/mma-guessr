import { expect, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';
import { redis } from '../src/db/redis.js';

let expressApp: Express | null = null;

export function getApp(): Express {
    if (expressApp === null) {
        expressApp = createApp();
    }
    return expressApp;
}

export async function prepareDatabase(): Promise<void> {
    await runMigrations();
}

// 应用在 Redis 中的 key 命名空间。只清理这些前缀，避免用全局 flushall 误伤
// 其他并发测试文件（如多人对战的队列/房间、题库池）的运行状态
const APP_REDIS_PREFIXES = [
    'auth:',
    'login_lock:',
    'verify_code:',
    'verify_code_attempts:',
    'verify_code_resend:',
    'refresh:',
    'guest:',
    'guest_progress:',
    'user_progress:',
    'user_daily:',
    'daily:',
    'locations:',
    'lb:',
    'profile:stats:',
    'mp:',
    'mly:',
    'rl:',
    'test:rl:',
] as const;

export async function resetAppRedis(): Promise<void> {
    const allKeys = await redis.keys('*');
    const targets = allKeys.filter((key) => APP_REDIS_PREFIXES.some((prefix) => key.startsWith(prefix)));
    if (targets.length > 0) {
        await redis.del(...targets);
    }
}

export async function resetAuthState(): Promise<void> {
    await pool.query('DELETE FROM daily_challenges');
    await pool.query('DELETE FROM scores');
    await pool.query('DELETE FROM game_results');
    await pool.query('DELETE FROM users');
    await resetAppRedis();
}

export async function closeInfra(): Promise<void> {
    await Promise.allSettled([redis.quit().catch(() => undefined), pool.end()]);
}

export function makeRandomEmail(prefix: string): string {
    const uniqueSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `${prefix}-${uniqueSuffix}@example.com`;
}

const VERIFICATION_CODE_PATTERN = /code=(\d{6})/;

export async function obtainVerificationCode(email: string): Promise<string> {
    const consoleSpy = vi.spyOn(console, 'info');
    const response = await request(getApp()).post('/api/auth/verification-code').send({ email });
    const loggedContent = consoleSpy.mock.calls.map((callArgs) => callArgs.join(' ')).join('\n');
    consoleSpy.mockRestore();

    expect(response.status).toBe(200);
    const codeMatch = VERIFICATION_CODE_PATTERN.exec(loggedContent);
    if (codeMatch === null) {
        throw new Error(`未能在日志中捕获 ${email} 的验证码`);
    }
    return codeMatch[1];
}
