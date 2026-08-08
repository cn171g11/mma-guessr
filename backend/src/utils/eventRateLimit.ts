// 内存版事件限流器（滑动窗口）：供 Socket.IO 等非 HTTP 路径复用，
// 与 Redis 版 slidingWindowRateLimit 语义一致，但不依赖 Redis 可用性
export interface EventRateLimitOptions {
    windowMs: number;
    maxEvents: number;
}

export class EventRateLimiter {
    private readonly windowMs: number;
    private readonly maxEvents: number;
    private readonly eventsByKey = new Map<string, number[]>();

    constructor(options: EventRateLimitOptions) {
        this.windowMs = options.windowMs;
        this.maxEvents = options.maxEvents;
    }

    public allow(key: string, now: number = Date.now()): boolean {
        const events = this.eventsByKey.get(key);
        if (events === undefined) {
            this.eventsByKey.set(key, [now]);
            return true;
        }
        while (events.length > 0) {
            const oldest = events[0];
            if (oldest === undefined || oldest > now - this.windowMs) {
                break;
            }
            events.shift();
        }
        if (events.length >= this.maxEvents) {
            return false;
        }
        events.push(now);
        return true;
    }

    public reset(key: string): void {
        this.eventsByKey.delete(key);
    }
}
