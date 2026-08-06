type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

function isLogLevel(value: string | undefined): value is LogLevel {
    return value !== undefined && value in LEVEL_ORDER;
}

const activeLevel: LogLevel = (() => {
    const raw = process.env.LOG_LEVEL;
    if (isLogLevel(raw)) {
        return raw;
    }
    if (raw !== undefined) {
        console.warn(`[logger] 未知日志级别 "${raw}"，回退为 info`);
    }
    return 'info';
})();

interface Logger {
    debug: (message: string, ...meta: unknown[]) => void;
    info: (message: string, ...meta: unknown[]) => void;
    warn: (message: string, ...meta: unknown[]) => void;
    error: (message: string, ...meta: unknown[]) => void;
}

function formatValue(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? value.message;
    }
    if (typeof value === 'object' && value !== null) {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function writeLog(level: LogLevel, prefix: string, message: string, meta: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[activeLevel]) {
        return;
    }

    const timestamp = new Date().toISOString();

    if (process.env.NODE_ENV === 'production') {
        const payload: Record<string, unknown> = { level, message, timestamp };
        if (prefix) {
            payload.namespace = prefix.slice(1, -1);
        }
        if (meta.length > 0) {
            payload.meta = meta.map(formatValue);
        }
        console[level === 'debug' ? 'log' : level](JSON.stringify(payload));
        return;
    }

    const sink = level === 'debug' ? console.log : console[level];
    const line = `[${timestamp}] [${level.toUpperCase()}]${prefix} ${message}`;
    const parts = meta.map(formatValue);
    if (parts.length > 0) {
        sink(line, ...parts);
    } else {
        sink(line);
    }
}

export type { Logger };

export function createLogger(namespace = ''): Logger {
    const prefix = namespace ? `[${namespace}]` : '';
    return {
        debug: (message, ...meta) => writeLog('debug', prefix, message, meta),
        info: (message, ...meta) => writeLog('info', prefix, message, meta),
        warn: (message, ...meta) => writeLog('warn', prefix, message, meta),
        error: (message, ...meta) => writeLog('error', prefix, message, meta),
    };
}
