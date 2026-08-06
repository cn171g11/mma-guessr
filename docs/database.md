# 数据层：PostgreSQL 与 Redis

后端数据层由 [backend.md](backend.md) 中的 `src/db/` 模块承载：`pool.ts`（连接池）、`redis.ts`（客户端）、`migrate.ts`（迁移执行器）。

## PostgreSQL

连接串由环境变量 `DATABASE_URL` 提供（开发默认 `postgres://mma:mma@localhost:5432/mma_guessr`）。

### 迁移

- 迁移文件位于 `backend/src/db/migrations/`（`*.sql`），按序号执行
- 执行器：`npm run db:migrate`（`tsx src/db/migrate.ts`）
- 迁移幂等：均使用 `IF NOT EXISTS`

### 表结构

#### `users`（账号体系核心）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `UUID` | 主键，默认 `gen_random_uuid()` |
| `username` | `VARCHAR(20)` | 非空，唯一索引 |
| `email` | `VARCHAR(255)` | 非空，唯一索引 |
| `password_hash` | `VARCHAR(60)` | 非空（bcrypt，成本因子 10） |
| `created_at` | `TIMESTAMPTZ` | 默认 `now()` |
| `updated_at` | `TIMESTAMPTZ` | 默认 `now()` |

后续规划（来自 `docs/p.md` 任务清单，尚未实现）：

- `locations`：题库表（`mapillary_id` / `lat` / `lng` / `country` / `city` / `difficulty` / `panorama_url`），需要时启用 PostGIS `geography(POINT)` 做邻近查询
- `game_results`、`scores`、`daily_challenges`、`user_achievements`：在线玩法相关表

## Redis

连接串来自环境变量 `REDIS_URL`（开发默认 `redis://localhost:6379`）。

### 键设计

| 键 | 类型 | TTL | 说明 |
| --- | --- | --- | --- |
| `refresh:<user_id>` | string | 7 天 | 当前有效 refresh 令牌的 SHA-256 哈希（旋转式令牌） |
| `verify_code:<email>` | string | 10 分钟 | 邮箱验证码（最多 5 次校验） |
| `verify_rate:<email>` | string | 60 秒 | 验证码重发限频 |
| `login_lock:<identifier>` | counter | 15 分钟 | 登录失败计数，达到 5 次锁定 |
| `guest:<guest_id>` | hash | 30 天 | 游客档案（username / createdAt） |
| `guest_progress:<guest_id>` | hash | 30 天 | 游客游戏进度快照 |
| `user_progress:<user_id>` | hash | 30 天 | 注册用户游戏进度快照 |

### 数据流说明

- 游客绑定注册：校验 guest 令牌 → 建号 → 把 `guest_progress` 合并（累加场次/得分、取最高分）到 `user_progress` → 清理游客键
- 令牌旋转：refresh 以哈希形式仅存 Redis，换取时与提交值做恒时比较（`timingSafeEqual`），不匹配即整体吊销

## 本地开发环境

```bash
cd backend
npm run db:up          # docker compose 启动 PostgreSQL + Redis
npm run db:migrate     # 迁移建表
```

开发容器配置见 `backend/docker-compose.yml`（PostgreSQL 16 + Redis 7）。