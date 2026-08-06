import 'dotenv/config';

import { pool } from '../db/pool.js';
import { redis } from '../db/redis.js';
import { rebuildRankings } from '../leaderboard/service.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('cli:lb');

async function main(): Promise<void> {
    await rebuildRankings();
    await Promise.all([redis.quit().catch(() => undefined), pool.end()]);
    log.info('排行榜重建完成');
}

main().catch(async (err: unknown) => {
    log.error('排行榜重建失败', err);
    await Promise.all([redis.quit().catch(() => undefined), pool.end()]);
    process.exit(1);
});
