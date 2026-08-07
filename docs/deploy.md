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

## 后端 · 云服务器（生产部署）

使用仓库内置的 `backend/deploy/` 生产部署栈（docker-compose + Nginx + HTTPS + 持久化 + 定时备份）。

> ⚠️ **禁止复用 `backend/docker-compose.yml` 直接上生产**：该文件仅用于本地开发（虽已回环绑定 127.0.0.1，但默认弱密码、无 Nginx/HTTPS/备份）。生产部署一律使用 `backend/deploy/`。

### 目录结构

```
backend/deploy/
├── docker-compose.prod.yml      # 生产编排：pg/redis/backend/nginx
├── .env.prod.example            # 环境变量模板（强随机密码占位）
├── nginx/nginx.conf             # 反向代理 + HTTPS + 安全头
├── frontend/                    # 前端静态文件（Nginx 站点根目录）
└── scripts/backup-postgres.sh   # pg_dump 定时备份（宿主 cron 调用）
```

### 安全特性

| 清单项 | 本栈落实情况 |
| --- | --- |
| 禁止复用开发 compose | `docker-compose.prod.yml` 独立于开发版 |
| PG / Redis 不暴露公网 | 删除 `ports` 段，仅容器内网被 backend 访问；swap 由 `.env` 强随机注入 |
| Nginx 只暴露 80/443 | 80 自动跳转 HTTPS，443 终结 TLS（Let's Encrypt 路径挂载） |
| 强随机密钥 | `.env.prod.example` 中 `POSTGRES_PASSWORD`/`REDIS_PASSWORD`/JWT 均要求 `openssl rand` 生成 |
| CORS 白名单 | `CORS_ALLOWED_ORIGINS` 配置为前端域名（必填，为空则仅 localhost 可访问） |
| 真实客户端 IP | `.env` 设置 `TRUST_PROXY=1`（本栈后端仅经 Nginx 访问，安全；直连部署须删除该行） |
| 数据持久化 | `pgdata` / `redisdata` 命名卷；Redis `appendonly yes` + RDB `save` 双重 |
| 定时备份 | `scripts/backup-postgres.sh`（保留 14 份，gzip） |

### 部署操作

```bash
cd backend/deploy

# 1. 准备环境变量（生成强随机值，勿留任何默认/占位）
cp .env.prod.example .env
#   - openssl rand -base64 24   (POSTGRES_PASSWORD / REDIS_PASSWORD)
#   - openssl rand -base64 64   (JWT_ACCESS_SECRET / JWT_REFRESH_SECRET)
#   - 填入 MAPILLARY_TOKEN、SMTP_*、CORS_ALLOWED_ORIGINS=https://your-domain.com

# 2. 放置前端静态资源
#    将 release 的 mma-guessr-frontend-<version>.zip 中 src/ 内容解压到 frontend/

# 3. Nginx 域名模板替换
sed -i 's/__DOMAIN__/your-domain.com/g' nginx/nginx.conf

# 4. 获取 HTTPS 证书（Let's Encrypt，任选其一）
#    方式 A（推荐，宿主机 certbot）：
certbot certonly --standalone -d your-domain.com
certbot renew  # 加入 crontab 实现自动续期；续期后需 reload nginx 容器
#    方式 B（certbot 容器）：
docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -p 80:80 certbot/certbot certonly --standalone -d your-domain.com

# 5. 构建并启动生产镜像（假定 backend image 已 push 至 ghcr，见上方 GHCR 小节）
docker compose -f docker-compose.prod.yml up -d --wait

# 6. 设置 PostgreSQL 定时备份（保留 14 份）
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/mma-guessr/backend/deploy/scripts/backup-postgres.sh >> /var/log/mma-guessr-backup.log 2>&1") | crontab -
```

> 数据库初始化：后端启动前需先执行一次迁移（运行时镜像已含编译后的 `dist/db/migrate.js` 与 `dist/db/migrations/*.sql`）：
> `docker compose -f docker-compose.prod.yml run --rm backend node dist/db/migrate.js`
> 迁移需能在生产库上读写，若 backend 容器网络内连接、运行即可；命令幂等（已应用的迁移会跳过）。

## 监控与指标

后端提供 Prometheus 文本格式指标端点 `GET /api/metrics`（HTTP 请求计数/耗时、进程内存、PostgreSQL 连接池状态、慢 SQL 日志）。生产环境务必在 `deploy/.env` 设置 `METRICS_TOKEN`：

```bash
# 生成
METRICS_TOKEN="$(openssl rand -base64 32)"
```

配置后 Prometheus 抓取需携带 Bearer 令牌：

```yaml
scrape_configs:
  - job_name: mma-guessr
    metrics_path: /api/metrics
    bearer_token: <METRICS_TOKEN>
    static_configs:
      - targets: [<server>:80]
```

慢 SQL（默认 >500ms）会输出 `db:postgres` 命名空间的 warn 日志，用于定位热点查询。

## 上线检查清单

- [ ] 打开站点根 URL，确认自动跳转到游戏页（前端静态资源已正确挂载）
- [ ] 浏览器访问 `https://<domain>/api/health` 返回 `status: ok`
- [ ] HTTP 访问 80 端口会自动 302 跳转 HTTPS
- [ ] `curl -sI https://<domain>` 响应头含 `Strict-Transport-Security` / `X-Frame-Options: DENY` / `nosniff`
- [ ] 主菜单「题库共 1570 题」及各区域题数与 `frontend/src/js/data.js` 一致
- [ ] 经典 / 挑战 / 区域 / 中国 / 无限 / 地标六种模式各跑一局
- [ ] 提交答案后红线、得分动画、结果弹窗正常
- [ ] 登录 / 注册（验证码）、每日挑战、排行榜、对战（Socket.IO 经 443 升级）可用
- [ ] 完成一局后账号面板出现「成就」图标墙，可装备称号
- [ ] 手机端横竖屏各检查一次（小地图按钮化）；桌面浏览器地址栏出现「安装应用」提示（PWA manifest/SW 生效）
- [ ] 历史记录、更新记录、分享按钮可用
- [ ] PostgreSQL 定时备份已生效：`ls backend/deploy/backups/` 存在 `mma-guessr-pg-*.sql.gz` 且非空
- [ ] 留存备份可恢复：对备份执行 `gunzip -c <file> | psql ...` 验证无报错后再归档
- [ ] 后端 `/api/health` 返回 `status: ok`

## 密钥与 Secret

- 后端环境变量见 [backend.md](backend.md)（复制 `backend/.env.example` 为 `backend/.env`，已 git 忽略）
- CI Secret：仓库 **Settings → Secrets and variables → Actions** 新建 `MAPILLARY_TOKEN`（用于街景覆盖验证，见 [locations.md](locations.md)；未配置时验证脚本直接失败）
- 生产环境必须设置强随机 `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`，勿用仓库默认值