# MmaGuessr · 街景猜位置游戏

基于 [Mapillary](https://www.mapillary.com/) 街景数据的 **GeoGuessr 风格** 地理猜谜游戏，前端 + 后端一体仓库。

| 目录         | 说明                                            | 入口文档                      |
| ------------ | ----------------------------------------------- | ----------------------------- |
| `frontend/`  | 游戏前端（纯静态 HTML/CSS/JS，GitHub Pages 部署） | [frontend/README.md](frontend/README.md) |
| `backend/`   | 后端服务（Node.js + Express + TypeScript + PostgreSQL + Redis） | [backend/README.md](backend/README.md) |
| `.github/`   | CI/CD 工作流（前端校验/发布、后端校验/镜像）       | [CONTRIBUTING.md](CONTRIBUTING.md) |

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

详细说明见 [frontend/README.md](frontend/README.md) 与 [backend/README.md](backend/README.md)。

---

## CI/CD 概览（`.github/workflows/`）

| 工作流          | 触发时机                              | 作用                                                          |
| --------------- | ------------------------------------- | ------------------------------------------------------------- |
| `ci.yml`        | `frontend/**` 推送 `main` / PR        | 前端：Prettier 风格、JS 语法、题库数据校验                     |
| `deploy.yml`    | `frontend/**` 推送 `main`（文档除外） | 前端：校验通过后发布 GitHub Pages                              |
| `backend.yml`   | `backend/**` 推送 `main` / PR         | 后端：类型检查 / Lint / 构建 + PG/Redis 集成验证 + GHCR 镜像推送 |
| `streetview.yml`| 手动（`workflow_dispatch`）           | 街景覆盖验证，报告存为 artifact                               |

> 后端集成验证通过 `docker/service` 方式在 CI 中临时启动 PostgreSQL 与 Redis，
> 冒烟测试 `/api/health` 返回 `status: ok` 才算通过。
> `backend.yml` 在 `main` 分支推送时还会构建并推送
> `ghcr.io/<owner>/<repo>-backend` 镜像（latest + 提交 SHA 标签）。

---

## 目录结构

```
mma-guessr/
├── frontend/                 # 游戏前端（纯静态，无构建步骤）
│   ├── src/index.html        # 游戏主页面
│   ├── src/css/style.css     # 全局样式
│   ├── src/js/               # config.js（配置）/ data.js（题库）/ game.js（逻辑）
│   ├── tools/                # 题库维护与验证脚本
│   ├── archive/              # 已归档的原型文件
│   └── README.md             # 游戏说明（模式、部署、更新记录）
├── backend/                  # 后端服务
│   ├── src/                  # Express + TS 源码
│   ├── docker-compose.yml    # 开发环境：PostgreSQL + Redis
│   └── README.md             # 后端说明
├── .github/workflows/        # CI/CD 流水线
├── CONTRIBUTING.md           # 开发与贡献指南
└── LICENSE                   # Apache License 2.0
```

---

## 许可

本项目以 [Apache License 2.0](LICENSE) 开源发布，版权所有 © 2026 yzuio, Dinnerb0ne

- 你可以自由使用、修改、分发本项目（含商业化），但需保留版权与许可声明，详见 [LICENSE](LICENSE)。
- Mapillary 街景数据的使用须遵守 [Mapillary 服务条款](https://www.mapillary.com/terms)。
