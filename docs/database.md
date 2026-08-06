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

#### `locations`（题库主表）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 |
| `name` | `VARCHAR(120)` | 非空，唯一索引（来自 data.js 的地点名） |
| `mapillary_id` | `TEXT` | 可空（后续逐点绑定街景 ID） |
| `lat` / `lng` | `DOUBLE PRECISION` | 非空，范围 CHECK |
| `country` / `city` | `VARCHAR(120)` | 可空（后续数据丰富时填充） |
| `region` | `VARCHAR(20)` | 非空（大洲） |
| `difficulty` | `SMALLINT` | 非空，CHECK 1-5 |
| `panorama_url` | `TEXT` | 可空 |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | 默认 `now()` |

索引：`locations_name_key`（唯一）、`locations_region_difficulty_idx`。

> **PostGIS（可选）**：迁移会检测 `postgis` 扩展是否已启用；若已启用，自动为表补充生成列
> `location geography(POINT, 4326)`（由 `lng/lat` 生成）与 GIST 索引，可直接用 `ST_DWithin` 做
> 「附近位置」查询。默认开发容器（`postgres:16-alpine`）不含 PostGIS，基础功能不受影响。

#### 题库数据导入

`npm run db:seed`（`scripts/seed-locations.mjs`）解析 `frontend/src/js/data.js` 的 `LOCATIONS`
并批量 upsert（按 `name` 唯一键，幂等）。当前 1570 条（中国 332 / 世界 1238）已与前端逐条比对一致。

#### `game_results`（游戏成绩表）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 |
| `player_type` | `VARCHAR(5)` | CHECK `guest` / `user` |
| `player_id` | `VARCHAR(64)` | 游客 UUID 或用户 UUID |
| `mode` | `VARCHAR(20)` | classic / challenge / region / china / endless / daily / duel |
| `region` | `VARCHAR(20)` | 仅区域模式非空 |
| `total_score` | `INT` | 非空 |
| `rounds` | `JSONB` | 回合明细（name / distanceKm / score / imageId / xp / difficulty） |
| `created_at` | `TIMESTAMPTZ` | 默认 `now()` |

索引：`game_results_player_created_idx`（玩家 + 时间倒序，历史记录）、
`game_results_player_mode_score_idx`（玩家 + 模式 + 分数，最佳成绩）。
不建外键：游客记录随会话过期清理，注册用户删除无需级联。

#### `scores`（排行榜计分表，迁移 004）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `BIGSERIAL` | 主键 |
| `player_type` | `VARCHAR(5)` | CHECK `guest` / `user` |
| `player_id` | `VARCHAR(64)` | 游客 UUID 或用户 UUID |
| `mode` | `VARCHAR(20)` | 非空 |
| `score` | `INT` | 非负，CHECK `>= 0` |
| `created_at` | `TIMESTAMPTZ` | 默认 `now()` |

索引：`scores_user_created_idx`（玩家 + 时间）、`scores_mode_created_idx`（模式 + 时间）。
仅记录“新最佳”：某玩家某模式的成绩高于历史最高时才插入，排行榜读取时按 `MAX(score)` 聚合，天然每人每模式只占一行。

#### `daily_challenges`（每日挑战题单，迁移 004）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `date` | `DATE` | 主键（UTC 日期） |
| `location_ids` | `BIGINT[]` | 当天 10 题的地点 ID 数组 |
| `created_at` | `TIMESTAMPTZ` | 默认 `now()` |

当天首次访问时惰性抽题 `ON CONFLICT (date) DO UPDATE` 幂等写入；检测到题单失效（seed 重建致 ID 漂移）时自愈重抽。

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
| `locations:pool:<region\|all>:<difficulty\|all>` | set | 1 小时 | 题库随机抽题 ID 池（空池 60s），miss 时从 PG 重建 |
| `locations:stats` | string | 5 分钟 | 题库总量 / 各洲计数统计 |
| `mly:search:<bbox>:<limit>` | string | 24 小时 | Mapillary 图片搜索代理结果缓存 |
| `mly:media:<image_id>` | string | 24 小时 | Mapillary 单图元数据（缩略图 URL）缓存 |
| `mly:img:<image_id>:<width>` | bytes | 24 小时 | 代理返回的图片字节缓存 |
| `rl:mapillary-search:<ip>` | zset | 60 秒 | 搜索代理滑动窗口限频计数 |
| `rl:mapillary-image:<ip>` | zset | 60 秒 | 图片代理滑动窗口限频计数 |
| `rl:games-submit:<role>:<id>` | zset | 60 秒 | 成绩提交滑动窗口限频计数 |
| `lb:overall:<mode>` | zset | 永续 | 各模式总榜（成员 = 玩家 ID，分数 = 最高分） |
| `lb:daily:<mode>:<yyyymmdd>` | zset | 7 天 | 各模式日榜（当日最高分，过期键由夜间重建任务清理） |
| `user_daily:<player_id>:<date>` | string | 至次日 UTC 零点 | 每日挑战已提交标记（SET NX 抢占，冲突返回 409） |
| `profile:stats:<role>:<id>` | string | 5 分钟 | 个人统计聚合缓存，成绩落库后立即失效 |
| `mp:queue` | list | 永续 | 对战匹配队列（RPopLPush 出队匹配） |
| `mp:room:<room_id>` | hash | 2 小时 | 对局房间状态（模式/回合/双方状态/题目/历史） |

### 数据流说明

- 游客绑定注册：校验 guest 令牌 → 建号 → 把 `guest_progress` 合并（累加场次/得分、取最高分）到 `user_progress` → 清理游客键
- 成绩上报：`POST /api/games` 先落库 `game_results`，再对当前身份（guest/user）的进度哈希增量累计（`HINCRBY` 场次/总分/猜中轮数、`HSET` 最佳），进度快照由 `/me` 与 `/api/games/summary` 直接读取；同时校验该成绩是否为某模式新最佳，是则写入 `scores` 并更新排行榜 zset（`ZADD GT`，仅提升不降低），并使个人统计缓存失效
- 令牌旋转：refresh 以哈希形式仅存 Redis，换取时与提交值做恒时比较（`timingSafeEqual`），不匹配即整体吊销
- 随机抽题：`GET /api/locations/random` 先从 Redis 池 `SRANDMEMBER` 取 ID（池 miss 时才按区域/难度查 PG 重建），只对抽中的 ID 回源查全量记录，避免每次抽题压数据库
- Mapillary 代理：`/api/proxy/mapillary/*` 服务端携带 `MAPILLARY_TOKEN` 请求上游，结果缓存到 Redis（搜索/媒体 URL/图片字节，TTL 24h）；每次上游调用前经滑动窗口限频（按 IP 计数）
- 排行榜：数据源是 `scores` 表（`MAX(score) GROUP BY player_id`）；zset 仅作读缓存，每日 UTC 零点重建 + 清理 7 天前的日榜键，key 丢失时按需懒重建
- 每日挑战：`GET /api/daily/today` 惰性抽题写入 `daily_challenges`；提交成绩时以 `user_daily` 键 SET NX 抢占（TTL 至 UTC 零点），抢不到返回 409，实现“每人每天一次”
- 对战：`mp:queue` 列表双出队配对 → `mp:room:<id>` 哈希保存房间状态（回合/双方答案/总分）→ 结束自动落库 `game_results`（mode=duel），房间 2 小时后过期

## 本地开发环境

```bash
cd backend
npm run db:up          # docker compose 启动 PostgreSQL + Redis
npm run db:migrate     # 迁移建表
```

开发容器配置见 `backend/docker-compose.yml`（PostgreSQL 16 + Redis 7）。