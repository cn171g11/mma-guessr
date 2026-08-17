# API 参考（`/api`）

后端服务（Go + SQLite，单二进制），开发环境基址 `http://localhost:3000/api`。

## 通用约定

- 请求体为 JSON（`Content-Type: application/json`）
- 需要登录的接口使用请求头 `Authorization: Bearer <accessToken | guestToken>`
- 错误响应统一为 `{ "error": "<message>" }`；5xx 返回 `Internal Server Error`
- 校验失败返回 `400`；未认证/令牌失效返回 `401`；唯一性冲突返回 `409`

## 健康检查

### `GET /api/health`

探测 SQLite 连通性。

```json
{ "status": "ok", "checks": { "sqlite": "up" }, "timestamp": "2026-08-06T00:00:00.000Z" }
```

全部正常返回 `200`；任一异常返回 `503` 且 `status: "degraded"`。

## 认证（`/api/auth`）

| 方法 | 路径 | 认证 | 说明 |
| ---- | ---- | ---- | ---- |
| POST | `/verification-code` | 否 | 发送邮箱验证码 |
| POST | `/register` | 否 | 注册（可选携带 `guestToken` 迁移游客数据） |
| POST | `/guest/bind` | 否 | 游客绑定注册（`guestToken` 必填） |
| POST | `/login` | 否 | 登录（邮箱或用户名 + 密码） |
| POST | `/refresh` | 否 | 刷新令牌对（旋转式，旧 refresh 作废） |
| POST | `/logout` | Bearer | 注销并吊销 refresh 令牌 |
| POST | `/guest` | 否 | 创建游客会话 |
| GET | `/me` | Bearer | 获取当前身份信息 |

### `POST /api/auth/verification-code`

```json
{ "email": "player@example.com" }
```

- 60 秒内同一邮箱不可重发（SQLite `verification_codes.last_sent_at`）
- 验证码 6 位数字，10 分钟有效，最多 5 次校验（仅存 HMAC-SHA256 哈希）
- 已注册与未注册邮箱均返回 `200`（防账号枚举）；注册阶段对已占用邮箱返回 `409`

响应：`{ "message": "验证码已发送" }`。SMTP 未配置时验证码打印到服务日志（开发模式）。

### `POST /api/auth/register` / `POST /api/auth/guest/bind`

```json
{
  "username": "player_01",
  "email": "player@example.com",
  "password": "secret123",
  "code": "123456",
  "guestToken": "..."   // 仅 register 可选；guest/bind 必填
}
```

- `username`：3-20 位字母、数字或下划线
- `password`：8-72 位（bcrypt 成本因子 12 存储）
- `code`：6 位数字验证码，校验后即作废
- `guestToken`：调用后会校验其为游客令牌并**迁移游客游戏进度**到新账号

成功返回 `201`：

```json
{
  "user": { "id": "uuid", "username": "player_01", "email": "player@example.com", "createdAt": "..." },
  "tokenPair": { "accessToken": "..." }
}
```

刷新令牌仅通过 HttpOnly Cookie `mma_refresh` 下发，绝不进入响应体。

### `POST /api/auth/login`

```json
{ "identifier": "player@example.com", "password": "secret123" }
```

`identifier` 支持邮箱或用户名。同一账号连错 5 次锁 15 分钟（进程内计数，恒时比较防时序枚举）。

成功返回 `200`，结构同注册（`user` + `tokenPair`）。

### `POST /api/auth/refresh`

```json
{ "refreshToken": "..." }
```

- 旋转式：换发新令牌对，旧 refresh 立即作废（SQLite `refresh_tokens` 仅存 SHA-256 哈希，事务内原子轮换）
- 已过期记录会被清除；提交已作废/不匹配的 token 返回 `401`（哈希不匹配不删除，避免并发旋转误伤）

成功返回 `{ "accessToken": "..." }`（新 refresh 经 Cookie 下发）。

### `POST /api/auth/logout`

需 Bearer 认证。可选提交 `refreshToken`；不提交也会强制吊销当前用户全部刷新令牌。

响应：`{ "message": "已注销" }`

### `POST /api/auth/guest`

无需任何参数，创建游客会话，返回 `201`：

```json
{ "guestId": "uuid", "guestToken": "...", "username": "游客_ab12" }
```

游客身份与游戏进度存 SQLite（`guest_sessions` / `guest_progress`），30 天过期；`guestToken` 即游客版 access token（同样 30 天有效）。

### `GET /api/auth/me`

需 Bearer。按身份返回：

```json
{ "role": "guest", "profile": { "guestId": "...", "username": "...", "createdAt": "..." },
  "progress": { "totalRounds": 0, "totalScore": 0, "bestScore": 0, "correctGuesses": 0 } }
```

```json
{ "role": "user", "user": { "id": "...", "username": "...", "email": "...", "createdAt": "..." },
  "progress": { "totalRounds": 0, "totalScore": 0, "bestScore": 0, "correctGuesses": 0 } }
```

用户的 `progress` 与游客同构，均取自 SQLite 进度快照（由成绩上报增量维护）。

## 游戏成绩（`/api/games`）

需 Bearer 认证（游客或注册用户）。提交走进程内滑动窗口限频（按身份，10 次/分钟）。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/` | 提交一局成绩 |
| GET | `/recent?limit=20` | 最近记录（1-30，默认 20） |
| GET | `/best?mode=classic` | 该模式最高分记录（无则 `null`） |
| GET | `/summary` | 累计进度快照（场次/总分/最佳/猜中轮数） |
| GET | `/:gameId` | 获取完整对局记录（含各轮坐标），用于轨迹回放 |
| DELETE | `/:gameId` | 删除自己的某条记录 |

### `POST /api/games`

```json
{
  "mode": "challenge",
  "region": null,
  "totalScore": 12000,
  "rounds": [
    {
      "name": "北京·天安门",
      "locationId": 42,
      "distanceKm": 2.5,
      "score": 4800,
      "imageId": "img-1",
      "xp": 0,
      "difficulty": 3,
      "guessLat": 39.9,
      "guessLng": 116.4,
      "answerLat": 39.9055,
      "answerLng": 116.3976
    }
  ]
}
```

- `mode`：`classic` / `challenge` / `region` / `china` / `endless` / `daily` / `duel`
- `region`：仅 `region` 模式必填；其他模式传了返回 `400`
- `daily` 模式：仅注册用户可提交、每天限一次（重复提交返回 `409`）；`duel` 模式由对战服务在对局结束时自动落库
- **服务端防伪校验**：每轮得分由服务端按 `distanceKm` 与模式/区域参数重算，提交的 `score` 与之不一致返回 `400`；携带 `guessLat/guessLng/answerLat/answerLng` 时还会核验距离与坐标自洽（不符返回 `400`）；`totalScore` 必须等于重算后的各轮得分之和
- `daily` 模式必须携带 `locationId`（属于今日题单）与 `answerLat/answerLng`，题目不属于今日题单或答案坐标偏离题目坐标超过阈值返回 `400`，且非法提交不会消耗当天次数
- 每轮 `score` 上限 5000；`distanceKm` 为 `null` 表示超时未提交
- 成功后进度快照增量累计：场次 += 轮数、总分 += totalScore、最佳取最高、猜中计为得分 > 0 的轮数

返回 `201`：

```json
{ "game": { "id": 1, "mode": "challenge", "region": null, "totalScore": 12000,
  "rounds": [ ... ], "createdAt": "..." } }
```

### `GET /api/games/best`

```json
{ "best": { "id": 3, "mode": "classic", "totalScore": 4800, "rounds": [ ... ], "createdAt": "..." } }
```

按 `mode` 取该玩家最高 `totalScore` 的一条记录；`endless` 模式的记录含各轮 `xp`，前端据此展示累计经验。

### `GET /api/games/summary`

```json
{ "progress": { "totalRounds": 12, "totalScore": 34500, "bestScore": 8900, "correctGuesses": 9 } }
```

### `GET /api/games/:gameId`

需 Bearer 认证，仅可读取自己的对局。返回完整记录（rounds 含 `guessLat/guessLng/answerLat/answerLng` 坐标），供前端地图回放：

```json
{ "game": { "id": 3, "mode": "classic", "region": null, "totalScore": 4800,
  "rounds": [ { "name": "北京·天安门", "distanceKm": 2.5, "score": 4800,
    "guessLat": 39.9, "guessLng": 116.4, "answerLat": 39.9055, "answerLng": 116.3976 } ],
  "createdAt": "..." } }
```

对局不存在或不属于当前玩家返回 `404`。

## 排行榜（`/api/leaderboard`）

`GET /api/leaderboard`，需 Bearer 认证（用户/游客均可读取）。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `mode` | 否 | 默认 `classic`，支持全部模式（含 `daily`、`duel`） |
| `period` | 否 | `overall` 总榜 / `daily` 日榜，默认 `overall` |
| `limit` | 否 | 1-50，默认 20 |
| `date` | 否 | `daily` 期需 YYYY-MM-DD；缺省取当天（UTC） |

- 记为各玩家在 `scores` 表中的最高分（每人每个模式仅记一次最佳）
- 读 SQLite 缓存表（`lb:overall:<mode>` / `lb:daily:<mode>:<日期>`），key 缺失时自动按 `scores` 表重建（仅对总榜 / 当天日榜触发；历史日榜缺键直接返回空榜），夜间 UTC 零点例行重建
- 日榜/总榜均取个人最高分，故 `overall` 为累积性排名；公开接口已按 IP 限频（120 次/分钟）

```json
{ "period": "overall", "mode": "classic", "date": null,
  "entries": [ { "id": 1, "username": "alice", "score": 4800 }, ... ] }
```

## 每日挑战（`/api/daily`）

### `GET /api/daily/today`

需 Bearer 认证。返回当天（UTC）题单；服务端惰性抽 10 题并入库，全天固定不变：

```json
{ "date": "2026-08-06", "played": false,
  "locations": [ { "id": 1001, "name": "日本东京·东京塔", "lat": 35.6586, "lng": 139.7454,
    "country": null, "city": null, "region": "asia", "difficulty": 1, "mapillaryId": null, "panoramaUrl": null } ] }
```

- `played`：`daily_submissions` 已存在记录（`user_daily:<id>:<date>` 抢占）则为 `true`，表示当天已提交
- 题单失效（如重跑 seed 使自增 ID 漂移）时自愈重抽，不会返回空题单

### `GET /api/daily/leaderboard`

需 Bearer 认证。返回今日（或指定日期）每日挑战得分榜，仅统计注册用户（`daily_submissions` → `game_results` → `users`），由服务端权威结算：

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `date` | 否 | YYYY-MM-DD，缺省取当天（UTC） |

```json
{ "date": "2026-08-17",
  "entries": [ { "username": "alice", "score": 42000 }, ... ] }
```

## 个人统计（`/api/profile`）

`GET /api/profile`，需 Bearer 认证。返回该玩家的多维度聚合统计（结果缓存 5 分钟，新成绩落库立即失效）。

```json
{ "username": "alice", "role": "user",
  "stats": { "totalGames": 12, "totalRounds": 60, "totalScore": 34500, "avgScore": 2875,
    "bestScore": 8900, "bestMode": "challenge", "correctGuesses": 48, "accuracy": 40.0,
    "byMode": { "classic": { "games": 4, "rounds": 4, "bestScore": 4800, "avgScore": 4100 } } } }
```

## 题库（`/api/locations`）

### `GET /api/locations/random`

随机抽取题目。题目 ID 池按参数维度缓存于 SQLite 缓存表（`locations:pool:<区域|all>:<难度|all>`），池 miss 时回源 `locations` 表重建，过期自动重建；抽中后用 crypto/rand 打乱去重：

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `region` | 否 | 大洲：`asia` / `europe` / `northamerica` / `southamerica` / `africa` / `oceania` |
| `difficulty` | 否 | 1-5 |
| `count` | 否 | 1-20，默认 1 |
| `source` | 否 | 图源：`mapillary`，默认 `mapillary` |

```json
{ "locations": [ { "id": 1001, "name": "日本东京·东京塔", "lat": 35.6586, "lng": 139.7454,
  "country": null, "city": null, "region": "asia", "difficulty": 1, "mapillaryId": null, "panoramaUrl": null } ] }
```

参数非法返回 `400`。

### `GET /api/locations/stats`

题库总量与各洲计数（SQLite 缓存表 5 分钟）：

```json
{ "total": 1570, "byRegion": { "asia": 527, "africa": 269, "europe": 188, "northamerica": 200, "oceania": 193, "southamerica": 193 } }
```

## Mapillary 代理（`/api/proxy/mapillary`）

服务端携带 `MAPILLARY_TOKEN` 请求 Mapillary，前端只与后端通信，**密钥永不下发**。两类接口均先过进程内滑动窗口限频（按 IP），再查 SQLite 缓存表，miss 时回源上游。

### `GET /api/proxy/mapillary/search`

按 bbox 搜索街景图片，返回与上游一致的 `{ data: [...] }` 结构（`id` / `geometry` / `is_pano` / `thumb_1024_url` / `thumb_2048_url`）。缩略图 URL 为公开 CDN 直链，前端可直接加载，无需再经后端代理取字节。结果按 `bbox+limit` 缓存 24h。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `bbox` | 是 | `minLng,minLat,maxLng,maxLat`；格式非法返回 `400` |
| `limit` | 否 | 1-50，默认 20 |

### `GET /api/proxy/mapillary/media/:imageId`

解析图片并返回公开 CDN 缩略图 URL（仅元数据，不下载字节），供浏览器直连 CDN，节省后端带宽与缓存存储。返回 `{ "url": "https://..." }`。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `width` | 否 | 1-2048，默认 1024；内部选择不小于该值的一档缩略图（256/1024/2048） |

### `GET /api/proxy/mapillary/image/:imageId`

代理返回图片字节流（`Content-Type: image/jpeg`），字节按 `imageId+width` 缓存 24h。**兜底路径**：CDN 直连失败或 URL 缺失时由前端回退使用。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `width` | 否 | 1-2048，默认 1024；内部选择不小于该值的一档缩略图（256/1024/2048） |

限频超限返回 `429`；未配置 `MAPILLARY_TOKEN` 或上游异常返回 `503`/`502`。

## 图源代理（`/api/proxy/imagery`）

图源无关代理，按上游实例化（当前仅 `mapillary`），鉴权/限频/缓存行为与 `/mapillary/*` 等价。

### `GET /api/proxy/imagery/:source/search`

按 bbox 搜索街景图片，结构同 `{ data: [...] }`。查询参数：`bbox`（必填，格式非法返回 `400`）、`limit`（1-50，默认 20）。未知 `source` 返回 `400`。

### `GET /api/proxy/imagery/:source/image/:imageId`

返回图片字节流（`Content-Type: image/jpeg`）。查询参数 `width` 同 `/mapillary/image/`。

## 成就（`/api/achievements`）

### `GET /api/achievements`

需 Bearer 认证。返回全部成就定义与当前用户解锁/装备状态，统计基于 `game_results` 聚合实时计算：

```json
{ "user": { "id": "uuid", "equippedTitle": "大师" },
  "achievements": [ { "code": "first_game", "name": "初出茅庐", "description": "...",
    "icon": "🏅", "hasTitle": true, "title": "新手", "unlocked": true } ] }
```

### `PUT /api/achievements/title` · `DELETE /api/achievements/title`

需 Bearer、仅注册用户。`PUT` 请求体 `{ "code": "mode_master" }`，仅可装备已解锁且声明称号的成就，否则 `400`；`DELETE` 清除装备。响应 `{ "equippedTitle": "..." }`。

### `GET /api/profile/collections`

需 Bearer 认证、仅注册用户。返回地点图鉴（按已答对地点聚合，含点亮数/作答次数/首次·末次时间）：

```json
{ "total": 12,
  "items": [ { "name": "北京·天安门", "count": 3, "firstSeen": "...", "lastSeen": "..." } ] }
```

## 好友（`/api/friends`）

需 Bearer 认证、仅注册用户。好友关系单向确认，请求支持按 `userId` 或 `username` 发起。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/` | 好友列表 |
| GET | `/requests` | 好友请求（`incoming` / `outgoing`） |
| POST | `/requests` | 发起请求，请求体 `{ "targetUserId"?: uuid, "targetUsername"?: string }` |
| POST | `/requests/:userId/accept` | 接受请求 |
| POST | `/requests/:userId/reject` | 拒绝请求 |
| DELETE | `/:userId` | 删除好友 |

```json
{ "friends": [ { "id": "uuid", "username": "alice" } ] }
{ "incoming": [ { "id": "uuid", "username": "alice" } ], "outgoing": [] }
```

## 天梯排位（`/api/ratings`）

需 Bearer 认证、仅注册用户。返回当前赛季个人天梯快照与天梯前 50：

```json
{ "rating": { "season": "2026-S1", "rating": 1250, "tier": 2, "tierName": "白银",
    "nextTier": "黄金", "gamesPlayed": 3, "wins": 2, "bestStreak": 3 },
  "leaderboard": [ { "id": "uuid", "username": "alice", "rating": 2500, "tier": 7,
    "tierName": "宗师", "wins": 88 }, ... ] }
```

- 段位：青铜/白银/黄金/铂金/钻石/大师/宗师（0、1100、1300、1500、1800、2100、2500 分段）
- 未参与过排位的用户返回初始快照（rating 1000、tier 1、青铜）；`nextTier` 在已达最高段位时省略
- 单机对局提交后 `ApplyGame` 按总分换算评分增量（满分 +25、零分 -25），对战结束 `RecordDuel` 刷新连胜；评分区间 [100, 3000]

## 赞助者（`/api/sponsors`）

`GET /api/sponsors` 公开只读，返回可见赞助名单（金额降序）：

```json
{ "sponsors": [ { "id": 1, "name": "神秘人", "note": "第一个赞助者",
    "amountCents": 10000, "visible": true, "createdAt": "..." } ] }
```

`POST /api/sponsors` / `DELETE /api/sponsors/:sponsorId` 需管理员令牌（`Authorization: Bearer <SPONSOR_ADMIN_TOKEN>`，常量时间比较；令牌未配置时写端点恒返回 403）。POST 请求体 `{ "name": "...", "note": "..." , "amountCents": 10000, "visible": true }`。

## 地点冷知识（`/api/locations/fact`）

`GET /api/locations/fact?name=北京·天安门`，公开只读。命中 curated 事实表返回其内容，否则按区域生成模板化介绍：

```json
{ "name": "北京·天安门", "fact": "..." }
```

## 第三方登录（`/api/oauth`）

可选项：未在服务端配置 OAuth 凭据时，`providers` 返回空数组，`authorize`/`callback` 返回 404，前端自动隐藏第三方登录按钮。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/providers` | 已配置的第三方提供方列表（普通签名 API 调用） |
| GET | `/authorize/:provider` | 浏览器整页跳转至提供方授权页（302；绕过请求签名，state 令牌防 CSRF/重放） |
| GET | `/callback/:provider` | 提供方回调：校验 state → 换取身份 → 绑定/登录账号 → 设置 HttpOnly 刷新 Cookie → 302 回前端 `/?oauth=success\|failed` |

```json
{ "providers": [ { "name": "google", "label": "Google" } ] }
```

- 环境变量：`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI`（须为 HTTPS 回调，本地开发可 `http://localhost`）与 `OAUTH_STATE_SECRET`
- state 令牌为 `HMAC-SHA256(provider:时间戳:随机 nonce)`，10 分钟 TTL、单次消费，同一令牌重放回调返回失败
- 回调后前端经 `?oauth=success` 触发会话恢复（HttpOnly 刷新 Cookie 自动带回首跳），失败仅提示不暴露细节

## 指标（`/api/metrics`）

### `GET /api/metrics`

Prometheus 文本暴露格式；请求需带 `Authorization: Bearer <METRICS_TOKEN>`（未配置该变量时接口整体返回 `503`）。指标含请求计数/延迟桶、`games_submitted`、`rest_host_up`（DB 探针）等。

## 令牌约定

| 令牌 | 签发对象 | 有效期 |
| ---- | ---- | ---- |
| `accessToken` | 注册用户 | 15 分钟 |
| `guestToken` | 游客 | 30 天 |
| `refreshToken` | 注册用户 | 7 天（SQLite 存 SHA-256 哈希） |

JWT 载荷含 `sub`、`role`（`user` / `guest`）、`type`（access / refresh）与唯一 `jti`。

## 数据模型

- 用户表结构见 [database.md](database.md)
- 游客/缓存的 SQLite 键设计见 [database.md](database.md)