# mma-guessr-backend

MmaGuessr 后端服务：Node.js + Express + TypeScript + PostgreSQL + Redis。

## 快速开始

```bash
cd backend

# 1. 拉起开发环境依赖（PostgreSQL + Redis）
npm run db:up

# 2. 安装依赖
npm install

# 3. 启动开发服务（tsx watch，自动重启）
npm run dev
```

服务启动后访问 http://localhost:3000/api/health 可查看 PostgreSQL / Redis 连通状态。

## 常用命令

| 命令                | 说明                         |
| ------------------- | ---------------------------- |
| `npm run dev`       | 开发模式（tsx watch 热重载） |
| `npm run build`     | 编译到 `dist/`               |
| `npm run start`     | 运行编译产物                 |
| `npm run typecheck` | TypeScript 类型检查          |
| `npm run lint`      | ESLint 检查                  |
| `npm run format`    | Prettier 格式化              |
| `npm run db:up`     | 启动 PostgreSQL + Redis 容器 |
| `npm run db:down`   | 停止容器                     |

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改（`.env` 已被 git 忽略）：

- `PORT`：服务端口，默认 `3000`
- `LOG_LEVEL`：日志级别（`debug` / `info` / `warn` / `error`），默认 `info`
- `DATABASE_URL`：PostgreSQL 连接串
- `REDIS_URL`：Redis 连接串
- `MAPILLARY_TOKEN`：Mapillary API 密钥（仅服务端持有）

## 目录结构

```
backend/
├── src/
│   ├── config/env.ts        # 环境变量加载与校验
│   ├── db/pool.ts           # PostgreSQL 连接池
│   ├── db/redis.ts          # Redis 客户端
│   ├── logger/index.ts      # 统一日志模块（级别控制 + 生产 JSON 输出）
│   ├── middleware/          # 请求日志、404 与全局错误处理
│   ├── routes/              # API 路由
│   ├── app.ts               # Express 应用组装
│   └── index.ts             # 启动入口
├── Dockerfile               # 生产镜像（多阶段构建，GHCR 推送）
├── docker-compose.yml       # 开发环境：PostgreSQL + Redis
└── eslint.config.mjs        # ESLint 扁平配置
```

## CI/CD

由 `.github/workflows/backend.yml` 驱动（仓库根目录）：

| 阶段          | 内容                                                                                   |
| ------------- | -------------------------------------------------------------------------------------- |
| `check`       | `npm run typecheck` + `lint` + `format:check` + `build`                                |
| `integration` | CI 中临时启动 PostgreSQL/Redis 容器，冒烟测试 `/api/health` 返回 `ok`                  |
| `docker`      | 仅 `main` 分支推送：构建并推送 `ghcr.io/<owner>/<repo>-backend`（`latest` + SHA 标签） |

本地验证与 CI 一致：

```bash
npm run typecheck && npm run lint && npm run format:check && npm run build
```
