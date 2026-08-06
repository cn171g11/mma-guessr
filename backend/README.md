# mma-guessr-backend

MmaGuessr 后端服务：Node.js + Express + TypeScript + PostgreSQL + Redis。

## 快速开始

```bash
cd backend

# 1. 拉起开发环境依赖（PostgreSQL + Redis）
npm run db:up

# 2. 安装依赖
npm install

# 3. 初始化数据库表结构（users 等）
npm run db:migrate

# 4. 启动开发服务（tsx watch，自动重启）
npm run dev
```

服务启动后访问 http://localhost:3000/api/health 可查看 PostgreSQL / Redis 连通状态。

## 常用命令

| 命令                 | 说明                                        |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | 开发模式（tsx watch 热重载）                |
| `npm run build`      | 编译到 `dist/`                              |
| `npm run start`      | 运行编译产物                                |
| `npm run typecheck`  | TypeScript 类型检查                         |
| `npm run lint`       | ESLint 检查                                 |
| `npm run format`     | Prettier 格式化                             |
| `npm run db:up`      | 启动 PostgreSQL + Redis 容器                |
| `npm run db:down`    | 停止容器                                    |
| `npm run db:migrate` | 执行数据库迁移（`src/db/migrations/*.sql`） |
| `npm test`           | 端到端测试（需要 PG + Redis 可用）          |
| `npm run test:watch` | 测试监听模式                                |
| `npm run script:*`   | 运维脚本（见 `scripts/README.md`）          |

## 测试

`npm test`（Vitest + supertest）直接对 Express 应用发起真实请求，覆盖认证全流程：

注册/登录 / 验证码限频与错误 / 刷新令牌旋转与复用吊销 / 登出 / 登录防爆破 / 游客会话与绑定注册迁移。

- 测试以开发模式运行：`DATABASE_URL` 默认 `postgres://mma:mma@localhost:5432/mma_guessr`，`REDIS_URL` 默认 `redis://localhost:6379`
- 执行前请先 `npm run db:up`（或使用任意可用的 PG + Redis），并运行一次 `npm run db:migrate` 建表
- SMTP 未配置时验证码会打印到日志，测试即从日志捕获验证码

## 认证 API（`/api/auth`）

| 方法 | 路径                 | 说明                                                           |
| ---- | -------------------- | -------------------------------------------------------------- |
| POST | `/verification-code` | 发送邮箱验证码（60 秒限频，10 分钟有效）                       |
| POST | `/register`          | 注册（邮箱验证码校验，可选携带 `guestToken` 一并迁移游客数据） |
| POST | `/login`             | 登录（邮箱或用户名 + 密码，失败 5 次锁 15 分钟）               |
| POST | `/refresh`           | 用 refresh token 换取新令牌对（旧 refresh 立即作废，旋转式）   |
| POST | `/logout`            | 注销并吊销 Redis 中的 refresh token                            |
| POST | `/guest`             | 创建游客会话（UUID 身份 + 游戏进度暂存 Redis，30 天过期）      |
| POST | `/guest/bind`        | 游客绑定注册：校验邮箱验证码后建号并把游客进度迁移到正式账号   |
| GET  | `/me`                | 获取当前身份信息（注册用户或游客）                             |

- 注册/登录返回 `accessToken`（15 分钟）+ `refreshToken`（7 天，Redis 键 `refresh:<user_id>`）
- 游客登录返回 `guestToken`（30 天），后续请求同样放入 `Authorization: Bearer <token>`
- 密码使用 bcrypt 哈希（成本因子 10）；SMTP 未配置时开发模式会把验证码打印到日志

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改（`.env` 已被 git 忽略）：

- `PORT`：服务端口，默认 `3000`
- `LOG_LEVEL`：日志级别（`debug` / `info` / `warn` / `error`），默认 `info`
- `DATABASE_URL`：PostgreSQL 连接串
- `REDIS_URL`：Redis 连接串
- `MAPILLARY_TOKEN`：Mapillary API 密钥（仅服务端持有）
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`：JWT 签名密钥（生产必须改为强随机值）
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`：邮箱验证码 SMTP 配置

## 目录结构

```
backend/
├── src/
│   ├── auth/              # 认证领域：密码哈希、JWT、邮箱验证码、游客、账号 service
│   ├── config/env.ts      # 环境变量加载与校验
│   ├── db/pool.ts         # PostgreSQL 连接池
│   ├── db/redis.ts        # Redis 客户端
│   ├── db/migrate.ts      # 迁移执行器（npm run db:migrate）
│   ├── db/migrations/     # SQL 迁移文件
│   ├── logger/index.ts    # 统一日志模块（级别控制 + 生产 JSON 输出）
│   ├── middleware/        # 请求日志、404、全局错误处理与认证中间件
│   ├── routes/            # API 路由
│   ├── types/             # 全局类型声明（Express Request 扩展）
│   ├── utils/             # HttpError、请求参数校验
│   ├── app.ts             # Express 应用组装
│   └── index.ts           # 启动入口
├── Dockerfile               # 生产镜像（多阶段构建，GHCR 推送）
├── docker-compose.yml       # 开发环境：PostgreSQL + Redis
└── eslint.config.mjs        # ESLint 扁平配置
```

## CI/CD

由 `.github/workflows/backend.yml` 驱动（仓库根目录）：

| 阶段          | 内容                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| `check`       | `npm run typecheck` + `lint` + `format:check` + `build`                                    |
| `integration` | CI 中临时启动 PostgreSQL/Redis 容器：迁移建表 → `npm test` 认证端到端 → `/api/health` 冒烟 |
| `docker`      | 仅 `main` 分支推送：构建并推送 `ghcr.io/<owner>/<repo>-backend`（`latest` + SHA 标签）     |

本地验证与 CI 一致：

```bash
npm run db:up       # 启动 PostgreSQL + Redis
npm run db:migrate  # 迁移建表
npm run typecheck && npm run lint && npm run format:check && npm run build && npm test
```
