process.env.NODE_ENV = 'development';
process.env.DATABASE_URL ??= 'postgres://mma:mma@localhost:5432/mma_guessr';
process.env.REDIS_URL ??= 'redis://:mma@localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
