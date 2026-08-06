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
{ "role": "user", "user": { "id": "...", "username": "...", "email": "...", "createdAt": "..." } }
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