import type { QueryResult, QueryResultRow } from 'pg';

import { APP_CONSTANTS } from '../config/env.js';
import { createLogger } from '../logger/index.js';

const log = createLogger('db:postgres');

export interface MonitoredClient {
    query: (...args: unknown[]) => unknown;
}

type QueryCallback = (err: Error | undefined, result?: QueryResult<QueryResultRow>) => void;

// 慢 SQL 监控：拦截客户端 query，超阈值记录 warn（含耗时与参数化 SQL 前缀）。
// pg 的 query 同时支持 Promise 与 callback 两种调用形式；pg-pool 以 callback 形式
// 调用 client.query(text, values, cb)（见 pg-pool/index.js 的 query 分发），
// 拦截器必须把 callback 原样转发，否则 pool.query() 永远不会 resolve（CI 挂死根因）。
export function installQueryMonitor(client: MonitoredClient): void {
    const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;

    client.query = ((...args: unknown[]) => {
        const startedAt = process.hrtime.bigint();
        const sql = typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
        const firstLine = sql.split('\n', 1)[0]?.trim() ?? '';

        const logIfSlow = (): void => {
            const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            if (elapsedMs >= APP_CONSTANTS.SLOW_QUERY_THRESHOLD_MS) {
                log.warn(`慢 SQL ${elapsedMs.toFixed(1)}ms: ${firstLine}`);
            }
        };

        const callbackIndex = typeof args[args.length - 1] === 'function' ? args.length - 1 : -1;
        if (callbackIndex >= 0) {
            const originalCallback = args[callbackIndex] as QueryCallback;
            const forwardedArgs = [...args];
            forwardedArgs[callbackIndex] = ((err: Error | undefined, result?: QueryResult<QueryResultRow>) => {
                logIfSlow();
                originalCallback(err, result);
            }) as unknown;
            return originalQuery(...forwardedArgs);
        }

        return Promise.resolve(originalQuery(...args) as Promise<QueryResult<QueryResultRow>>).finally(logIfSlow);
    }) as typeof client.query;
}
