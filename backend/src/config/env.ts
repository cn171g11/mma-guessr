const DEFAULT_PORT = 3000;

// 应用级常量（业务配置，独立于环境变量）
export const APP_CONSTANTS = {
    // 服务版本（与前端 config.js VERSION 同步）
    SERVICE_VERSION: '1.18.0',
    // 慢查询阈值：超过该毫秒数的 SQL 记录 warn 日志
    SLOW_QUERY_THRESHOLD_MS: 500,
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
    // 排行榜
    LEADERBOARD_MAX_LIMIT: 50,
    LEADERBOARD_DEFAULT_LIMIT: 20,
    LEADERBOARD_DAILY_RETENTION_DAYS: 7,
    // 每日挑战
    DAILY_CHALLENGE_ROUNDS: 10,
    // 用户资料统计
    PROFILE_STATS_TTL_SECONDS: 5 * 60,
    // 多人对战
    MP_TOTAL_ROUNDS: 5,
    MP_ROUND_SECONDS: 60,
    MP_MATCHMAKER_TICK_MS: 1500,
    MP_ROOM_TTL_SECONDS: 2 * 60 * 60,
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

// 反向代理跳数：仅当部署在可信反代（nginx/caddy 等）之后时显式设置（如 1）。
// 启用后 Express 信任 X-Forwarded-For 计算 req.ip，按 IP 限频（登录/验证码/代理）才能按真实客户端隔离；
// 未设置（默认）时按回环/直连场景处理，防止端口直连时伪造 XFF 头绕过限频
function optionalTrustProxyHops(name: string): number | undefined {
    const value = process.env[name];
    if (value === undefined || value === '') {
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`环境变量 ${name} 必须为正整数（反向代理跳数）`);
    }
    return parsed;
}

export const env = {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number(process.env.PORT ?? DEFAULT_PORT),

    DATABASE_URL: required('DATABASE_URL', 'postgres://mma:mma@localhost:5432/mma_guessr'),

    REDIS_URL: required('REDIS_URL', 'redis://:mma@localhost:6379'),

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

    // CORS 白名单（逗号分隔）。未配置时（开发默认）仅放行 localhost/127.0.0.1；
    // 生产环境必须显式配置为前端域名，否则同源校验会拒绝浏览器请求
    CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',

    // 刷新令牌 Cookie 的 SameSite 策略。前端与 API 同站（如 app.example.com 与 api.example.com）
    // 使用默认 lax；跨站部署（不同顶级域）须在 HTTPS 上设为 none
    COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE ?? 'lax',

    // 指标端点认证令牌：设置后 /api/metrics 需携带 Bearer 令牌；生产环境建议必设
    METRICS_TOKEN: process.env.METRICS_TOKEN ?? '',

    // Express trust proxy 跳数：仅在可信反向代理之后显式设置（如 1），详见 optionalTrustProxyHops
    TRUST_PROXY: optionalTrustProxyHops('TRUST_PROXY'),
} as const;
