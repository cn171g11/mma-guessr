# mma-guessr-backend

MmaGuessr 后端服务：**Go（纯标准库）+ SQLite**，编译为单个无外部依赖的二进制。

> 架构决策、API 契约与兼容性约束见根目录 [p.md](../p.md) 与 [api.md](api.md)。

## 技术栈

- **HTTP**：Go 标准库 `net/http`（1.22+ 方法路由），无第三方 Web 框架
- **SQLite**：`modernc.org/sqlite`（纯 Go，无 CGO），WAL 模式，`busy_timeout=5000`、`foreign_keys=ON`
- **多人对战**：自研极简 Engine.IO v4（polling-only，`upgrades:[]`），与前端 socket.io 4.8.1 客户端字节兼容
- **无 Redis / 无 PostgreSQL**：缓存/限频/队列/房间 → 进程内内存 + SQLite 表
- **密码**：`golang.org/x/crypto/bcrypt`（12 轮）；**令牌**：`golang-jwt/jwt/v5`（HS256）

## 快速开始

```bash
cd backend

# 构建（单二进制）
go build -o mma-guessr ./cmd/server

# 启动（自动建表；首次启动后需 seed 题库）
PORT=3000 SQLITE_PATH=mma_guessr.db ./mma-guessr

# 导入题库（解析 frontend/src/js/data.js，幂等，1570 条）
go run ./cmd/seed -data ../frontend/src/js/data.js
```

服务启动后访问 http://localhost:3000/api/health 应返回 `{"status":"ok","checks":{"sqlite":"up"}}`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `go build ./...` | 编译全部包 |
| `go vet ./...` | 静态检查 |
| `go test ./...` | 全部单元测试 + e2e（内存 SQLite，无外部依赖） |
| `go test -race ./test/` | 竞态检测套件 |
| `go run ./cmd/server` | 启动开发服务 |
| `go run ./cmd/seed -data <data.js>` | 题库导入（幂等） |
| `go run ./cmd/rebuild-leaderboards` | 从 scores 表重建总榜与今日日榜缓存（迁移/恢复后使用） |
| `gofmt -l .` | 格式检查 |
| `go run github.com/securego/gosec/v2/cmd/gosec@latest ./...` | 安全扫描（0 问题） |

## 认证 API（`/api/auth`）

注册 / 登录 / 刷新令牌 / 登出 / 游客会话与绑定等接口的完整参考见 [api.md](api.md)。

- 注册/登录返回 `accessToken`（15 分钟）+ refresh 令牌（7 天，HttpOnly cookie `mma_refresh`，旋转作废）
- 游客返回 `guestToken`（30 天），后续请求同样放入 `Authorization: Bearer <token>`

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改（`.env` 已被 git 忽略），或直接导出为环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `NODE_ENV` | `development` | 运行环境；`production` 下缺失/默认密钥会被拒绝启动 |
| `SQLITE_PATH` | `mma_guessr.db` | SQLite 数据库文件路径 |
| `MAPILLARY_TOKEN` | — | Mapillary API 密钥（仅服务端持有） |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev 默认值 | JWT 签名密钥（生产必须为 ≥32 字节强随机值） |
| `VERIFY_CODE_SECRET` | dev 默认值 | 验证码 HMAC 哈希密钥（与令牌密钥隔离） |
| `API_SIGNING_SECRET` | dev 默认值 | 请求签名密钥（与前端 config.js 一致） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | — | 邮箱验证码 SMTP 配置；未配置时开发模式打印验证码到日志 |
| `CORS_ALLOWED_ORIGINS` | `localhost:3000` | 前端来源白名单（逗号分隔）；生产必须配置为前端实际域名 |
| `COOKIE_SAME_SITE` | `lax` | refresh cookie 的 SameSite（lax/strict/none） |
| `METRICS_TOKEN` | — | `/api/metrics` 的 Bearer 令牌；生产留空则端点拒绝访问 |
| `TRUST_PROXY` | `0` | 可信反代跳数（如 `1`）；启用后按真实客户端 IP 限频 |

## 目录结构

```
backend/
├── cmd/
│   ├── server/main.go              # 启动入口（HTTP + Engine.IO 挂载）
│   ├── seed/main.go                # 题库导入工具
│   └── rebuild-leaderboards/main.go  # 排行榜缓存重建工具
├── internal/
│   ├── auth/                       # 认证：密码、JWT、验证码、游客、刷新令牌
│   ├── games/                      # 成绩域：提交/查询/防伪校验/服务端计分
│   ├── leaderboard/                # 排行榜：scores 表 MAX() 聚合 + 每日 UTC 0 点自动重建
│   ├── achievements/               # 成就与称号（14 定义 + 解锁判定）
│   ├── daily/                      # 每日挑战：惰性抽题 + 每日一次
│   ├── profile/                    # 个人统计聚合
│   ├── multiplayer/                # 对战：Engine.IO v4 polling + 匹配队列 + 房间
│   ├── locations/                  # 题库：随机抽题池、统计缓存
│   ├── mapillary/                  # 图源代理：search 缓存 / 图片 SSRF 防护
│   ├── config/                     # 环境变量加载与校验
│   ├── db/                         # SQLite 打开 + 建表 schema（幂等迁移）
│   ├── kv/                         # SQLite 上的 TTL 缓存（替代 Redis）
│   ├── middleware/                 # 请求签名、鉴权、限频、安全头、CORS、错误处理
│   ├── server/                     # HTTP 路由（/api/*）
│   ├── httputil/                   # JSON/Cookie/错误响应辅助
│   ├── signature/                  # HMAC 请求签名 + nonce 防重放
│   ├── ratelimit/                  # 进程内滑动窗口限频
│   └── ...                         # logging / metrics / mail / util
├── test/                           # e2e 测试（httptest + 内存 SQLite）
├── Dockerfile                      # 生产镜像（多阶段，alpine 运行）
└── deploy/                         # 生产部署栈（docker-compose + Nginx + SQLite 备份）
```

## CI/CD

由 `.github/workflows/backend.yml` 与 `.github/workflows/release.yml` 驱动：

- push / PR 触发：`backend-checks.yml`（go vet + build + 全量测试 + race 套件）
- 手动 `mode=image`：构建并推送 GHCR 多架构镜像
- `release.yml`：质量门禁 → 跨平台二进制产物 → 前端 Pages 部署 → 镜像 + Release

本地验证与 CI 一致：

```bash
cd backend
go build ./...
go vet ./...
go test ./...
go test -race -timeout 300s ./test/
```
