import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('db:redis');

export const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: false,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
});

let downReported = false;

redis.on('connect', () => {
    downReported = false;
    log.info('已连接');
});

redis.on('error', (err) => {
    if (!downReported) {
        downReported = true;
        log.warn('连接异常，重试中', err.message);
    }
});
