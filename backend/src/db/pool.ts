import { Pool } from 'pg';

import { env } from '../config/env.js';
import { createLogger } from '../logger/index.js';
import { installQueryMonitor, type MonitoredClient } from './queryMonitor.js';

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

// 慢 SQL 监控挂载到每个新连接上：pg-pool 以 callback 形式分发 pool.query()，
// 拦截器（queryMonitor.ts）会原样转发 callback，因此不会破坏查询流程
pool.on('connect', (client) => {
    installQueryMonitor(client as unknown as MonitoredClient);
});
