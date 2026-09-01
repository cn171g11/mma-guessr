---
name: mmaguessr-backend
description: MmaGuessr Go 后端开发与验证。质量门禁全套（build/vet/test/race/gofmt/gosec）、cmd 命令速查（server/seed/rebuild-leaderboards）、环境变量清单、internal 包职责速查、Docker/systemd/Nginx 部署。用户说"改后端/Go/API/跑测试/导入题库/部署后端"时使用。
agent_created: true
---

# MmaGuessr 后端（Go）开发验证

## 技术栈事实

| 项 | 实际情况 |
|---|---|
| 模块名 | `mma-guessr/backend`，Go **1.26.6** |
| HTTP | Go 标准库 `net/http` 1.22+ 方法路由，**无 web 框架** |
| 数据库 | SQLite（`modernc.org/sqlite`，纯 Go 无 CGO），WAL 模式 |
| 实时通信 | 自实现的最小 Engine.IO v4（**仅 polling**），无第三方 socket 库 |
| 前端契约 | 静态站 + Socket.IO 4.8.1 客户端，事件形状必须保持字节兼容 |
| 缓存/限流 | 进程内存或 SQLite，**不用 Redis / PostgreSQL** |

## 质量门禁（收尾前必跑，与 CI 完全一致）

```bash
cd E:/Desktop/geoguesser/backend

go build ./...                          # 编译全部包
go vet ./...                            # 静态检查
go test ./...                           # 单元测试 + 全量 e2e

go test -race -timeout 300s ./test/     # 竞态检测套件
gofmt -l .                              # 列出未格式化的文件（应为空）
```

一条命令跑完整套：

```bash
go build ./... && go vet ./... && go test ./...
```

`go test ./...` 是**全量 e2e**，用 `httptest` + 内存 SQLite，不依赖外部服务，可直接跑。

可选安全扫描：

```bash
go run github.com/securego/gosec/v2/cmd/gosec@latest ./...
# 关注 G101(硬编码凭证) / G115(整数溢出) / G124 / G202(命令注入) / G404(弱随机) / G705
```

## 命令速查

| 命令 | 说明 |
|---|---|
| `go run ./cmd/server` | 启动开发服务，自动建表 + 幂等迁移 + 成就种子，**无需单独 migrate 步骤** |
| `go run ./cmd/seed -data <data.js>` | 导入题库，按 `name` 幂等 upsert，默认读 `../frontend/src/js/data.js` |
| `go run ./cmd/rebuild-leaderboards` | 重建每日榜单 |
| `go build -o mma-guessr ./cmd/server` | 产出单二进制 |

```bash
# 构建并启动
go build -o mma-guessr ./cmd/server
PORT=3000 SQLITE_PATH=mma_guessr.db ./mma-guessr

# 冒烟验证
curl -s http://localhost:3000/api/health
```

`cmd/seed` **不执行 JS**，只解析 `frontend/src/js/data.js` 的 `LOCATIONS` 数组字面量
（括号配对 + 字符串感知）。改动 data.js 后需重跑 seed 才能同步到 `/api/locations/random`。

## 环境变量

模板见 `backend/.env.example`，生产实际在服务器 `/etc/mma-guessr/mma-guessr.env`：

| 分类 | 变量 |
|---|---|
| 服务 | `PORT`、`NODE_ENV`、`GOGC`、`TRUST_PROXY` |
| 数据库 | `SQLITE_PATH` |
| 签名/密钥 | `API_SIGNING_SECRET`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET`、`EMAIL_HASH_SECRET`、`OAUTH_STATE_SECRET`、`VERIFY_CODE_SECRET` |
| CORS/Cookie | `CORS_ALLOWED_ORIGINS`、`COOKIE_SAME_SITE` |
| 第三方 | `MAPILLARY_TOKEN`、`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` |
| 邮件 | `SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `SMTP_FROM` |
| 运维 | `METRICS_TOKEN`、`SPONSOR_ADMIN_TOKEN` |

> 🔒 **前端签名密钥必须一致**：`frontend/src/js/config.js` 的 `API_SIGNING_SECRET`
> 必须与后端 `API_SIGNING_SECRET` 值相同。前端是静态站，该值最终公开，
> 仅作基础完整性/防重放校验，**不承担身份认证**。更换服务端密钥时须同步改前端并重新发布。
> 本 skill 不保存任何密钥明文。

## `internal/` 包职责速查

| 包 | 职责 |
|---|---|
| `auth` `oauth` | 认证、JWT、Google OAuth |
| `multiplayer` | 多人房间（自实现 Engine.IO polling） |
| `games` | 对局逻辑、8 种模式 |
| `locations` | 题库读取、随机抽题、洗牌袋 |
| `packs` | 图包（workshop） |
| `leaderboard` `ratings` | 排行榜、评分 |
| `daily` `achievements` | 每日挑战、成就 |
| `social` `profile` | 社交、用户资料 |
| `mapillary` | Mapillary API 代理（含 SSRF 防护） |
| `metrics` | PV/UV/轮次统计 |
| `ratelimit` `middleware` | 限频、通用中间件 |
| `signature` | 请求签名校验（HMAC + nonce 去重） |
| `mail` | 邮件发送 |
| `kv` `db` `config` `logging` `httputil` `util` `facts` | 基础设施层 |

`server` 包负责路由注册与装配；入口在 `cmd/server`。

## 测试分布

- 单元测试：`internal/` 下 8 个 `_test.go`（auth/token、db/maintenance、httputil、leaderboard、middleware/rate_limit、oauth、packs、ratings）
- e2e：`test/` 下 10 个（auth、features、games、multiplayer、oauth、packs、private_room、proxy、social + helpers）

## 部署

| 方式 | 文件 |
|---|---|
| Docker | `backend/Dockerfile` + `deploy/docker-compose.prod.yml`（多架构镜像推 GHCR） |
| systemd | `deploy/systemd/mma-guessr.service` |
| Nginx 反代 | `deploy/nginx/nginx.conf`（同源部署时前端 `API_BASE` 留空） |
| DB 备份 | `deploy/scripts/backup-sqlite.sh` |

CI：`push backend/**` → `backend.yml`（`quality` 复用 `backend-checks.yml` + 构建推送 GHCR 镜像）。

## ⚠️ 已知陷阱

1. **改了 data.js 忘记 seed** —— 网页端题库新了，`/api/locations/random` 还是旧的
2. **`go test ./...` 很慢** —— 它是全量 e2e，不是快速单测；只想快速验证可用
   `go test ./internal/...` 或指定包
3. **前后端签名密钥不同步** —— 改了服务端 `API_SIGNING_SECRET` 却没改
   `frontend/src/js/config.js`，所有签名请求会 401
4. **引入 web 框架** —— 项目刻意只用标准库，不要引入 gin/echo/chi
5. **改用第三方 socket 库** —— Engine.IO 是自实现的，事件契约与 Socket.IO 4.8.1
   客户端字节兼容，替换会破坏前端
6. **Redis/PostgreSQL** —— 明确不用，缓存和限流放内存或 SQLite
7. **前端改了但 backend 路径没触发部署** —— `deploy.yml` 的 `paths-ignore` 排除了 `backend/**`

## 校验清单

- [ ] `go build ./...` 通过
- [ ] `go vet ./...` 无告警
- [ ] `go test ./...` 全绿
- [ ] `gofmt -l .` 输出为空
- [ ] 若改了题库，已跑 `go run ./cmd/seed`
- [ ] 若改了签名配置，前端 `config.js` 的值已同步
- [ ] 新增环境变量已补进 `.env.example` 和 `docs/backend.md`

## 相关文档

| 文件 | 说明 |
|---|---|
| `docs/scripts.md` | 运维命令（Go） |
| `docs/backend.md` | 后端架构 |
| `docs/api.md` | API 契约 |
| `docs/database.md` | 数据库结构 |
| `docs/deploy.md` | 部署说明（含密钥配置） |
| `backend/.env.example` | 环境变量模板 |
