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
