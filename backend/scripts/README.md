# Scripts 运维脚本

基于 Node.js 编写的跨平台 CLI 脚本（Windows / macOS / Linux / CI 通用，无需 bash）。

> 默认在 `backend/` 目录下执行；每个脚本均有 `npm run script:xxx` 别名。

## 脚本一览

| 脚本         | npm 别名                | 说明                                                                                                                                     |
| ------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `check.mjs`  | `npm run script:check`  | 检查：typecheck + ESLint + Prettier（`--skip-format` 跳过格式检查）                                                                      |
| `build.mjs`  | `npm run script:build`  | 构建：清理 `dist/` → TypeScript 编译（`--docker [--tag <名称>]` 追加构建镜像）                                                           |
| `test.mjs`   | `npm run script:test`   | 测试：自检 PG/Redis → 迁移 → Vitest（`--watch` 监听 / `--coverage` 覆盖率 / `--no-migrate` 跳过迁移）                                    |
| `clean.mjs`  | `npm run script:clean`  | 清理缓存：`dist/`、`coverage/`、node_modules 缓存（`--all` 删除 node_modules；`--npm-cache` 清理全局 npm 缓存）                          |
| `debug.mjs`  | `npm run script:debug`  | 调试：自检依赖 → 迁移 → `tsx watch` 启动，并开启 inspector（默认 9229，`--port <端口>` 修改，`--no-migrate` 跳过迁移）                   |
| `deploy.mjs` | `npm run script:deploy` | 部署：默认构建本地镜像；`--local` 用 docker compose 启动 PG+Redis 开发依赖；`--push` 构建并推送 GHCR 镜像（需先 `docker login ghcr.io`） |

## 示例

```bash
# 检查
npm run script:check

# 构建（含 Docker 镜像）
npm run script:build -- --docker --tag mma-guessr-backend:v1.0

# 测试 + 覆盖率
npm run script:test -- --coverage

# 清理 dist 与测试缓存
npm run script:clean

# 调试（监听 9333 端口远程调试）
npm run script:debug -- --port 9333

# 部署：推送 GHCR
npm run script:deploy -- --push
```

## 说明

- `test.mjs` / `debug.mjs` 会先探测 PostgreSQL 与 Redis 是否可达；不可达时会提示先行启动（`docker compose up -d` 或本地服务）。
- 首次运行会从 `.env.example` 自动生成 `.env`（若不存在），请按需修改其中的 JWT 密钥与 SMTP 配置。
- 所有脚本失败时以非零退出码结束，可直接用于 CI。
