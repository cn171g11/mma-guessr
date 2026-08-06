import type { NextFunction, Request, Response } from 'express';

import { pool } from '../db/pool.js';
import { redis } from '../db/redis.js';

const databaseOk = (): Promise<boolean> =>
    redis
        .ping()
        .then(() => true)
        .catch(() => false);

const postgresOk = async (): Promise<boolean> => {
    try {
        const result = await pool.query('SELECT 1');
        return result.rows.length === 1;
    } catch {
        return false;
    }
};

export async function checkHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const [pgOk, redisOk] = await Promise.all([postgresOk(), databaseOk()]);

        const healthy = pgOk && redisOk;

        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'ok' : 'degraded',
            checks: {
                postgres: pgOk ? 'up' : 'down',
                redis: redisOk ? 'up' : 'down',
            },
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        next(err);
    }
}
