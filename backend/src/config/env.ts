const DEFAULT_PORT = 3000;

function required(name: string, fallback: string): string {
    const value = process.env[name];
    if (value) {
        return value;
    }
    if (process.env.NODE_ENV === 'production') {
        throw new Error(`缺少环境变量：${name}`);
    }
    console.warn(`[env] 未设置 ${name}，使用开发默认值：${fallback}`);
    return fallback;
}
export const env = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? DEFAULT_PORT),

    DATABASE_URL: required('DATABASE_URL', 'postgres://mma:mma@localhost:5432/mma_guessr'),

    REDIS_URL: required('REDIS_URL', 'redis://localhost:6379'),

    MAPILLARY_TOKEN: process.env.MAPILLARY_TOKEN ?? '',
} as const;
