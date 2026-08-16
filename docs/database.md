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
| `achievements` | 14 条静态定义（`code` 主键 / name / description / icon / has_title / title），启动时 `INSERT OR IGNORE` 种子 |
| `user_achievements` | 解锁记录 `(user_id, achievement_code)` 联合主键，级联删除 |

解锁依据 `game_results` 聚合（局数 / 轮数 / 总分 / 最佳 / 满分轮 / 模式覆盖 / 命中率），由 `/api/achievements` 读写。

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
- 对战：进程内存队列双出队配对 → 房间状态（内存）→ 结束后按 `mode=duel` 落库 `game_results`，房间 2 小时后过期

## 本地开发环境

```bash
cd backend
go run ./cmd/seed -data ../frontend/src/js/data.js   # 首次初始化题库（可选，开发期）
go run ./cmd/server                                   # 启动（自动建表）
```
