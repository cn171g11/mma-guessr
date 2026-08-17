# MmaGuessr 部署指南

本文档覆盖三种部署形态：

| 形态 | 说明 | 章节 |
| --- | --- | --- |
| 前端 GitHub Pages | 静态站点托管，推荐用于前端 | §1 |
| 后端 GHCR 镜像 | 容器镜像发布（手动触发） | §2 |
| 云服务器生产栈 | docker-compose + Nginx + HTTPS + 备份 + 监控 | §3（最完整） |

---

## 0. 部署架构

```
                        ┌──────────────────────────────────────────────┐
   用户浏览器 ──HTTPS──▶│  云服务器（单一主机即可）                        │
                        │                                              │
                        │  ┌────────────────────────────────────────┐  │
                        │  │ Nginx (80/443)                         │  │
                        │  │  ├─ 静态前端 (frontend/)               │  │
                        │  │  ├─ /api/ → backend:3000 (反代+签名)   │  │
                        │  │  └─ /socket.io/ → backend:3000 (升级)  │  │
                        │  └───────────────┬────────────────────────┘  │
                        │                  │ 内网                        │
                        │  ┌───────────────▼──────────────┐  ┌────────┐│
                        │  │ backend (Go + SQLite)        │  │ certbot││
                        │  │  ├─ sqldata 卷 (/app/data)   │  │ (ACM E)││
                        │  │  └─ 无公网端口               │  └────────┘│
                        │  └──────────────────────────────┘            │
                        └──────────────────────────────────────────────┘
   前端另托管于 GitHub Pages：https://<user>.github.io/<repo>/
   （生产推荐同域反代，此时 Pages 仅作回退/开发用）
```

- 前端与后端可以**同域**（推荐：Nginx 同时托管静态文件并反代 API，Cookie 同站，无跨域问题）
- 也可以**分域**（前端 GitHub Pages + 后端独立域名），此时必须正确配置 `CORS_ALLOWED_ORIGINS` 与 `COOKIE_SAME_SITE`（见 §3.3）
- 数据库为单文件 SQLite，**单实例部署**；多人对战房间/限频在进程内存，多实例横向扩展**不支持**（如需扩展请使用反代会话亲和）

---

## 1. 前端 · GitHub Pages

### 1.1 启用（一次性）

1. 仓库 **Settings → Pages → Source** 选择 `GitHub Actions`
2. 推送 `frontend/**` 变更至 `main` 自动触发：`ci.yml`（校验）→ `deploy.yml`（发布）
3. 站点地址 `https://<user>.github.io/<repo>/`，根目录 `index.html` 自动跳转到 `frontend/src/index.html`

### 1.2 生产密钥同步（关键！）

前端为纯静态文件，**无法注入环境变量**。生产部署前必须手动修改 `frontend/src/js/config.js`：

```js
const API_SIGNING_SECRET = '<与后端 deploy/.env 相同的强随机值>';
```

- 该值必须与后端 `.env` 的 `API_SIGNING_SECRET` **完全一致**
- 修改后**提交并推送** `main` 触发重新发布
- 不一致的症状：所有在线接口返回 `400 签名校验失败`

### 1.3 本地校验

```bash
cd frontend
npm ci                       # 安装 Prettier（开发工具）
npm run format:check         # 代码风格
for f in src/js/*.js; do node --check "$f"; done   # JS 语法
node tools/validate-data.js  # 题库校验（1570 题）
```

### 1.4 自定义域名（可选）

1. 仓库 **Settings → Pages** 填入域名
2. DNS 添加 `CNAME`（或 `ALIAS`）→ `<user>.github.io`
3. 等待生效后访问验证

> 注意：`deploy.yml` 的 `paths-ignore` 包含 `backend/**` 与 `docs/**`——只改后端/文档不会触发前端发布。

---

## 2. 后端 · GHCR 镜像

后端镜像**不随 push 自动构建**，全部手动触发：

| 入口 | 方式 | 产物 |
| --- | --- | --- |
| `backend.yml` | Actions 页手动运行，`mode=image` | `ghcr.io/<owner>/<repo>-backend`（`latest` + 提交 SHA，linux/amd64 + arm64） |
| `release.yml` | Actions 页手动运行，填 `version` | 整体发布：质量门禁 → 前端 Pages → 多架构镜像 `:版本号` → Git 标签 → GitHub Release（附跨平台产物 + SHA256 校验和） |

`release.yml` 的 Release 产物：

- `mma-guessr-frontend-<version>.zip`：前端静态包，解压 `src/` 部署到任意静态服务器
- `mma-guessr-backend-<version>.zip`：后端单二进制（linux/darwin/windows × amd64/arm64），无运行时依赖，环境变量见 `.env.example`

> 安全说明：所有第三方 Actions 已按 commit SHA 固定（防供应链投毒）；workflow 权限按 job 最小化授予。

---

## 3. 后端 · 云服务器生产部署

### 3.1 前置条件

- 一台 Linux 服务器（建议 ≥1GB 内存、1 核、10GB 磁盘；项目运行峰值约 500MB 内存）
- Docker Engine ≥ 24 + Docker Compose v2 插件
- 一个已解析到服务器 IP 的域名（A/AAAA 记录）
- 开放入站端口：`80`、`443`；`22`（SSH，建议仅限你的 IP）

### 3.2 目录结构

```
backend/deploy/
├── docker-compose.prod.yml      # 生产编排：backend + nginx + certbot
├── .env.prod.example            # 环境变量模板（强随机密钥占位）
├── nginx/nginx.conf             # 反代 + HTTPS + 安全头 + WebSocket + gzip/缓存
├── frontend/                    # 前端静态文件（Nginx 站点根目录）
└── scripts/backup-sqlite.sh     # SQLite 定时备份（宿主 cron 调用）
```

### 3.3 安全特性

| 清单项 | 落实方式 |
| --- | --- |
| 无外部服务依赖 | 单容器后端（Go + SQLite），攻击面最小 |
| 数据库不暴露公网 | SQLite 仅容器内访问；Nginx 只暴露 80/443 |
| 强随机密钥 | 生产缺失/默认值直接拒绝启动（见 §3.4） |
| CORS 白名单 | `CORS_ALLOWED_ORIGINS` 必填为前端域名；同域部署可保持默认 localhost |
| 真实客户端 IP | `TRUST_PROXY=1`（后端仅经 Nginx 访问时启用；直连部署必须删除） |
| 数据持久化 | `sqldata` 命名卷挂载 `/app/data` |
| 定时备份 | `backup-sqlite.sh`（`VACUUM INTO` 一致性快照，保留 14 份，gzip） |
| 证书自动续期 | certbot 容器 webroot 模式，宿主 cron 每 12h 检查续期 |
| 容器加固 | 只读根文件系统 + 禁提权 + 内存/CPU 上限；nginx 仅保留绑定 80/443 能力 |
| 日志轮转 | 全部容器 json-file，单文件 10MB × 3 份 |
| 载荷填充 | `PAYLOAD_PADDING=1` 混淆响应长度指纹（推荐启用） |
| 请求签名/防重放 | HMAC-SHA256 + nonce 原子去重（服务端强制） |

### 3.4 密钥生成（完整清单）

```bash
cd backend/deploy
cp .env.prod.example .env

# 以下命令生成后手动填入 .env（也可用脚本一次性替换）
openssl rand -base64 64   # → JWT_ACCESS_SECRET
openssl rand -base64 64   # → JWT_REFRESH_SECRET
openssl rand -base64 48   # → VERIFY_CODE_SECRET
openssl rand -base64 32   # → METRICS_TOKEN
openssl rand -base64 32   # → API_SIGNING_SECRET
openssl rand -base64 32   # → SPONSOR_ADMIN_TOKEN（可选，赞助写端点）
openssl rand -base64 32   # → OAUTH_STATE_SECRET（仅启用 Google 登录时必填）
```

同时填写：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `MAPILLARY_TOKEN` | 你的密钥 | Mapillary API 密钥（仅服务端持有） |
| `SMTP_HOST/PORT/USER/PASS/FROM` | 邮件服务商配置 | 验证码邮件；未配置则验证码打印到日志（生产不建议） |
| `CORS_ALLOWED_ORIGINS` | `https://你的域名` | 分域部署必填；同域可留空（默认 localhost） |
| `COOKIE_SAME_SITE` | `lax`（同域）/ `none`（跨域 HTTPS） | 见 §3.8 |
| `GOOGLE_OAUTH_*` | 可选 | 第三方登录（见 backend.md） |
| `PAYLOAD_PADDING` | `1` | 推荐启用载荷填充 |

> 密钥泄露处理：修改 `.env` 中对应密钥 → 重启后端 → 所有存量会话失效，用户重新登录（安全兜底）。

### 3.5 部署操作（分步）

```bash
cd backend/deploy

# ① 准备环境变量（见 §3.4）
cp .env.prod.example .env
vi .env                                    # 填入全部强随机值与业务配置

# ② 同步前端请求签名密钥（关键！见 §1.2）
#    修改 frontend/src/js/config.js 的 API_SIGNING_SECRET 为与 .env 相同值 → 提交推送

# ③ 放置前端静态资源（同域部署时）
#    将 release 的 mma-guessr-frontend-<version>.zip 解压，src/ 内容放入 frontend/
#    或直接：rsync -av --exclude node_modules ../frontend/src/ ./frontend/
#   （仅同域托管时需要；分域部署时由 GitHub Pages 托管，此步跳过）

# ④ Nginx 域名模板替换（所有 __DOMAIN__ 占位）
sed -i 's/__DOMAIN__/your-domain.com/g' nginx/nginx.conf
grep -c '__DOMAIN__' nginx/nginx.conf      # 应为 0

# ⑤ 启动生产栈（先拉取镜像）
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --wait

# ⑥ 验证后端健康
curl -s https://your-domain.com/api/health  # 期望 {"status":"ok",...}

# ⑦ 首次申请证书（webroot 复用 nginx 80 端口）
docker compose -f docker-compose.prod.yml exec certbot certbot certonly \
    --webroot -w /var/www/certbot -d your-domain.com \
    --email admin@your-domain.com --agree-tos --no-eff-email
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# ⑧ 导入题库（首次部署执行一次，幂等）
#    方式 A：本地生成数据库后拷贝进卷
cd ../../backend && SQLITE_PATH=mma_guessr.db go run ./cmd/seed -data ../frontend/src/js/data.js
docker cp mma_guessr.db mma-guessr-backend:/app/data/mma_guessr.db
rm mma_guessr.db
#    方式 B：跳过 seed（题库为空时前端仍可加载，后续可再导入）

# ⑨ 安装两个宿主 cron（证书续期 + 数据库备份）
DEPLOY_DIR="$(pwd)"
# 证书续期（每 12h；续期成功才 reload nginx）
(crontab -l 2>/dev/null; echo "0 */12 * * * docker compose -f $DEPLOY_DIR/docker-compose.prod.yml exec -T certbot certbot renew --webroot -w /var/www/certbot --quiet && docker compose -f $DEPLOY_DIR/docker-compose.prod.yml exec -T nginx nginx -s reload") | crontab -
# SQLite 备份（每日 02:00，保留 14 份）
(crontab -l 2>/dev/null; echo "0 2 * * * $DEPLOY_DIR/scripts/backup-sqlite.sh >> /var/log/mma-guessr-backup.log 2>&1") | crontab -
crontab -l | grep -E 'certbot|backup'      # 确认两条任务已安装

# ⑩ 按 §6 上线检查清单逐项验收
```

### 3.6 证书管理

```bash
# 查看证书状态与过期时间
docker compose -f docker-compose.prod.yml exec certbot certbot certificates

# 手动强制续期（未到期会跳过）
docker compose -f docker-compose.prod.yml exec certbot certbot renew --force-renewal
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# 证书过期排查
openssl x509 -in <(docker compose exec nginx cat /etc/letsencrypt/live/<域名>/cert.pem) -noout -dates
```

Let's Encrypt 证书有效期 90 天；cron 每 12h 检查一次，距到期 30 天内才会真正续期。

### 3.7 备份与恢复

#### 备份（自动）

```bash
# cron 已配置每日备份（§3.5 步骤⑨）；手动触发一次验证：
backend/deploy/scripts/backup-sqlite.sh
ls -la backend/deploy/backups/            # 出现 mma-guessr-sqlite-<时间戳>.db.gz
```

备份原理：`docker compose exec` 进入容器，用 `sqlite3 'VACUUM INTO ...'` 生成**一致性快照**（不锁库、不中断服务），gzip 压缩后落宿主 `backups/`，保留 14 天。

#### 恢复（演练步骤）

```bash
# 1. 找到目标备份
ls -t backend/deploy/backups/*.gz | head -1

# 2. 验证备份完整性（必做）
gunzip -c backups/mma-guessr-sqlite-xxx.db.gz | sqlite3 /tmp/restore-check.db
sqlite3 /tmp/restore-check.db 'PRAGMA integrity_check;'   # 期望 ok

# 3. 停止后端 → 覆盖数据库 → 启动
docker compose -f backend/deploy/docker-compose.prod.yml stop backend
gunzip -c backups/mma-guessr-sqlite-xxx.db.gz > /tmp/restore.db
docker cp /tmp/restore.db mma-guessr-backend:/app/data/mma_guessr.db
docker compose -f backend/deploy/docker-compose.prod.yml start backend

# 4. 验证恢复结果
curl -s https://<域名>/api/health && curl -s https://<域名>/api/leaderboard  # 数据应恢复
```

> 建议每季度做一次恢复演练；备份文件建议异机/对象存储同步一份（如 rclone 到 S3）。

### 3.8 分域部署（前端 Pages + 后端独立域名）

同域部署无需本节。分域时：

1. `CORS_ALLOWED_ORIGINS=https://<pages域名>`
2. `COOKIE_SAME_SITE=none`（跨站 Cookie 需要 SameSite=None + Secure，仅 HTTPS 生效）
3. Nginx 静态目录可留空（前端不在此托管）
4. 前端 `config.js` 的 `API_BASE` 保持空串即可（同域不可用，改为 `https://<api域名>` 前缀）：
   ```js
   const API_BASE = window.location.hostname.includes('<pages域名>') ? 'https://<api域名>' : '';
   ```
5. 注意：分域部署的刷新 Cookie 依赖 `SameSite=None`，部分旧浏览器/隐私模式可能受限，**优先推荐同域**

---

## 4. 监控与告警

### 4.1 Prometheus 抓取

后端暴露 `GET /api/metrics`（Prometheus 文本格式），需 `METRICS_TOKEN` Bearer 鉴权：

```yaml
# prometheus.yml
scrape_configs:
  - job_name: mma-guessr
    metrics_path: /api/metrics
    bearer_token: <METRICS_TOKEN>
    static_configs:
      - targets: ['<server-ip>:443']
    scheme: https
```

可用指标（示例）：

```
http_requests_total{method,path,status}   # 请求计数（按路由聚合）
http_request_duration_seconds              # 请求耗时直方图
go_goroutines / process_resident_memory_bytes  # 运行时指标
```

### 4.2 建议告警规则

```yaml
groups:
  - name: mma-guessr
    rules:
      - alert: MmaGuessrDown
        expr: up{job="mma-guessr"} == 0
        for: 5m
      - alert: MmaGuessrHighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
        for: 10m
      - alert: MmaGuessrNoBackup
        expr: time() - mma_guessr_last_backup_timestamp > 172800   # 需自建备份时间指标，或改用 cron 健康探针
        for: 1h
```

（备份健康建议直接用 cron 探针：备份脚本失败时 `exit 1`，配合宿主监控或 `cron` 邮件通知即可。）

### 4.3 日志查看

```bash
docker compose -f backend/deploy/docker-compose.prod.yml logs -f backend      # 实时日志
docker compose -f backend/deploy/docker-compose.prod.yml logs --tail=200 backend
docker logs mma-guessr-backend 2>&1 | grep -i "error"                          # 过滤错误
```

日志为结构化 JSON（slog），可用 `jq` 过滤：`docker logs mma-guessr-backend 2>&1 | jq 'select(.level=="ERROR")'`。

---

## 5. 升级与回滚

### 5.1 后端升级

```bash
cd backend/deploy
# ① 生成新镜像（或 pull 已发布的新版本）
docker compose -f docker-compose.prod.yml pull

# ② 升级前备份数据库（保险）
./scripts/backup-sqlite.sh

# ③ 滚动重启（数据在卷中保留）
docker compose -f docker-compose.prod.yml up -d

# ④ 验证
curl -s https://<域名>/api/health
```

### 5.2 前端升级

推送 `frontend/**` 至 `main` → CI 校验 → Pages 自动发布。同域部署时把新前端静态文件同步到 `backend/deploy/frontend/`：

```bash
rsync -av --delete --exclude node_modules ../frontend/src/ backend/deploy/frontend/
```

### 5.3 回滚

- **后端**：`docker compose -f docker-compose.prod.yml up -d <旧镜像tag>`（先备份当前库）
- **前端**：`git revert <发布提交>` 并推送，Pages 回滚到上一版本；同域则 rsync 旧文件
- **数据库**：按 §3.7 恢复流程用备份回滚

> 重要：镜像 tag 用版本号（如 `:1.19.0`）而非 `latest`，回滚时指向旧 tag 即可。

---

## 6. 上线检查清单

### 功能与连接

- [ ] 打开站点根 URL，正常跳转到游戏页
- [ ] 浏览器访问 `https://<domain>/api/health` 返回 `status: ok`
- [ ] HTTP 访问 80 端口自动 302 → HTTPS
- [ ] `curl -sI https://<domain>` 含 `Strict-Transport-Security` / `X-Frame-Options: DENY` / `nosniff` / `Permissions-Policy`
- [ ] 主菜单题库 1570 题，各区域题数与 data.js 一致
- [ ] 经典/挑战/区域/中国/无限/地标六种模式各跑一局
- [ ] 登录/注册（验证码邮件）、每日挑战、排行榜、对战（Socket.IO 升级）可用
- [ ] 好友/天梯/图鉴/回放/赞助/冷知识面板正常
- [ ] 手机横竖屏各检查一次；PWA 可安装
- [ ] 前端 `API_SIGNING_SECRET` 与后端一致：在线功能无 `400 签名校验失败`

### 安全

- [ ] 已签发证书：`docker compose exec nginx ls /etc/letsencrypt/live/<domain>` 有 fullchain.pem
- [ ] 证书续期 cron 已装：`crontab -l | grep certbot`
- [ ] 后端启动无密钥告警（`docker logs mma-guessr-backend | grep -i error` 为空）
- [ ] `.env` 文件权限收紧：`chmod 600 .env`
- [ ] 服务器防火墙仅开放 80/443/22

### 数据

- [ ] 备份 cron 已装：`crontab -l | grep backup`
- [ ] 至少一份备份存在且非空：`ls backend/deploy/backups/`
- [ ] 备份可恢复验证通过（§3.7 恢复演练步骤 2）

---

## 7. 密钥与 Secret 管理

| 类别 | 位置 | 说明 |
| --- | --- | --- |
| 后端运行密钥 | `backend/deploy/.env` | 生产强随机值，`chmod 600`，不入库 |
| 前端签名密钥 | `frontend/src/js/config.js` | 与后端 `.env` 的 `API_SIGNING_SECRET` 一致（静态文件，最终公开，仅防篡改/重放） |
| CI Secrets | 仓库 Settings → Secrets → Actions | `MAPILLARY_TOKEN`（街景覆盖验证）；`GITHUB_TOKEN` 自动注入 |
| 开发环境 | `backend/.env.example` | dev 默认值仅供本地，生产拒绝默认值启动 |

轮换流程：改 `JWT_*` / `VERIFY_CODE_SECRET` / `API_SIGNING_SECRET` → 同步前端 → 重启后端 → 全部会话重新登录。

---

## 8. 故障排查速查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 后端启动即退出，报 `missing required environment variable` | `.env` 缺密钥或用默认值 | 补强随机值后 `up -d` |
| 在线功能全挂，接口 `400 签名校验失败` | 前端/后端 `API_SIGNING_SECRET` 不一致 | 两端改为同一值，重新发布/重启 |
| 80 端口不跳 HTTPS / 证书告警 | 未申请或已过期 | §3.5 步骤⑦申请；检查续期 cron |
| 备份报 `backend 镜像缺少 sqlite3 CLI` | 镜像过旧 | 拉取最新镜像重试 |
| 验证码收不到 | SMTP 未配置 | 配置 SMTP；开发模式验证码打印在日志 |
| Socket.IO 连接失败 | nginx 升级头缺失 / 反向代理超时 | 检查 `/socket.io/` 的 Upgrade 头配置 |
| 请求签名 400 且日志 `nonce 已使用` | 客户端重放或时钟偏差 >5min | 检查服务器时间同步（ntp）；浏览器缓存清一下 |
| 排行榜/天梯数据异常 | 跨实例部署（进程内存限频/队列） | 保持单实例；确认未多副本 |
| CORS 跨域报错 | 分域部署未配白名单 | 检查 `CORS_ALLOWED_ORIGINS` 与 `COOKIE_SAME_SITE=none` |
| 磁盘满 | 日志/备份堆积 | `docker system prune`；检查日志轮转与备份保留天数 |

---

## 9. 运维速查表

```bash
# ---- 服务管理（backend/deploy 目录下） ----
docker compose -f docker-compose.prod.yml ps                    # 状态
docker compose -f docker-compose.prod.yml up -d                  # 启动
docker compose -f docker-compose.prod.yml down                   # 停止（保留卷）
docker compose -f docker-compose.prod.yml down -v                # 停止并删除卷（⚠️ 清空数据）
docker compose -f docker-compose.prod.yml logs -f backend        # 日志
docker compose -f docker-compose.prod.yml restart backend        # 重启

# ---- 数据 ----
docker volume ls | grep sqldata                                  # 数据卷
./scripts/backup-sqlite.sh                                       # 手动备份
ls -la backups/                                                  # 查看备份

# ---- 证书 ----
docker compose exec certbot certbot certificates                 # 证书状态
docker compose exec nginx nginx -s reload                        # 重载配置

# ---- 验证 ----
curl -s https://<域名>/api/health                                # 健康
curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://<域名>/api/metrics | head
```

---

## 10. 常见问题（FAQ）

**Q1：必须用 GitHub Pages 托管前端吗？**
不必须。同域部署（Nginx 托管）是推荐形态；GitHub Pages 适合纯前端场景或分域部署。

**Q2：能多实例横向扩展吗？**
不支持。多人对战房间、滑动窗口限频在进程内存；SQLite 单文件也不适合多写者。单机单实例是设计边界。

**Q3：数据库会无限增长吗？**
后端 janitor 会定期清理过期 nonces/验证码/刷新令牌/游客会话/缓存；`game_results` 等业务表按需手动归档。

**Q4：如何更换域名？**
改 `nginx/nginx.conf` 的 `server_name` 与证书路径 → 重新签发证书 → 更新 `CORS_ALLOWED_ORIGINS` → reload nginx。

**Q5：`PAYLOAD_PADDING` 是什么？**
网络加固项：给 JSON 对象响应注入随机 `_pad` 字段，混淆流量长度指纹。数组与文本端点不受影响，前端无需适配（忽略未知字段）。
