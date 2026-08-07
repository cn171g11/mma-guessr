// 轻量 Prometheus 文本格式指标注册表（无外部依赖）
// 采集：HTTP 请求计数/耗时、进程基础信息、PostgreSQL 连接池状态
import { APP_CONSTANTS } from '../config/env.js';

export const HTTP_DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.5, 1, 2.5, 10];

const requestCounts = new Map<string, number>();
const durationBuckets = new Map<string, number[]>();
const durationCounts = new Map<string, number>();
let durationSumMs = 0;
let durationCount = 0;

function keyOf(method: string, route: string): string {
    return `${method} ${route}`;
}

function ensureDuration(key: string): number[] {
    let buckets = durationBuckets.get(key);
    if (buckets === undefined) {
        buckets = new Array(HTTP_DURATION_BUCKETS.length).fill(0);
        durationBuckets.set(key, buckets);
    }
    return buckets;
}

export function recordHttpRequest(method: string, route: string, status: number, durationMs: number): void {
    const key = keyOf(method, route);
    requestCounts.set(`${key} ${status}`, (requestCounts.get(`${key} ${status}`) ?? 0) + 1);
    durationCounts.set(key, (durationCounts.get(key) ?? 0) + 1);

    const buckets = ensureDuration(key);
    const seconds = durationMs / 1000;
    for (let index = 0; index < buckets.length; index++) {
        const threshold = HTTP_DURATION_BUCKETS[index];
        if (threshold !== undefined && seconds <= threshold) {
            buckets[index] = (buckets[index] ?? 0) + 1;
        }
    }
    durationSumMs += durationMs;
    durationCount++;
}

function escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderCounters(): string[] {
    const lines: string[] = [
        '# HELP http_requests_total 处理的 HTTP 请求总数（按方法/路由/状态码）',
        '# TYPE http_requests_total counter',
    ];
    for (const [key, count] of [...requestCounts.entries()].sort()) {
        const [method = '', route = '', status = ''] = key.split(' ');
        lines.push(
            `http_requests_total{method="${escapeLabelValue(method)}",route="${escapeLabelValue(route)}",status="${status}"} ${count}`
        );
    }
    return lines;
}

function renderDurations(): string[] {
    const lines: string[] = [
        '# HELP http_request_duration_seconds HTTP 请求耗时分布（秒）',
        '# TYPE http_request_duration_seconds histogram',
    ];
    for (const [key, buckets] of [...durationBuckets.entries()].sort()) {
        const [method = '', route = ''] = key.split(' ');
        const labelPrefix = `method="${escapeLabelValue(method)}",route="${escapeLabelValue(route)}"`;
        buckets.forEach((count, index) => {
            lines.push(
                `http_request_duration_seconds_bucket{${labelPrefix},le="${HTTP_DURATION_BUCKETS[index]}"} ${count}`
            );
        });
        lines.push(`http_request_duration_seconds_bucket{${labelPrefix},le="+Inf"} ${durationCounts.get(key) ?? 0}`);
    }
    lines.push(`http_request_duration_seconds_sum ${durationSumMs / 1000}`);
    lines.push(`http_request_duration_seconds_count ${durationCount}`);
    return lines;
}

export interface PoolSnapshot {
    total: number;
    idle: number;
    waiting: number;
}

// 采集时由调用方注入连接池快照，指标注册表不直接依赖 pg
export function renderMetrics(snapshot: PoolSnapshot): string {
    const lines: string[] = [
        `# HELP process_uptime_seconds 进程运行时长（秒）`,
        `# TYPE process_uptime_seconds gauge`,
        `process_uptime_seconds ${process.uptime()}`,
        `# HELP process_memory_heap_bytes 进程堆内存（字节）`,
        `# TYPE process_memory_heap_bytes gauge`,
        `process_memory_heap_bytes ${process.memoryUsage().heapUsed}`,
        `# HELP pg_pool_total PostgreSQL 连接池总连接数`,
        `# TYPE pg_pool_total gauge`,
        `pg_pool_total ${snapshot.total}`,
        `# HELP pg_pool_idle PostgreSQL 连接池空闲连接数`,
        `# TYPE pg_pool_idle gauge`,
        `pg_pool_idle ${snapshot.idle}`,
        `# HELP pg_pool_waiting PostgreSQL 连接池等待连接数`,
        `# TYPE pg_pool_waiting gauge`,
        `pg_pool_waiting ${snapshot.waiting}`,
        `# HELP backend_info 后端版本信息`,
        `# TYPE backend_info gauge`,
        `backend_info{version="${APP_CONSTANTS.SERVICE_VERSION}"} 1`,
        ...renderCounters(),
        ...renderDurations(),
    ];
    return `${lines.join('\n')}\n`;
}
