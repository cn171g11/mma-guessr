const DEFAULT_PORT = 3000;

// 应用级常量（业务配置，独立于环境变量）
export const APP_CONSTANTS = {
    // 加解密与令牌
    BCRYPT_ROUNDS: 10,
    ACCESS_TTL_SECONDS: 15 * 60,
    REFRESH_TTL_SECONDS: 7 * 24 * 60 * 60,
    // 邮箱验证码
    VERIFY_CODE_TTL_SECONDS: 10 * 60,
    VERIFY_CODE_MAX_ATTEMPTS: 5,
    VERIFY_CODE_RESEND_SECONDS: 60,
    // 登录防爆破
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_LOCK_SECONDS: 15 * 60,
    // 游客会话
    GUEST_TTL_SECONDS: 30 * 24 * 60 * 60,
    // 题库随机抽取缓存（locations）
    LOCATION_POOL_TTL_SECONDS: 60 * 60,
    LOCATION_POOL_EMPTY_TTL_SECONDS: 60,
    LOCATION_STATS_TTL_SECONDS: 5 * 60,
    LOCATION_RANDOM_MAX_COUNT: 20,
    // Mapillary 代理（服务端密钥，永不下发前端）
    MAPILLARY_TIMEOUT_MS: 10_000,
    MAPILLARY_SEARCH_TTL_SECONDS: 24 * 60 * 60,
    MAPILLARY_MEDIA_TTL_SECONDS: 24 * 60 * 60,
    MAPILLARY_IMAGE_TTL_SECONDS: 24 * 60 * 60,
    MAPILLARY_MAX_IMAGE_BYTES: 1_048_576,
    MAPILLARY_MAX_SEARCH_LIMIT: 50,
    MAPILLARY_DEFAULT_IMAGE_WIDTH: 1024,
    MAPILLARY_MAX_IMAGE_WIDTH: 2048,
    // Mapillary 代理限频（Redis 滑动窗口，按 IP）
    MAPILLARY_RATE_WINDOW_MS: 60 * 1000,
    MAPILLARY_RATE_SEARCH_MAX: 30,
    MAPILLARY_RATE_IMAGE_MAX: 60,
    // 游戏成绩提交
    GAMES_RATE_WINDOW_MS: 60 * 1000,
    GAMES_RATE_SUBMIT_MAX: 10,
    GAMES_RECENT_MAX_LIMIT: 30,
    GAMES_RECENT_DEFAULT_LIMIT: 20,
    MAX_ROUND_SCORE: 5000,
    MAX_TOTAL_SCORE: 1_000_000,
    MAX_ROUNDS_PER_GAME: 100,
} as const;

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

function optionalNumber(name: string, fallback: number): number {
    const value = process.env[name];
    if (value === undefined || value === '') {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`环境变量 ${name} 必须为数字`);
    }
    return parsed;
}

export const env = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? DEFAULT_PORT),

    DATABASE_URL: required('DATABASE_URL', 'postgres://mma:mma@localhost:5432/mma_guessr'),

    REDIS_URL: required('REDIS_URL', 'redis://localhost:6379'),

    MAPILLARY_TOKEN: process.env.MAPILLARY_TOKEN ?? '',

    // 认证
    JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),

    // 邮件（SMTP）
    SMTP_HOST: process.env.SMTP_HOST ?? '',
    SMTP_PORT: optionalNumber('SMTP_PORT', 465),
    SMTP_USER: process.env.SMTP_USER ?? '',
    SMTP_PASS: process.env.SMTP_PASS ?? '',
    SMTP_FROM: process.env.SMTP_FROM ?? '',
} as const;
