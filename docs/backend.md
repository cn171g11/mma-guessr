# mma-guessr-backend

MmaGuessr 后端服务：Node.js + Express + TypeScript + PostgreSQL + Redis。

> 相关主题文档：[api.md](api.md)（API）、[database.md](database.md)（数据层）、[testing.md](testing.md)（测试）、[deploy.md](deploy.md)（部署）、[scripts.md](scripts.md)（运维脚本）。

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
| `npm run script:*`   | 运维脚本（见 [scripts.md](scripts.md)）          |

## 测试

`npm test`（Vitest + supertest）对 Express 应用发起真实请求，覆盖认证全流程（详见 [testing.md](testing.md)）：

```bash
npm run db:up && npm run db:migrate && npm test
```

## 认证 API（`/api/auth`）

注册 / 登录 / 刷新令牌 / 登出 / 游客会话与绑定等接口的完整参考见 [api.md](api.md)。

- 注册/登录返回 `accessToken`（15 分钟）+ `refreshToken`（7 天，Redis 键 `refresh:<user_id>`）
- 游客返回 `guestToken`（30 天），后续请求同样放入 `Authorization: Bearer <token>`

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

由 `.github/workflows/backend.yml` 与 `.github/workflows/release.yml` 驱动，触发方式与部署详情见 [deploy.md](deploy.md)。本地验证与 CI 一致：

```bash
npm run db:up       # 启动 PostgreSQL + Redis
npm run db:migrate  # 迁移建表
npm run typecheck && npm run lint && npm run format:check && npm run build && npm test
```
