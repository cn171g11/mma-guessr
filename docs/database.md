# 数据层：SQLite

后端数据层由 `internal/db/` 承载：`db.go`（打开连接）+ `schema.go`（建表，幂等迁移）。

## 连接与配置

- 连接串由环境变量 `SQLITE_PATH` 提供（默认 `mma_guessr.db`）
- 打开时固定 `_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)`
- 进程内 `SetMaxOpenConns(1)`（modernc 驱动单写者模式，串行化写入）
- 启动时执行 `Migrate()`：全部 `CREATE TABLE IF NOT EXISTS`，幂等安全

## 表结构

### `users`（账号体系核心）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `TEXT` | 主键（UUID） |
| `username` | `TEXT` | 非空，唯一 |
| `email` | `TEXT` | 非空，唯一 |
| `password_hash` | `TEXT` | 非空（bcrypt，成本 12） |
| `equipped_title` | `TEXT` | 可空（当前装备称号） |
| `created_at` / `updated_at` | `TEXT` | 非空（RFC3339 UTC） |

### `locations`（题库主表）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `INTEGER` | 主键自增 |
| `name` | `TEXT` | 非空，唯一（来自 data.js 的地点名） |
| `mapillary_id` | `TEXT` | 可空（街景 ID） |
| `lat` / `lng` | `REAL` | 非空 |
| `country` / `city` | `TEXT` | 可空 |
| `region` | `TEXT` | 非空（大洲） |
| `difficulty` | `INTEGER` | 非空，1-5 |
| `panorama_url` | `TEXT` | 可空 |
| `source` | `TEXT` | 非空，默认 `mapillary` |
| `created_at` / `updated_at` | `TEXT` | 非空 |

索引：`idx_locations_region_difficulty`、`idx_locations_source_region_difficulty`（随机抽题按 region/difficulty/source 过滤）。

#### 题库数据导入

`go run ./cmd/seed -data <frontend/src/js/data.js>` 解析 `LOCATIONS` 数组并批量 upsert
（按 `name` 唯一键，幂等）。当前 1570 条已与前端逐条比对一致（脚本校验通过）。

### `game_results`（游戏成绩表）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `INTEGER` | 主键自增 |
| `player_type` | `TEXT` | CHECK `guest` / `user` |
| `player_id` | `TEXT` | 游客 UUID 或用户 UUID |
| `mode` | `TEXT` | classic / challenge / region / china / endless / daily / duel / landmark |
| `region` | `TEXT` | 仅区域模式非空 |
| `total_score` | `INTEGER` | 非空 |
| `rounds` | `TEXT` | 回合明细 JSON（name / locationId / distanceKm / score / imageId / xp / difficulty / guessLat / guessLng / answerLat / answerLng） |
| `created_at` | `TEXT` | 非空 |

索引：`idx_game_results_player_created`（历史记录）、`idx_game_results_player_mode_score`（最佳成绩）、`idx_game_results_mode_created`（模式统计）。

### `scores`（排行榜计分表）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `INTEGER` | 主键自增 |
| `player_type` | `TEXT` | CHECK `guest` / `user` |
| `player_id` | `TEXT` | 游客 UUID 或用户 UUID |
| `mode` | `TEXT` | 非空 |
| `score` | `INTEGER` | 非负 CHECK |
| `created_at` | `TEXT` | 非空 |

仅记录"新最佳"：某玩家某模式成绩高于历史最高时才插入；排行榜按 `MAX(score) GROUP BY player_id` 聚合。

### `daily_challenges` / `daily_submissions`（每日挑战）

- `daily_challenges`：`date`（主键，UTC 日期）→ `location_ids`（10 题 ID 数组，JSON 文本）
- `daily_submissions`：`(player_id, date)` 联合主键 → 已提交的游戏 ID，实现"每人每天一次"

当天首次访问惰性抽题 `INSERT ... ON CONFLICT(date) DO UPDATE` 幂等写入。

### `achievements` / `user_achievements`（成就与称号）

| 表 | 说明 |
| --- | --- |
| `achievements` | 19 条静态定义（`code` 主键 / name / description / icon / has_title / title），启动时 `INSERT OR IGNORE` 种子 |
| `user_achievements` | 解锁记录 `(user_id, achievement_code)` 联合主键，级联删除 |

解锁依据 `game_results` 聚合（局数 / 轮数 / 总分 / 最佳 / 满分轮 / 模式覆盖 / 命中率 / 最佳连胜 / 最大连续答对 / 去重地区 / 每日满分局数），由 `/api/achievements` 读写。

### `friends`（好友关系）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `requester_id` | `TEXT` | 主键联合 → `users.id`，发起方 |
| `addressee_id` | `TEXT` | 主键联合 → `users.id`，接收方 |
| `status` | `TEXT` | CHECK `pending` / `accepted` / `rejected` |
| `created_at` / `updated_at` | `TEXT` | 非空 |

约束：`PRIMARY KEY(requester_id, addressee_id)`、`CHECK(requester_id != addressee_id)`，另建 `(addressee_id, status)` 索引。每个关系仅存一行：发起方写 `pending`，接收方接受置 `accepted`（双方互为好友），拒绝置 `rejected`（再次发起会重新打开为 `pending`）。

### `season_ratings`（天梯排位）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `user_id` | `TEXT` | 主键 → `users.id`（每赛季一行） |
| `season` | `TEXT` | 非空（如 `2026-S1`），与 `rating` 建 `(season, rating DESC)` 索引 |
| `rating` | `INTEGER` | 非空，初始 1000，区间 [100, 3000] |
| `tier` | `INTEGER` | 非空，1-7（青铜→宗师） |
| `games_played` / `wins` | `INTEGER` | 非负，累计对局数 / 胜场数 |
| `updated_at` | `TEXT` | 非空 |

单机对局 `ApplyGame`、对战 `RecordDuel`（平局不结算连胜）自动更新；历史赛季行保留但不参与榜单。

### `user_streaks`（用户连胜快照）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `user_id` | `TEXT` | 主键 → `users.id` |
| `current_streak` | `INTEGER` | 非负（当前连胜） |
| `best_streak` | `INTEGER` | 非负（历史最佳连胜） |
| `updated_at` | `TEXT` | 非空 |

多人对战结算时刷新：胜 +1、负清零、平局不变；`/api/ratings` 将 `best_streak` 联表返回。

### `location_facts`（地点冷知识）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `location_id` | `INTEGER` | 主键 → `locations.id`，级联删除 |
| `fact` | `TEXT` | 非空 |

启动时种子 10 条著名地点 curated 事实（`INSERT OR IGNORE`），未命中的地点由 `internal/facts` 按区域模板兜底生成，无需回源。

### `sponsors`（赞助者记录）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `id` | `INTEGER` | 主键自增 |
| `name` | `TEXT` | 非空 |
| `note` | `TEXT` | 可空 |
| `amount_cents` | `INTEGER` | 非负，默认 0（金额分，用于榜单排序） |
| `visible` | `INTEGER` | 默认 1（是否公开展示） |
| `created_at` | `TEXT` | 非空 |

写端点由 `SPONSOR_ADMIN_TOKEN`（`Authorization: Bearer`，常量时间比较）保护，读取仅返回 `visible = 1` 的行。

### `oauth_accounts`（第三方登录绑定）

| 列 | 类型 | 约束 |
| --- | --- | --- |
| `provider` | `TEXT` | 主键联合（如 `google`） |
| `provider_id` | `TEXT` | 主键联合（提供方用户 ID） |
| `user_id` | `TEXT` | 外键 → `users.id`，级联删除 |
| `created_at` | `TEXT` | 非空 |

另建 `(user_id)` 索引。首次第三方登录自动创建账号并写入绑定；`provider + provider_id` 唯一，实现跨会话稳定识别同一人。

### 会话与令牌（替代原 Redis 键）

| 表 | 说明 |
| --- | --- |
| `refresh_tokens` | `user_id` 主键 → `token_hash`（SHA-256，恒时比较）+ `expires_at`；旋转时事务原子作废 |
| `verification_codes` | `email` 主键 → `code_hash`（HMAC-SHA256）+ `attempts`（最多 5 次）+ `last_sent_at`（60s 重发）+ `expires_at`（10 分钟） |
| `guest_sessions` | 游客会话：`guest_id` 主键 + username + `expires_at`（30 天） |
| `guest_progress` / `user_progress` | 游客 / 用户进度快照（total_rounds / total_score / best_score / correct_guesses），绑定注册时合并迁移 |
| `nonces` | 请求签名防重放：`nonce` 主键 + `expires_at`（±5 分钟窗口内去重） |

## 缓存层（`internal/kv`，替代 Redis）

统一 TTL 缓存表 `mapillary_cache`（key 主键 / value / expires_at），提供 `Get/GetBytes/Set/SetBytes/Del/SetNX/Sweep/TTL`：

| 用途 | 键格式 | TTL |
| --- | --- | --- |
| 题库随机抽题池 | `locations:pool:<source\|all>:<region\|all>:<difficulty\|all>` | 1 小时 |
| 题库统计 | `locations:stats` | 5 分钟 |
| Mapillary 搜索代理缓存 | `mly:search:<bbox>:<limit>` | 24 小时 |
| Mapillary 单图元数据 | `mly:media:<image_id>` | 24 小时 |
| Mapillary 图片字节 | `mly:img:<image_id>:<width>` | 24 小时 |
| 个人统计聚合 | `profile:stats:<role>:<id>` | 5 分钟 |
| 排行榜读缓存 | `lb:overall:<mode>` / `lb:daily:<mode>:<date>` | 永续 / 7 天 |

> 限频（登录 5 次锁定、验证码重发、游戏提交 10/min、代理 30/60 per min、排行榜 120/min）全部在**进程内滑动窗口**（`internal/ratelimit`）实现，多实例部署时由反代按实例分流；多人队列/房间状态在进程内存（`internal/multiplayer`）。

## 数据流说明

- 游客绑定注册：校验 guest 令牌 → 建号 → `guest_progress` 合并到 `user_progress` → 清理游客会话
- 成绩上报：`POST /api/games` 先做防伪校验（`distanceKm` 与得分重算一致；daily 服务端权威结算），落库 `game_results` → 增量更新进度 → 新最佳写 `scores` → 注册用户触发成就判定
- 令牌旋转：refresh 仅存 SHA-256 哈希，换取时恒时比较，不匹配即整体吊销
- 随机抽题：先从缓存池取 ID 再 shuffle（crypto/rand），只回源查抽中的记录
- Mapillary 代理：服务端携带 `MAPILLARY_TOKEN` 请求上游，结果缓存到 `mapillary_cache`；每次上游调用前限频；图片 URL 经 SSRF 防护（仅 HTTPS + 拒绝私网/云元数据）
- 每日挑战：`GET /api/daily/today` 惰性抽题；提交时 `daily_submissions` 主键冲突返回 409
- 对战：进程内存队列双出队配对 → 房间状态（内存）→ 结束后按 `mode=duel` 落库 `game_results`，房间 2 小时后过期；私房（`mp:createPrivate`）生成 6 位房间码，等待房 10 分钟 TTL，按码加入
- 天梯：注册用户单机提交 `game_results` 后 `ratings.ApplyGame`（按总分换算评分增量），对战结束 `ratings.RecordDuel`（胜 +1 / 负清零 / 平局跳过）并刷新 `user_streaks`，`/api/ratings` 联表返回连胜快照
- 每日计分榜：`daily.Leaderboard` 实时聚合 `daily_submissions` → `game_results` → `users`（当日得分降序）
- 好友：发起请求落 `friends(status=pending)` 一行，接受方接受后置 `accepted`，双方各自可见

## 本地开发环境

```bash
cd backend
go run ./cmd/seed -data ../frontend/src/js/data.js   # 首次初始化题库（可选，开发期）
go run ./cmd/server                                   # 启动（自动建表）
```
