process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgres://mma:mma@localhost:5432/mma_guessr';
process.env.REDIS_URL ??= 'redis://:mma@localhost:6379';
// 密钥需 >=32 字节（env.ts requiredSecret 强制）, 且与开发默认值错开
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789abcdefghij';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789abcdefghij';
process.env.VERIFY_CODE_SECRET ??= 'test-verify-code-secret-0123456789abcdef';
