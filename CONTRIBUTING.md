# MmaGuessr 开发与贡献指南

> 本文档覆盖：环境配置 → 本地运行 → 代码规范 → 构建 → 上线部署 → 贡献流程。
> 游戏说明与版本记录见 [README.md](README.md)，版本备份与回滚见 [BACKUP.md](BACKUP.md)。

---

## 1. 项目结构

```
mma-guessr/
├── src/                    # 前端源码（纯静态，无构建步骤）
│   ├── index.html          # 游戏主页面
│   ├── css/style.css       # 全局样式
│   └── js/
│       ├── config.js       # 全局配置：MAPILLARY_TOKEN / VERSION / CHANGELOG / 模式与计分参数
│       ├── data.js         # 地点题库 LOCATIONS + 派生题库 WORLD/CHINA_LOCATIONS
│       └── game.js         # 游戏逻辑：状态、抽题、计分、街景、UI
├── index.html              # 站点入口，跳转到 src/index.html
├── MmaGuessr.html          # 旧入口，保留旧书签，同样跳转
├── archive/                # 已归档的原型文件
├── tools/                  # 开发脚本（读写 src/js/data.js 题库）
├── .editorconfig           # 编辑器编码与缩进规范
├── .prettierrc.json        # Prettier 代码风格
└── package.json            # 仅含 Prettier，无运行时依赖
```

---

## 2. 环境要求

| 依赖    | 版本                                                                | 用途                                |
| ------- | ------------------------------------------------------------------- | ----------------------------------- |
| Node.js | ≥ 18                                                                | 运行 `tools/` 脚本与 Prettier       |
| 浏览器  | Chrome / Edge / Firefox / Safari（最新版）                          | 运行游戏                            |
| 网络    | 可访问 `unpkg.com`、`tile.openstreetmap.org`、`graph.mapillary.com` | 加载 Leaflet / Mapillary / 街景数据 |

项目**无后端服务器**，纯静态单页应用，可在任意静态托管平台运行。

---

## 3. 本地配置与运行

### 3.1 安装依赖

```bash
npm install    # 仅安装 Prettier（开发工具），不影响运行时
```

### 3.2 配置 Mapillary Token

1. 在 [Mapillary 开发者中心](https://www.mapillary.com/developer/api-documentation) 申请 access token（免费）。
2. 打开 `src/js/config.js`，替换 `MAPILLARY_TOKEN`：

```js
const MAPILLARY_TOKEN = 'MLY|你的新token';
```

> ⚠️ **安全提醒**：token 硬编码在仓库中且会随仓库公开。
> 请使用限额内的低权限 token；一旦泄露，请到 Mapillary 后台吊销后更换。

### 3.3 本地启动

项目是纯静态文件，任选一种方式：

```bash
# 方式一：Python
python -m http.server 8080
# 访问 http://localhost:8080/src/index.html

# 方式二：Node
npx serve .
```

> 直接用浏览器打开 `src/index.html`（`file://`）大部分功能可用，
> 但部分浏览器对跨域请求有限制，**推荐用静态服务器方式**。

---

## 4. 代码规范

- **格式化工具**：Prettier（配置见 `.prettierrc.json`，缩进/引号/换行与 `.editorconfig` 一致）。
- **JavaScript**：ES6+，`const`/`let`，不使用 `var`；全局常量集中在 `config.js`，题库数据在 `data.js`，逻辑在 `game.js`。
- **文件加载顺序**（`src/index.html` 中不可颠倒）：

    ```html
    <script src="js/config.js"></script>
    <script src="js/data.js"></script>
    <script src="js/game.js"></script>
    ```

- **提交前必跑**：

    ```bash
    npm run format        # 一键格式化
    npm run format:check  # 检查是否已符合规范
    ```

- 建议编辑器安装 Prettier 插件并开启「保存时格式化」。

---

## 5. 构建

本项目**没有构建步骤**：`src/` 中的 HTML/CSS/JS 即最终产物，浏览器直接加载。

「构建」约等于两步：

1. 修改 `src/` 下的文件；
2. 运行 `npm run format` 保证风格统一。

新增文件（如图片、脚本）直接放入 `src/` 下对应目录即可。

---

## 6. 上线 / 部署

### 6.1 GitHub Pages（推荐）

```bash
git push origin main
```

推送后由 `.github/workflows/deploy.yml` 自动完成部署（校验通过 → 打包 → 发布）。

首次启用：

1. 仓库 **Settings → Pages → Source** 选择 `GitHub Actions`；
2. 之后每次推送到 `main` 都会自动触发：`CI`（校验）→ `Deploy`（发布）→ `Deploy` 工作流日志中给出站点地址；
3. 站点地址 `https://<user>.github.io/<repo>/`，根目录 `index.html` 会自动跳转到 `src/index.html`。

> 已内置 `.nojekyll`；发布产物由工作流显式打包（不含 `node_modules/`）。

### 6.2 自定义域名（可选）

1. 仓库 **Settings → Pages** 填入域名；
2. 在 DNS 服务商添加记录：
    - `CNAME` 或 `ALIAS` → `<user>.github.io`（根域名）
    - `CNAME` → `<user>.github.io/<repo>.github.io`（子域名，视具体配置）
3. 等待 DNS 生效后访问验证。

### 6.3 其他静态托管（Vercel / Netlify 等）

- 构建命令（Build Command）：**留空**；
- 输出目录（Output/Publish Directory）：仓库根目录或 `/`；
- 启动命令：无需。

### 6.4 上线检查清单

- [ ] 打开站点根 URL，确认自动跳转到游戏页
- [ ] 主菜单「题库共 1570 题」及各区域题数与 `src/js/data.js` 一致
- [ ] 经典 / 挑战 / 区域 / 中国 / 无限五种模式各跑一局
- [ ] 提交答案后红线、得分动画、结果弹窗正常
- [ ] 手机端横竖屏各检查一次（小地图按钮化）
- [ ] 历史记录、更新记录、分享按钮可用

### 6.5 CI/CD 流水线（`.github/workflows/`）

| 工作流           | 触发时机                          | 作用                                                           |
| ---------------- | --------------------------------- | -------------------------------------------------------------- |
| `ci.yml`         | 推送 `main` / 任意 PR             | 代码风格、JS 语法、题库数据完整性校验                          |
| `deploy.yml`     | 推送 `main`（文档变更除外）/ 手动 | 校验通过后打包并发布 GitHub Pages                              |
| `streetview.yml` | 手动（`workflow_dispatch`）       | 用 `secrets.MAPILLARY_TOKEN` 跑街景覆盖验证，报告存为 artifact |

校验内容（`ci.yml` / `deploy.yml` 一致）：

```bash
npm run format:check                     # Prettier 风格
node --check src/js/*.js tools/*.js      # JS 语法
node tools/validate-data.js              # 题库数据校验（tools/validate-data.js）
```

题库校验规则（`tools/validate-data.js`，纯本地无网络）：

- 题库可解析且总量 = 期望值（默认 1570，可用环境变量 `EXPECTED_LOCATIONS` 覆盖）；
- 地点名称唯一且非空；
- `region` / `difficulty` / `lat` / `lng` 均在合法范围；
- 派生题库 `WORLD_LOCATIONS` / `CHINA_LOCATIONS` 声明存在且计数一致。

> **首次使用需在仓库配置 Secret**：Settings → Secrets and variables → Actions → 新建 `MAPILLARY_TOKEN`（用于 `streetview.yml`，未配置时脚本回退到内置 token）。

---

## 7. 题库维护（tools/）

`LOCATIONS` 条目结构（`src/js/data.js`）：

```js
{ name: '中国北京·天安门广场', lat: 39.9055, lng: 116.3976, region: 'asia', difficulty: 1 }
```

- `region`：`asia` / `europe` / `northamerica` / `southamerica` / `africa` / `oceania`；
- `difficulty`：1（超著名地标）~ 5（偏远超难）。

常用脚本：

```bash
node tools/add-china.js          # 向题库批量插入中国街景点位
node tools/add-hmt.js            # 向题库批量插入港澳台街景点位
node tools/verify-cn-streetview.js   # 逐点调用 Mapillary API 验证覆盖
node tools/verify-world-expand.js    # 候选世界点位验证（6 并发，输出 report）
node tools/validate-data.js      # 题库数据完整性校验（CI 中使用，无网络）
```

> 三个 `verify-*.js` 脚本优先读取环境变量 `MAPILLARY_TOKEN`，未设置时回退到内置 token：
> `MAPILLARY_TOKEN=xxx node tools/verify-cn-streetview.js`

> ⚠️ `tools/` 直接读写 `src/js/data.js`，运行后请重新执行 `npm run format`。

---

## 8. 贡献流程

### 8.1 报告 Bug

在 [Issues](https://github.com/anomalyco/opencode/issues) 中报告，请包含：

- 浏览器与操作系统版本；
- 复现步骤；
- 控制台报错信息（F12）；
- 游戏内「📄 导出错误报告」生成的内容。

### 8.2 分支与提交

```bash
git checkout -b feat/xxx    # 功能
git checkout -b fix/xxx     # 修复
git checkout -b chore/xxx   # 维护（格式化、文档、依赖）
```

提交信息风格（参照现有 `git log`）：`类型: 中文描述`，例如：

- `feat: 新增 XX 模式`
- `fix: 修复街景切换残留问题`
- `chore: 更新 Prettier 配置`
- `v1.15.0: 版本发布说明`

### 8.3 发版流程

1. 更新 `src/js/config.js`：
    - `VERSION` 递增（语义化版本 `v主版本.次版本.修订号`）；
    - `CHANGELOG` **顶部**插入新版本条目（含版本号、日期、更新内容）。
2. 同步更新 `README.md` 的版本号与更新记录表。
3. 提交并打 tag，按 [BACKUP.md](BACKUP.md) 做双保险备份。

### 8.4 提交前检查

```bash
npm run format:check        # 代码风格通过
node --check src/js/config.js src/js/data.js src/js/game.js    # JS 语法通过
node tools/validate-data.js # 题库数据校验通过
git status                  # 确认无密钥/临时文件入库
```

> 推送后 GitHub Actions 会自动运行相同检查（`ci.yml`），PR 页面的
> **Checks** 全部通过才算完成；若只改了文档，`deploy.yml` 会跳过发布。

### 8.5 拉取请求（PR）

- 描述改动内容与测试方式；
- 附上验证截图（可选）；
- 保持改动聚焦：一个 PR 对应一个主题。

---

## 9. 常见问题

**Q：街景一直加载失败？**
A：检查网络能否访问 `graph.mapillary.com`，以及 token 是否有效（见 §3.2）。

**Q：本地直接打开 HTML 地图/街景不显示？**
A：改用静态服务器方式运行（见 §3.3），`file://` 下部分跨域请求会被浏览器拦截。

**Q：改了 `data.js` 后代码风格检查报错？**
A：`tools/` 脚本写入后未格式化，运行 `npm run format` 即可。
