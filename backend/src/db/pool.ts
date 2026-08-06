import { Pool } from 'pg';

import { env } from '../config/env.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('db:postgres');

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
});

pool.on('error', (err) => {
    log.error('PostgreSQL 连接异常', err);
});
