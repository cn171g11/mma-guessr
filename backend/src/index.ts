import 'dotenv/config';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { redis } from './db/redis.js';
import { createLogger } from './logger/index.js';

const log = createLogger('server');

async function shutdown(signal: string): Promise<void> {
    log.info(`收到 ${signal}，正在关闭服务…`);
    const closeTasks = [redis.quit().catch(() => undefined), pool.end()];
    await Promise.allSettled(closeTasks);
    process.exit(0);
}

async function bootstrap(): Promise<void> {
    const app = createApp();

    app.listen(env.PORT, () => {
        log.info(`已启动：http://localhost:${env.PORT} (env: ${env.NODE_ENV})`);
    });

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
    log.error('启动失败', err);
    process.exit(1);
});
