# MmaGuessr · 街景猜位置游戏


[![Release](https://github.com/cn171g11/mma-guessr/actions/workflows/release.yml/badge.svg)](https://github.com/cn171g11/mma-guessr/actions/workflows/release.yml)
[![CI](https://github.com/cn171g11/mma-guessr/actions/workflows/ci.yml/badge.svg)](https://github.com/cn171g11/mma-guessr/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5.0.0-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-%3E%3D15.0-blue)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/redis-%3E%3D7.0-red)](https://redis.io/)

基于 [Mapillary](https://www.mapillary.com/) 街景数据的 **GeoGuessr 风格** 地理猜谜游戏，前端 + 后端一体仓库。

| 目录         | 说明                                            | 入口文档                      |
| ------------ | ----------------------------------------------- | ----------------------------- |
| `frontend/`  | 游戏前端（纯静态 HTML/CSS/JS，GitHub Pages 部署） | [docs/frontend.md](docs/frontend.md) |
| `backend/`   | 后端服务（Node.js + Express + TypeScript + PostgreSQL + Redis） | [docs/backend.md](docs/backend.md) |
| `.github/`   | CI/CD 工作流（前端校验/发布、后端校验/镜像）       | [CONTRIBUTING.md](CONTRIBUTING.md) |
| `docs/`      | 主题文档汇总（frontend / backend / api / database / build / deploy / testing / locations / scripts） | [docs/README.md](docs/README.md) |

---

## 快速开始

### 前端（无需构建）

```bash
cd frontend
npm install        # 仅安装 Prettier（开发工具）
npm run format     # 格式化 src/ 与 tools/ 下全部代码
```

静态服务任选其一，浏览器访问 `http://localhost:8080/src/index.html`：

```bash
python -m http.server 8080
# 或
npx serve .
```

### 后端（开发环境）

```bash
cd backend
npm run db:up      # docker compose 启动 PostgreSQL + Redis
npm install
npm run dev        # http://localhost:3000/api/health
```

详细说明见 [docs/frontend.md](docs/frontend.md) 与 [docs/backend.md](docs/backend.md)。

---

## CI/CD 概览（`.github/workflows/`）

| 工作流            | 触发时机                              | 作用                                                          |
| ----------------- | ------------------------------------- | ------------------------------------------------------------- |
| `ci.yml`          | `frontend/**` 推送 `main` / PR        | 前端：Prettier 风格、JS 语法、题库数据校验                     |
| `deploy.yml`      | `frontend/**` 推送 `main`（文档除外） | 前端：校验通过后发布 GitHub Pages                              |
| `backend.yml`     | `backend/**` 推送 `main` / PR         | 后端：快速检查（typecheck / lint / 构建）；手动可选择集成测试或推送镜像 |
| `backend-checks.yml` | 供其他工作流复用（`workflow_call`）| 后端检查 + PG/Redis 集成测试的共享实现                        |
| `release.yml`     | 手动（`workflow_dispatch`，填版本号） | 集成测试 → 推送 GHCR `:版本` 镜像 → 打 `v版本` 标签 → 创建 GitHub Release |
| `streetview.yml`  | 手动（`workflow_dispatch`）           | 街景覆盖验证，报告存为 artifact                               |

> 后端推送到 `main` 默认只做快速检查（typecheck / lint / 构建）；完整的集成测试与镜像推送
> 通过 Actions 页手动触发 `backend.yml`（`mode=integration` / `mode=image`）或 `release.yml` 完成。
> 集成验证通过 `docker/service` 方式在 CI 中临时启动 PostgreSQL 与 Redis，
> 冒烟测试 `/api/health` 返回 `status: ok` 才算通过。

---

## 目录结构

```
mma-guessr/
├── frontend/                 # 游戏前端（纯静态，无构建步骤）
│   ├── src/index.html        # 游戏主页面
│   ├── src/css/style.css     # 全局样式
│   ├── src/js/               # config.js（配置）/ data.js（题库）/ game.js（逻辑）
│   ├── tools/                # 题库维护与验证脚本
│   └── archive/              # 已归档的原型文件
├── backend/                  # 后端服务
│   ├── src/                  # Express + TS 源码
│   ├── scripts/              # 运维脚本（check/build/test/clean/debug/deploy）
│   ├── docker-compose.yml    # 开发环境：PostgreSQL + Redis
│   └── Dockerfile            # 生产镜像（多阶段构建）
├── docs/                     # 主题文档（README 索引 + frontend/backend/api/database/build/deploy/testing/locations/scripts）
├── .github/workflows/        # CI/CD 流水线
├── AGENTS.md                 # AI 助手项目指令（opencode 读取）
├── CONTRIBUTING.md           # 开发与贡献指南
└── LICENSE                   # Apache License 2.0
```

---

## 许可

本项目以 [Apache License 2.0](LICENSE) 开源发布，版权所有 © 2026 yzuio, Dinnerb0ne

- 你可以自由使用、修改、分发本项目（含商业化），但需保留版权与许可声明，详见 [LICENSE](LICENSE)。
- Mapillary 街景数据的使用须遵守 [Mapillary 服务条款](https://www.mapillary.com/terms)。
