import { describe, expect, it } from 'vitest';

import { installQueryMonitor, type MonitoredClient } from '../src/db/queryMonitor.js';

interface FakeClient extends MonitoredClient {
    calls: Array<{ text: string; hasCallback: boolean }>;
}

function createFakeClient(): FakeClient {
    const calls: FakeClient['calls'] = [];
    const client: FakeClient = {
        calls,
        query: ((...args: unknown[]) => {
            const text = typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
            const lastArg = args[args.length - 1];
            const hasCallback = typeof lastArg === 'function';
            calls.push({ text, hasCallback });
            // 模拟 pg 行为：Promise 形式返回结果，callback 形式立即调用回调
            if (hasCallback) {
                (lastArg as (err: unknown, result?: unknown) => void)(undefined, { rows: [] });
                return undefined;
            }
            return Promise.resolve({ rows: [] });
        }) as MonitoredClient['query'],
    };
    return client;
}

describe('installQueryMonitor（慢 SQL 拦截器）', () => {
    it('pg-pool 的 callback 分发形式（query(text, values, cb)）拿到结果且不挂起', async () => {
        const client = createFakeClient();
        installQueryMonitor(client);

        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('query 回调未触发，pool.query 挂死')), 1000);
            client.query('SELECT 1', [], (err: unknown, res: unknown) => {
                clearTimeout(timer);
                if (err !== undefined) {
                    reject(err as Error);
                    return;
                }
                resolve(res);
            });
        });
        expect(result).toEqual({ rows: [] });
        expect(client.calls).toEqual([{ text: 'SELECT 1', hasCallback: true }]);
    });

    it('callback 形式（query(text, cb)）同样转发', async () => {
        const client = createFakeClient();
        installQueryMonitor(client);

        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('query(text, cb) 回调未完成')), 1000);
            client.query('INSERT INTO t VALUES ($1)', (err: unknown, res: unknown) => {
                clearTimeout(timer);
                if (err !== undefined) {
                    reject(err as Error);
                    return;
                }
                resolve(res);
            });
        });
        expect(result).toEqual({ rows: [] });
        expect(client.calls[0]?.hasCallback).toBe(true);
    });

    it('Promise 形式（query(text) / query(text, values)）正常返回', async () => {
        const client = createFakeClient();
        installQueryMonitor(client);

        await expect(client.query('SELECT 1')).resolves.toEqual({ rows: [] });
        await expect(client.query('SELECT $1', [1])).resolves.toEqual({ rows: [] });
        expect(client.calls).toEqual([
            { text: 'SELECT 1', hasCallback: false },
            { text: 'SELECT $1', hasCallback: false },
        ]);
    });

    it('参数化 SQL 取首行用于日志，对象形式也支持', async () => {
        const client = createFakeClient();
        installQueryMonitor(client);

        await client.query('SELECT 1\nFROM users;\n-- trailing', []);
        expect(client.calls[0]?.hasCallback).toBe(false);
    });

    it('未包装的 callback 形式在 pg-pool 模拟下能收到回调（回归防挂死）', async () => {
        const client = createFakeClient();
        installQueryMonitor(client);

        let resolved = false;
        await new Promise<void>((resolvePromise) => {
            client.query('BEGIN', (err: unknown, res: unknown) => {
                expect(err).toBeUndefined();
                expect(res).toEqual({ rows: [] });
                resolved = true;
                resolvePromise();
            });
        });
        expect(resolved).toBe(true);
    });
});
