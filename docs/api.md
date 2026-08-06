# API 参考（`/api`）

后端服务（Express 5），开发环境基址 `http://localhost:3000/api`。

## 通用约定

- 请求体为 JSON（`Content-Type: application/json`）
- 需要登录的接口使用请求头 `Authorization: Bearer <accessToken | guestToken>`
- 错误响应统一为 `{ "error": "<message>" }`；5xx 返回 `Internal Server Error`
- 校验失败返回 `400`；未认证/令牌失效返回 `401`；唯一性冲突返回 `409`

## 健康检查

### `GET /api/health`

探测 PostgreSQL 与 Redis 连通性。

```json
{ "status": "ok", "checks": { "postgres": "up", "redis": "up" }, "timestamp": "2026-08-06T00:00:00.000Z" }
```

全部连通返回 `200`；任一异常返回 `503` 且 `status: "degraded"`。

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

- 60 秒内同一邮箱不可重发（Redis 限频）
- 验证码 6 位数字，10 分钟有效，最多 5 次校验
- 邮箱已注册返回 `409`

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
- `password`：8-72 位（bcrypt 成本因子 10 存储）
- `code`：6 位数字验证码，校验后即作废
- `guestToken`：调用后会校验其为游客令牌并**迁移游客游戏进度**到新账号

成功返回 `201`：

```json
{
  "user": { "id": "uuid", "username": "player_01", "email": "player@example.com", "createdAt": "..." },
  "tokenPair": { "accessToken": "...", "refreshToken": "..." }
}
```

### `POST /api/auth/login`

```json
{ "identifier": "player@example.com", "password": "secret123" }
```

`identifier` 支持邮箱或用户名。同一账号连错 5 次锁 15 分钟（Redis 计数）。

成功返回 `200`，结构同注册（`user` + `tokenPair`）。

### `POST /api/auth/refresh`

```json
{ "refreshToken": "..." }
```

- 旋转式：换发新令牌对，旧 refresh 立即作废（Redis `refresh:<user_id>` 存储哈希）
- 提交已作废/不匹配的 refresh 视为复用攻击，会吊销该用户全部令牌

成功返回 `{ "accessToken": "...", "refreshToken": "..." }`。

### `POST /api/auth/logout`

需 Bearer 认证。可选提交 `refreshToken`；不提交也会强制吊销当前用户全部刷新令牌。

响应：`{ "message": "已注销" }`

### `POST /api/auth/guest`

无需任何参数，创建游客会话，返回 `201`：

```json
{ "guestId": "uuid", "guestToken": "...", "username": "游客_ab12" }
```

游客身份与游戏进度存 Redis，30 天过期；`guestToken` 即游客版 access token（同样 30 天有效）。

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

用户的 `progress` 与游客同构，均取自 Redis 进度快照（由成绩上报增量维护）。

## 游戏成绩（`/api/games`）

需 Bearer 认证（游客或注册用户）。提交走 Redis 滑动窗口限频（按身份，10 次/分钟）。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/` | 提交一局成绩 |
| GET | `/recent?limit=20` | 最近记录（1-30，默认 20） |
| GET | `/best?mode=classic` | 该模式最高分记录（无则 `null`） |
| GET | `/summary` | 累计进度快照（场次/总分/最佳/猜中轮数） |
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

## 排行榜（`/api/leaderboard`）

`GET /api/leaderboard`，需 Bearer 认证（用户/游客均可读取）。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `mode` | 否 | 默认 `classic`，支持全部模式（含 `daily`、`duel`） |
| `period` | 否 | `overall` 总榜 / `daily` 日榜，默认 `overall` |
| `limit` | 否 | 1-50，默认 20 |
| `date` | 否 | `daily` 期需 YYYY-MM-DD；缺省取当天（UTC） |

- 记为各玩家在 `scores` 表中的最高分（每人每个模式仅记一次最佳）
- 读 Redis 有序集合（`lb:overall:<mode>` / `lb:daily:<mode>:<日期>`），key 缺失时自动按数据库重建，夜间 UTC 零点例行重建
- 日榜/总榜均取个人最高分，故 `overall` 为累积性排名

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

- `played`：Redis 抢占（`user_daily:<id>:<date>`）已生效则为 `true`，表示当天已提交
- 题单失效（如重跑 seed 使自增 ID 漂移）时自愈重抽，不会返回空题单

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

随机抽取题目。题目 ID 池按参数维度缓存于 Redis（`locations:pool:<区域|all>:<难度|all>`），池 miss 时回源 PostgreSQL 重建，过期自动重建：

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `region` | 否 | 大洲：`asia` / `europe` / `northamerica` / `southamerica` / `africa` / `oceania` |
| `difficulty` | 否 | 1-5 |
| `count` | 否 | 1-20，默认 1 |

```json
{ "locations": [ { "id": 1001, "name": "日本东京·东京塔", "lat": 35.6586, "lng": 139.7454,
  "country": null, "city": null, "region": "asia", "difficulty": 1, "mapillaryId": null, "panoramaUrl": null } ] }
```

参数非法返回 `400`。

### `GET /api/locations/stats`

题库总量与各洲计数（Redis 缓存 5 分钟）：

```json
{ "total": 1570, "byRegion": { "asia": 527, "africa": 269, "europe": 188, "northamerica": 200, "oceania": 193, "southamerica": 193 } }
```

## Mapillary 代理（`/api/proxy/mapillary`）

服务端携带 `MAPILLARY_TOKEN` 请求 Mapillary，前端只与后端通信，**密钥永不下发**。两类接口均先过 Redis 滑动窗口限频（按 IP），再查 Redis 缓存，miss 时回源上游。

### `GET /api/proxy/mapillary/search`

按 bbox 搜索街景图片，返回与上游一致的 `{ data: [...] }` 结构（`id` / `geometry` / `is_pano`）。结果按 `bbox+limit` 缓存 24h。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `bbox` | 是 | `minLng,minLat,maxLng,maxLat`；格式非法返回 `400` |
| `limit` | 否 | 1-50，默认 20 |

### `GET /api/proxy/mapillary/image/:imageId`

代理返回图片字节流（`Content-Type: image/jpeg`），字节按 `imageId+width` 缓存 24h。

| 查询参数 | 必填 | 说明 |
| ---- | ---- | ---- |
| `width` | 否 | 1-2048，默认 1024；内部选择不小于该值的一档缩略图（256/1024/2048） |

限频超限返回 `429`；未配置 `MAPILLARY_TOKEN` 或上游异常返回 `503`/`502`。

## 令牌约定

| 令牌 | 签发对象 | 有效期 |
| ---- | ---- | ---- |
| `accessToken` | 注册用户 | 15 分钟 |
| `guestToken` | 游客 | 30 天 |
| `refreshToken` | 注册用户 | 7 天（Redis 存 SHA-256 哈希） |

JWT 载荷含 `sub`、`role`（`user` / `guest`）、`type`（access / refresh）与唯一 `jti`。

## 数据模型

- 用户表结构见 [database.md](database.md)
- 游客/缓存的 Redis 键设计见 [database.md](database.md)