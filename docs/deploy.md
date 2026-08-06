# 部署指南

## 前端 · GitHub Pages（推荐）

```bash
cd frontend && npm run format:check   # 本地先过校验
git push origin main
```

首次启用：

1. 仓库 **Settings → Pages → Source** 选择 `GitHub Actions`
2. 当 `frontend/**` 变更推送至 `main` 时自动触发：`ci.yml`（校验）→ `deploy.yml`（发布）
3. 站点地址 `https://<user>.github.io/<repo>/`，根目录 `index.html` 自动跳转到 `frontend/src/index.html`

发布产物由 `deploy.yml` 从 `frontend/` 显式打包（不含 `node_modules/`、`tools/`），仓库已内置 `frontend/.nojekyll`。

### 自定义域名（可选）

1. 仓库 **Settings → Pages** 填入域名
2. 在 DNS 服务商添加记录：`CNAME` 或 `ALIAS` → `<user>.github.io`
3. 等待 DNS 生效后访问验证

## 后端 · GHCR 镜像（手动触发）

后端镜像**不随 push 自动构建**，全部手动触发：

| 入口 | 方式 | 产物 |
| --- | --- | --- |
| `backend.yml` | Actions 页手动运行，`mode=image` | `ghcr.io/<owner>/<repo>-backend`（`latest` + 提交 SHA，linux/amd64 + linux/arm64 多架构） |
| `release.yml` | Actions 页手动运行，填写 `version` | **整体发布**：集成测试 → 前端部署到 GitHub Pages → 多架构后端镜像 `:版本号` + `latest` → Git 标签 `v版本号` → GitHub Release（含跨平台产物） |

`release.yml` 的 Release 附带跨平台产物（已附 SHA256 校验和）：

- `mma-guessr-frontend-<version>.zip`：前端静态包，任意平台解压后打开 `src/index.html` 或部署到任意静态服务器
- `mma-guessr-backend-<version>.zip`：后端 Node 运行包，任意平台执行 `npm ci --omit=dev && node dist/index.js`（需 Node.js 20+，环境变量见 `.env.example`）

工作流需 `actions: write` 权限配合 BuildKit `type=gha` 缓存，已按 job 单独授予。

本地等效命令：`npm run script:deploy -- --push`（见 [scripts.md](scripts.md)）。

## 后端 · 云服务器（规划中）

计划通过 `docker-compose` 部署 Node.js / PostgreSQL / Redis / Nginx：

- 挂载持久化卷；PostgreSQL 定时 `pg_dump` 备份，Redis 开启 AOF + RDB 双重持久化
- Nginx 反向代理并开启 HTTPS（Let's Encrypt）

## 上线检查清单

- [ ] 打开站点根 URL，确认自动跳转到游戏页
- [ ] 主菜单「题库共 1570 题」及各区域题数与 `frontend/src/js/data.js` 一致
- [ ] 经典 / 挑战 / 区域 / 中国 / 无限五种模式各跑一局
- [ ] 提交答案后红线、得分动画、结果弹窗正常
- [ ] 手机端横竖屏各检查一次（小地图按钮化）
- [ ] 历史记录、更新记录、分享按钮可用
- [ ] 后端 `/api/health` 返回 `status: ok`

## 密钥与 Secret

- 后端环境变量见 [backend.md](backend.md)（复制 `backend/.env.example` 为 `backend/.env`，已 git 忽略）
- CI Secret：仓库 **Settings → Secrets and variables → Actions** 新建 `MAPILLARY_TOKEN`（用于街景覆盖验证，见 [locations.md](locations.md)），未配置时脚本回退到内置 token
- 生产环境必须设置强随机 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`，勿用仓库默认值