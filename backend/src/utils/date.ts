export function utcDateKey(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

export function utcDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now: Date = new Date()): number {
    const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(1, Math.floor((nextMidnight - now.getTime()) / 1000));
}
