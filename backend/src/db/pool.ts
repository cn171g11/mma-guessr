import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';

import { APP_CONSTANTS, env } from '../config/env.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('db:postgres');

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    // Fail fast on DB/Sql timeout instead of letting CI hang forever
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 60_000,
    query_timeout: 30_000,
    statement_timeout: 30_000,
    allowExitOnIdle: true,
});

pool.on('error', (err) => {
    log.error('PostgreSQL 连接异常', err);
});

// 慢 SQL 监控：拦截客户端 query，超阈值记录 warn（含耗时与参数化 SQL 前缀）。
// 仅影响日志，不修改查询行为，避免引入额外依赖。
pool.on('connect', (client) => {
    const originalQuery = client.query.bind(client) as unknown as (
        text: string,
        values?: unknown[]
    ) => Promise<QueryResult<QueryResultRow>>;
    client.query = ((text: string, values?: unknown[]) => {
        const startedAt = process.hrtime.bigint();
        return Promise.resolve(originalQuery(text, values)).finally(() => {
            const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            if (elapsedMs >= APP_CONSTANTS.SLOW_QUERY_THRESHOLD_MS) {
                const firstLine = text.split('\n', 1)[0]?.trim() ?? '';
                log.warn(`慢 SQL ${elapsedMs.toFixed(1)}ms: ${firstLine}`);
            }
        });
    }) as typeof client.query;
});
