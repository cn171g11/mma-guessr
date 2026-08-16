# MmaGuessr 开发与贡献指南

> 本文档覆盖：环境配置 → 本地运行 → 代码规范 → 构建 → 上线部署 → 后端开发 → 贡献流程。
> 前端说明见 [docs/frontend.md](docs/frontend.md)，后端说明见 [docs/backend.md](docs/backend.md)，文档索引见 [docs/README.md](docs/README.md)。

---

## 1. 项目结构

```
mma-guessr/
├── frontend/                     # 游戏前端（纯静态，无构建步骤）
│   ├── src/
│   │   ├── index.html            # 游戏主页面
│   │   ├── css/style.css         # 全局样式
│   │   └── js/
│   │       ├── config.js         # 全局配置：MAPILLARY_TOKEN / VERSION / CHANGELOG / 模式与计分参数
│   │       ├── data.js           # 地点题库 LOCATIONS + 派生题库 WORLD/CHINA_LOCATIONS
│   │       └── game.js           # 游戏逻辑：状态、抽题、计分、街景、UI
│   ├── index.html                # 站点入口，跳转到 src/index.html
│   ├── MmaGuessr.html            # 旧入口，保留旧书签，同样跳转
│   ├── archive/                  # 已归档的原型文件
│   ├── tools/                    # 开发脚本（读写 src/js/data.js 题库）
│   └── package.json              # 仅含 Prettier，无运行时依赖
├── backend/                      # 后端服务（Go + SQLite 单二进制）
│   ├── cmd/                      # 启动入口：server（HTTP + Engine.IO）/ seed（题库导入）
│   ├── internal/                 # auth / games / leaderboard / achievements / daily / profile / multiplayer / locations / mapillary 等域
│   ├── test/                     # e2e 测试（httptest + 内存 SQLite）
│   ├── Dockerfile                # 生产镜像（多阶段构建，无 CGO）
│   └── deploy/                   # 生产部署栈（compose + Nginx + SQLite 备份）
├── .github/workflows/            # CI/CD 流水线（见 §6.5 / §7）
└── docs/                         # 主题文档（frontend / backend / api / database / build / deploy / testing / locations / scripts）
```

> 前端文件结构细节见 [docs/frontend.md](docs/frontend.md)，后端目录结构见 [docs/backend.md](docs/backend.md)。

---

## 2. 环境要求

| 依赖    | 版本                                                                | 用途                                              |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| Go      | ≥ 1.22（`go.mod` 指定）                                             | 编译/运行后端                                     |
| Node.js | ≥ 18（仅前端开发工具链使用）                                        | 运行前端 `tools/` 脚本 / Prettier                 |
| 浏览器  | Chrome / Edge / Firefox / Safari（最新版）                          | 运行游戏                                          |
| 网络    | 可访问 `unpkg.com`、`tile.openstreetmap.org`、`graph.mapillary.com` | 加载 Leaflet / Mapillary / 街景数据                |

> 后端为 Go 单二进制（纯标准库 + SQLite，无 CGO、无 PostgreSQL / Redis / Docker 依赖）；
> 数据库文件即 `backend/mma_guessr.db`（自动建表，无需外部服务）。

---

## 3. 本地配置与运行

### 3.1 前端

```bash
cd frontend
npm install    # 仅安装 Prettier（开发工具），不影响运行时
```

静态启动（访问 `http://localhost:8080/src/index.html`）：

```bash
python -m http.server 8080
# 或
npx serve .
```

### 3.2 后端（开发环境）

```bash
cd backend
go build ./...                              # 编译全部包
go run ./cmd/seed -data ../frontend/src/js/data.js   # 导入题库（1570 条，幂等）
go run ./cmd/server                         # 启动，http://localhost:3000/api/health
```

后端启动前可复制 `backend/.env.example` 为 `backend/.env`（可选，不配置则使用开发默认值）。更多见 [docs/backend.md](docs/backend.md)。

### 3.3 配置 Mapillary Token（仅服务端）

1. 在 [Mapillary 开发者中心](https://www.mapillary.com/developer/api-documentation) 申请 access token（免费）。
2. 只写入后端环境变量：复制 `backend/.env.example` 为 `backend/.env`，填写 `MAPILLARY_TOKEN`。前端不持有任何密钥，街景搜索与全景图一律经 `/api/proxy` 走服务端。

> ⚠️ **安全提醒**：密钥严禁硬编码进前端或 `frontend/tools/` 脚本（已全部改为仅读环境变量）。一旦泄露，请到 Mapillary 后台吊销并更换。

> 直接用浏览器打开 `frontend/src/index.html`（`file://`）大部分功能可用，
> 但部分浏览器对跨域请求有限制，**推荐用静态服务器方式**。

---

## 4. 代码规范

- **前端格式化工具**：Prettier（`frontend/.prettierrc.json`，缩进/引号/换行与 `.editorconfig` 一致）。
- **前端 JavaScript**：ES6+，`const`/`let`；全局常量在 `config.js`，题库在 `data.js`，逻辑在 `game.js`。
- **前端文件加载顺序**（`frontend/src/index.html` 中不可颠倒）：

    ```html
    <script src="js/config.js"></script>
    <script src="js/data.js"></script>
    <script src="js/game.js"></script>
    ```

- **后端 Go**：标准库优先，`go fmt` 风格；包名单数小写（`internal/` 下按域分包）；错误处理用统一 `HttpError`，不泄露内部细节；日志用 `slog`。
- **提交前必跑**：

    ```bash
    cd frontend && npm run format:check
    cd backend  && go build ./... && go vet ./... && go test ./...
    ```

- 建议编辑器安装 Prettier 插件并开启「保存时格式化」。

---

## 5. 构建

### 前端

**没有构建步骤**：`frontend/src/` 中的 HTML/CSS/JS 即最终产物，浏览器直接加载。
「构建」约等于修改文件后运行 `npm run format` 保证风格统一。

### 后端

```bash
cd backend
go build -o mma-guessr ./cmd/server   # 编译为单二进制
./mma-guessr                          # 运行编译产物（自动建表）
```

Docker 镜像（多阶段构建，`CGO_ENABLED=0`）见 `backend/Dockerfile`，由 CI 自动构建推送 GHCR。
完整构建与交叉编译指南见 [docs/build.md](docs/build.md)。

---

## 6. 上线 / 部署

### 6.1 前端 · GitHub Pages（推荐）

```bash
cd frontend && npm run format:check   # 本地先过校验
git push origin main
```

推送后由 `.github/workflows/deploy.yml` 自动完成部署（校验通过 → 打包 → 发布）。

首次启用：

1. 仓库 **Settings → Pages → Source** 选择 `GitHub Actions`；
2. 当 `frontend/**` 变更推送至 `main` 时会自动触发：`CI`（校验）→ `Deploy`（发布）；
3. 站点地址 `https://<user>.github.io/<repo>/`，根目录 `index.html` 自动跳转到 `frontend/src/index.html`。

> 已内置 `frontend/.nojekyll`；发布产物由工作流从 `frontend/` 显式打包（不含 `node_modules/`、`tools/`）。

### 6.2 后端部署

后端为单容器 Go 二进制 + SQLite，无外部服务依赖。生产栈见 `backend/deploy/docker-compose.prod.yml`（Nginx 反代 + SQLite 命名卷 + 定时备份），完整清单见 [docs/deploy.md](docs/deploy.md)。

镜像通过 GitHub Actions 手动触发 `backend.yml`（`mode=image`）或 `release.yml` 构建推送 GHCR（多架构 linux/amd64 + arm64）。

### 6.3 自定义域名（可选）

1. 仓库 **Settings → Pages** 填入域名；
2. 在 DNS 服务商添加记录：`CNAME` 或 `ALIAS` → `<user>.github.io`；
3. 等待 DNS 生效后访问验证。

### 6.4 上线检查清单

- [ ] 打开站点根 URL，确认自动跳转到游戏页
- [ ] 主菜单「题库共 1570 题」及各区域题数与 `frontend/src/js/data.js` 一致
- [ ] 经典 / 挑战 / 区域 / 中国 / 无限五种模式各跑一局
- [ ] 提交答案后红线、得分动画、结果弹窗正常
- [ ] 手机端横竖屏各检查一次（小地图按钮化）
- [ ] 历史记录、更新记录、分享按钮可用
- [ ] 后端 `curl http://<host>:3000/api/health` 返回 `{"status":"ok"}`

---

## 7. CI/CD 流水线（`.github/workflows/`）

| 工作流           | 触发时机                              | 作用                                                          |
| ---------------- | ------------------------------------- | ------------------------------------------------------------- |
| `ci.yml`         | `frontend/**` 推送 `main` / 任意 PR   | 前端代码风格、JS 语法、题库数据完整性校验                     |
| `deploy.yml`     | `frontend/**` 推送 `main`（文档除外）/ 手动 | 校验通过后打包发布 GitHub Pages                              |
| `backend.yml`    | `backend/**` 推送 `main` / 任意 PR     | 后端 `go vet` / `go build` / 全量测试（含 race）；手动可选推送 GHCR 镜像 |
| `backend-checks.yml` | 供其他工作流复用（`workflow_call`）| Go 检查 + e2e 测试（内存 SQLite，无外部依赖）                  |
| `release.yml`    | 手动（`workflow_dispatch`，填版本号） | 质量门禁 → 跨平台二进制产物 → 推送 GHCR `:版本` 镜像 → 打 `v版本` 标签 → 创建 GitHub Release |
| `streetview.yml` | 手动（`workflow_dispatch`）           | 用 `secrets.MAPILLARY_TOKEN` 跑街景覆盖验证，报告存 artifact  |

> 前端校验内容（`ci.yml` / `deploy.yml` 一致，均在 `frontend/` 下执行）：

```bash
npm run format:check                     # Prettier 风格
node --check src/js/*.js tools/*.js      # JS 语法
node tools/validate-data.js              # 题库数据校验
```

> 后端校验内容（`backend-checks.yml`，在 `backend/` 下执行）：

```bash
go vet ./...                             # 静态检查
go build ./...                           # 编译
go test -count=1 ./...                   # 单元 + e2e 测试（内存 SQLite）
go test -race -count=1 ./test/           # 竞态检测套件
```

题库校验规则（`frontend/tools/validate-data.js`，纯本地无网络）：

- 题库可解析且总量 = 期望值（默认 1570，可用环境变量 `EXPECTED_LOCATIONS` 覆盖）；
- 地点名称唯一且非空；
- `region` / `difficulty` / `lat` / `lng` 均在合法范围；
- 派生题库 `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 声明存在且计数一致。

> 后端测试全部运行在内存 SQLite 上，无需 PostgreSQL / Redis 容器或任何外部服务。

> **首次使用需在仓库配置 Secret**：Settings → Secrets and variables → Actions → 新建 `MAPILLARY_TOKEN`（用于 `streetview.yml`；未配置时验证脚本会直接失败）。

---

## 8. 题库维护（frontend/tools/）

`LOCATIONS` 条目结构（`frontend/src/js/data.js`）：

```js
{ name: '中国北京·天安门广场', lat: 39.9055, lng: 116.3976, region: 'asia', difficulty: 1 }
```

- `region`：`asia` / `europe` / `northamerica` / `southamerica` / `africa` / `oceania`；
- `difficulty`：1（超著名地标）~ 5（偏远超难）。

常用脚本（在 `frontend/` 下执行）：

```bash
node tools/add-china.js                   # 向题库批量插入中国街景点位
node tools/add-hmt.js                   # 向题库批量插入港澳台街景点位
node tools/verify-cn-streetview.js      # 逐点调用 Mapillary API 验证覆盖
node tools/verify-world-expand.js       # 候选世界点位验证（6 并发，输出 report）
node tools/validate-data.js             # 题库数据完整性校验（CI 中使用，无网络）
```

> `verify-*.js` 脚本必须通过环境变量 `MAPILLARY_TOKEN` 提供密钥，未设置时直接退出（密钥不内置在脚本中）。

> ⚠️ `tools/` 直接读写 `frontend/src/js/data.js`，运行后请重新执行 `npm run format`。

---

## 9. 贡献流程

### 9.1 报告 Bug

在 [Issues](https://github.com/cn171g11/mma-guessr/issues) 中报告，请包含：

- 浏览器与操作系统版本；
- 复现步骤；
- 控制台报错信息（F12）；
- 游戏内「导出错误报告」生成的内容。

### 9.2 分支与提交

```bash
git checkout -b feat/xxx     # 功能
git checkout -b fix/xxx      # 修复
git checkout -b chore/xxx    # 维护（格式化、文档、依赖）
```

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，例如：

- `feat(backend): 新增 XX 接口`
- `fix: 修复街景切换残留问题`
- `chore: 更新 Prettier 配置`

### 9.3 发版流程

1. 更新 `frontend/src/js/config.js`：
    - `VERSION` 递增（语义化版本 `v主版本.次版本.修订号`）；
    - `CHANGELOG` **顶部**插入新版本条目。
2. 同步更新 `docs/frontend.md` 的版本号与更新记录表。
3. 在 Actions 页手动触发 `release.yml`，填版本号即可完成质量门禁 → 跨平台产物 → GHCR 镜像 → GitHub Release。

### 9.4 提交前检查

```bash
# 前端
cd frontend
npm run format:check                  # 代码风格通过
node --check src/js/config.js src/js/data.js src/js/game.js    # JS 语法通过
node tools/validate-data.js          # 题库数据校验通过

# 后端
cd ../backend
go build ./... && go vet ./... && go test ./...
```

```bash
git status   # 确认无密钥/临时文件入库（backend/.env 已被 git 忽略）
```

> 推送后 GitHub Actions 会自动按改动目录运行对应检查（前端 `ci.yml` / 后端 `backend.yml`），
> PR 页面的 **Checks** 全部通过才算完成；若只改了文档，`deploy.yml` 会跳过前端发布。

### 9.5 拉取请求（PR）

- 描述改动内容与测试方式（前端可附截图）；
- 保持改动聚焦：一个 PR 对应一个主题。

### 9.6 开源协议

本项目以 [Apache License 2.0](LICENSE) 开源（版权所有 © 2026 yzuio, Dinnerb0ne）。

- 按 Apache 2.0 第 5 条「Submission of Contributions」，你提交的 Issue / PR /
  任何有意提交的贡献，默认视为以 Apache 2.0 条款授权本项目使用；
- 如需以其他条款贡献，请在提交中明确声明「Not a Contribution」。

---

## 10. 常见问题

**Q：街景一直加载失败？**
A：检查网络能否访问 `graph.mapillary.com`，以及 token 是否有效（见 §3.3）。

**Q：本地直接打开 HTML 地图/街景不显示？**
A：改用静态服务器方式运行（见 §3.1），`file://` 下部分跨域请求会被浏览器拦截。

**Q：改了 `frontend/src/js/data.js` 后代码风格检查报错？**
A：`tools/` 脚本写入后未格式化，运行 `npm run format` 即可。

**Q：后端 `/api/health` 返回 `degraded`？**
A：检查 SQLite 数据库文件（`SQLITE_PATH`）是否可读写、磁盘是否满；确认 `.env` 配置无误后重启 `go run ./cmd/server`。
