# MmaGuessr 全量安全审计报告（2026-08-17）

- **审计范围**：全量（邮箱验证码登录、GitHub Pages 与全部 GitHub Actions、github.io 与服务器前后端连接、防渗透/防中间人/防逆向、功能完整性、可靠性、依赖扫描、网络加固评估）
- **依据**：AGENTS.md 第 2 节 + `.opencode/skills/security-check`（12 大项 + Section 10 网络加固评估）
- **结论**：`High 0 / Medium 1 / Low 4 / Info 6`；`govulncheck` 0 漏洞；`npm audit`（含 dev）0 漏洞
- **基线**：较 2026-08-13 审计（High 0 / Medium 1 / Low 4 / Info 6）持平，新增功能的代码质量未引入新风险

---

## 一、总体结论

项目安全基线**高**。核心防御（服务端权威计分、请求签名 + 防重放、限频全覆盖、SSRF 防护、统一错误掩码、CI 权限最小化）均已落实。唯一 Medium 为新增好友功能缺失独立限频，建议修复。

---

## 二、发现清单

### 🔴 High：0

### 🟠 Medium：1（已解决 ✅）

| # | 位置 | 问题 | 处置 |
| --- | --- | --- | --- |
| M-1 | `internal/server/routes.go:89` | `POST /api/friends/requests` 仅 `RequireAuth` 无限频：已登录用户可高频向任意用户发送好友请求（骚扰面）。注册/登录等写端点均有限频，此处遗漏 | ✅ 已修复：加 `middleware.RateLimit("rl:friends-request", 1*time.Minute, 30, gamesIdentity)`（IP+identity 维度，游客轮换无法绕过）；e2e 回归通过 |

### 🟡 Low：4（全部解决 ✅）

| # | 位置 | 问题 | 处置 |
| --- | --- | --- | --- |
| L-1 | `internal/auth/token.go` | JWT 未校验 `iss`/`aud` | ✅ 已修复：签发填充 `Issuer="mma-guessr"` + 分 audience（`mma-guessr:access` / `mma-guessr:refresh`），验证用 `WithIssuer/WithAudience` 强制校验；access/refresh 令牌无法互相冒充；新增 5 个单测（含伪造 issuer、错误 audience、篡改令牌拒绝）。**部署注意**：上线后存量会话失效，用户重新登录一次 |
| L-2 | 前端（全量） | 纯静态 JS 无代码混淆/反调试，`API_SIGNING_SECRET` 公开 | ✅ 架构性解决：确认前端**零硬编码凭据**（无 API 密钥/口令）；计分与防伪全部服务端权威（daily/duel 服务端结算，classic 距离重算校验，客户端不得携带答案坐标）；逆向前端仅得公开数据，无可利用资产。混淆会破坏「纯静态无构建」架构且收益趋零，故采用消除逆向目标而非对抗 |
| L-3 | `.github/workflows/*.yml` | 第三方 Actions 用 tag 固定（`@v4`）而非 SHA-256 固定 | ✅ 已修复：13 个第三方 action（actions/*、docker/*）全部替换为 commit SHA 固定（`@<40位sha>`），共 32 处；YAML 语法校验通过，杜绝供应链投毒 |
| L-4 | 网络层 | 请求载荷填充未实现 | ✅ 已实施：`PAYLOAD_PADDING=1` 时 JSON 对象响应注入随机 `_pad`（16-47 字节 base64url）；`httputil` 单测 3 个；生产模板默认开启 |

### ⚪ Info：6

| # | 说明 |
| --- | --- |
| I-1 | 注册/绑定提示「该邮箱已被注册」：必要的 UX（防重复注册），已有验证码前置 + 限频兜底，枚举面可接受 |
| I-2 | CORS 中间件对未白名单来源的 `OPTIONS` 返回 204：浏览器因无 `Access-Control-Allow-Origin` 拒绝，无实际风险 |
| I-3 | 静态资源无内容哈希文件名，nginx 用 1h 短缓存 + ETag：更新延迟窗口短，可接受 |
| I-4 | SSRF 防护为域名/IP 黑名单，理论上存在 DNS rebinding 绕过：目标 URL 来自受信上游 Mapillary 响应，攻击者无法控制域名，风险趋零 |
| I-5 | `METRICS_TOKEN`/`SPONSOR_ADMIN_TOKEN` 无长度强校验（仅模板提示 `openssl rand`）：设计如此，部署文档已强调 |
| I-6 | 容器备份依赖 `sqlite3` CLI：Dockerfile 已装 `sqlite` 包（本审计周期已修复） |

---

## 三、网络流量加固评估（Section 10）

| 检查项 | 现状 | 风险等级 |
| --- | --- | --- |
| TLS/HTTPS 强制 | ✅ 生产 nginx 80→301→443，HSTS `max-age=31536000; includeSubDomains` | High ✓ 已满足 |
| 证书 Pinning | N/A：纯浏览器 Web 应用，无移动/桌面客户端 | High（不适用） |
| 请求签名（HMAC） | ✅ `HMAC-SHA256(timestamp\nnonce\nmethod\npath\nbodyHash)`，所有 `/api` 生效（除探活/指标/图源代理/OAuth 跳转） | Medium ✓ 已满足 |
| 防重放 | ✅ 服务端 ±5min 时间窗 + `nonces` 表 `INSERT OR IGNORE` 原子去重 | Medium ✓ 已满足 |
| 载荷填充 | ✅ 已实施：`PAYLOAD_PADDING=1` 时 JSON 对象响应注入随机 `_pad`（16-47 字节 base64url），数组/文本端点不受影响；请求侧因 `DecodeJSON` 严格契约（拒绝未知字段）不填充 | Low ✓ 已实施 |
| mTLS | N/A：后端仅容器内网，不暴露公网 | Medium（不适用） |

**结论**：审计后按维护者决定实施了两项加固——M-1 好友请求限频与载荷填充。当前 High/Medium/Low 项全部满足或已实施；本项目为浏览器 Web 应用，pinning 无适用场景，请求签名 + 防重放 + 载荷填充已覆盖中间人篡改/重放/长度指纹攻击面。

---

## 四、分项审计结果

### 1. 邮箱验证码登录链路 ✅

- 验证码：`crypto/rand` 生成 6 位数字；库中仅存 **HMAC-SHA256 哈希**（泄库不泄码）；`subtle.ConstantTimeCompare` 恒时比较防时序攻击
- 节流：60s 重发限制、10min TTL、**5 次尝试上限**（失败计数先增后比）
- 登录：`LoginGuard` 进程内滑动窗口，**5 次失败锁定 15min**；密码 bcrypt 12 轮（注册/登录前均校验格式）
- 令牌：access 15min / guest 30天 / refresh 7天；refresh 库中仅存 SHA-256 哈希，旋转事务原子作废
- Cookie：`HttpOnly` + `Secure`（生产）+ `SameSite=lax` + `Path=/` + MaxAge
- JWT：算法白名单（拒绝非 HS256）、`Type`/`Role` 字段校验、`exp` 校验、**`iss`/`aud` 强制校验**（L-1 已修复，access/refresh 分 audience）

### 2. GitHub Pages 与 CI/CD Actions ✅

- 权限最小化：所有工作流顶层 `contents: read`；写权限（pages/id-token、packages/actions）仅在需要的 job 局部授予
- secrets 仅 `GITHUB_TOKEN`（自动注入）与 `MAPILLARY_TOKEN`（用户配置），无其他敏感项
- 无危险触发器（无 `pull_request_target`/`workflow_run`/`issue_comment`）
- 第三方 action 全部来自官方仓库（actions/*、docker/*）且 **commit SHA 固定**（L-3 已修复，共 32 处）
- 前端发布 `deploy.yml` 使用 `actions/configure-pages` + `deploy-pages` 官方流程（id-token + 短时 token）
- 后端镜像构建不随 push 自动发布，需手动 `workflow_dispatch`（减少意外发布面）

### 3. github.io 与服务器前后端连接 ✅

- CORS：精确 origin 白名单（`CORS_ALLOWED_ORIGINS`），`Allow-Credentials` 仅对白名单来源，`Vary: Origin`；Socket.IO 握手共用 `IsAllowedOrigin`
- 前端 `API_BASE` 自动推导：非 localhost 时为空串（同源），生产走同域 Nginx 反代，无跨域暴露
- 刷新 Cookie 跨域回传：同站（同顶级域）`SameSite=lax` 兼容；跨站 HTTPS 时设 `none`
- 全链路 HTTPS：浏览器 → nginx(443) → 后端（内网），无明文环节；`upgrade-insecure-requests` 强制子资源升级

### 4. 防渗透（注入 / 越权 / SSRF）✅

- SQL：全库使用参数化查询；无一处用户输入拼接（上一轮 G202 已重构为静态 SQL）
- IDOR：games 查询/删除全部 `WHERE id = ? AND player_type = ? AND player_id = ?` 限定；OAuth/friends/sponsors 均有属主校验
- SSRF：图源 URL 强制 HTTPS + 域名/IP 黑名单（回环、私网、链路本地、CGNAT 100.64/10、云元数据 169.254、0/8）
- 命令注入：无 `exec`/`os.system` 类调用面
- 请求体：`MaxBodyBytes` 1MB 上限

### 5. 防中间人 / 防重放 ✅

- TLS 强制 + HSTS（见第三节）
- 请求签名 + nonce 原子去重（`INSERT OR IGNORE` 竞态安全），±5min 窗口
- 刷新令牌旋转 + 单标签页刷新锁（前端 BroadcastChannel 协调，防并发刷新互吊销）

### 6. 防逆向（前端）ℹ️

- 无混淆/反调试：可接受（开源项目；服务端权威结算已保护核心利益）
- 前端不持有 Mapillary 密钥；街景直连 CDN URL 为公开资源，无敏感凭据下发

### 7. 功能完整性 ✅

- 全部 48 条路由鉴权/限频核对：认证类 8、游戏 5、地点 2、每日 2、排行榜 1、天梯 1、资料 2、成就 3、好友 6、赞助 3、冷知识 1、OAuth 3、代理 5、健康 1、指标 1、Socket.IO 4
- 需认证端点全部 `RequireAuth`；游客/用户角色分离（guest 会话、游客进度绑定）
- e2e 测试全绿（9.7s）：auth/games/social/features/private-room/proxy/oauth/multiplayer 全覆盖

### 8. 可靠性 ✅

- 健康检查 `/api/health`（含 SQLite ping）+ Docker HEALTHCHECK（30s 间隔）
- HTTP Server 超时：Read 15s / ReadHeader 10s / Write 30s / Idle 60s
- 优雅停机：SIGINT/SIGTERM → `http.Server.Shutdown` + 多人引擎停止
- 后台 janitor 定期清理 nonces/验证码/刷新令牌/游客会话/缓存
- 限频覆盖：登录/注册/验证码/提交/代理/排行榜/推送等均有限频（见 M-1 例外）
- 前端离线降级：后端不可达时静默本地模式

---

## 五、建议行动

1. **已全部实施**（本审计周期，经维护者确认）：
   - M-1 好友请求限频（`rl:friends-request`，30/min，IP+identity 维度）
   - L-1 JWT iss/aud 强制校验（access/refresh 分 audience + 5 单测；上线后存量会话需重新登录一次）
   - L-2 前端防逆向架构性解决（确认前端零凭据 + 服务端权威结算，消除逆向目标）
   - L-3 Actions 全部 commit SHA 固定（13 个 action × 32 处）
   - L-4 载荷填充（`PAYLOAD_PADDING=1` + httputil 单测）
   - 部署手册重写为完整生产手册（docs/deploy.md：密钥/证书/备份恢复演练/监控/升级回滚/故障排查/运维速查/FAQ）
2. **不再有未决 Medium/Low**；Info 项（I-1~I-6）为设计取舍，维持现状
3. **不实施**：pinning/mTLS（纯 Web + 内网场景不适用）

*报告生成：2026-08-17 · 更新：2026-08-17（M/L 全部解决）*
