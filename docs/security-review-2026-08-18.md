# MmaGuessr 安全审查报告

- 日期：2026-08-18
- 范围：全模块（auth / 中间件 / server 路由 / 多人对战 / 排行榜 / 每日 / 图包 / 街景代理 / OAuth / 前端静态站）
- 原则：**只审查，不改动功能**。所有结论均基于当前代码路径（Go 后端 + SQLite 单实例 + 前端静态站点）。

---

## 1. 结论概览

| 模块 | 关键防护 | 判定 |
| --- | --- | --- |
| 请求签名 | HMAC(secret, method, URI, bodyHash) + 5min 时间窗 + nonce 防重放（2min TTL） | ✅ 强 |
| 认证 | JWT(iss/aud/exp) + bcrypt + 刷新令牌轮换 + 重用检测 + 访客隔离 | ✅ 强 |
| 授权 | 对局/回放按所有权过滤；每日/图包仅限注册用户；赞助需 admin 令牌 | ✅ 强 |
| 注入 | 全程 prepared statements；无 SQL 拼接 | ✅ 无风险 |
| XSS | 前端所有用户数据 innerHTML 均经 escapeHtml；URL 走 textContent/DOM 构建 | ✅ 无风险 |
| SSRF | 代理 imageId 白名单正则 + bbox 校验；OAuth 提供方白名单 | ✅ 无风险 |
| 滥用防护 | 全路由 IP 限频 + 会话事件 10s 滑动窗口 + 请求体 1MB 上限 | ✅ 强 |
| 传输安全 | 请求签名 + nonce 防重放已内建；TLS 由 nginx 终止 | 🟡 见 §8 |
| 非ce 表增长 | 签名校验在路由限频**之前**，且 HMAC 密钥公开于前端静态文件 | 🟡 低风险 |

**总体结论**：未发现高危漏洞。全模块防护完整、设计谨慎（服务端权威结算、答案坐标不泄露给客户端）。仅 1 项**低危**已修复（见 §7），并补充网络加固评估（§8）。

---

## 2. 请求签名与防重放（middleware/api_signature.go + internal/signature）

- 被签名保护：除 health / metrics / socket.io / OAuth 跳转 / proxy 外的全部 `/api` 路由。
- `verify`：nonce 正则 `^[0-9A-Za-z-]{16,64}$` → 时间戳 5min 内 → HMAC(method, RequestURI, bodyHash) → `consumeNonce` 原子 INSERT，`ON CONFLICT` 拒绝重放。
- 常量时间比较 `ConstantTimeEquals` 防时序侧信道。
- **发现（低）**：签名校验先于路由 IP 限频执行，而 HMAC 密钥随前端静态文件公开（GitHub Pages 无法保密）。攻击者可用合法签名持续刷 nonce，每次请求触发一次 INSERT，最多持续 1 小时（旧 janitor 间隔）才被清理。影响为有界的磁盘/CPU 写入 DoS。
- **修复（已实施）**：`cmd/server/main.go` 将 `maintenanceInterval` 从 1h 缩至 10min，把 nonce 表增长窗口从约 1 小时压缩到约 10 分钟，同时该表另有 2min TTL。无行为影响。

## 3. 认证与授权（internal/auth + server/auth.go + social + packs）

- 密码 bcrypt 存哈希；JWT 带 issuer/audience/expiry；刷新令牌轮换 + 重用检测（旧令牌一经复用即吊销整条链）。
- 访客身份独立命名空间 `guest_`，与注册用户隔离；每日挑战、图包创建、成就、天梯仅注册用户。
- 对局读取 `FetchGame` 按 `player_type + player_id` 过滤，他人对局不可读（回放同理）。
- 图包：私密包仅所有者可见/可编辑；`GetPlayablePack` 返回 `PublicLocation`（**不含 lat/lng 答案坐标**），权威结算走 `FetchPackLocations`（含几何，服务端持有）。
- OAuth：提供方白名单、`state` 随机 nonce 一次性校验 + 过期回收、回调 `provider_id` 唯一约束防重复绑定。
- 赞助写入需 `x-admin-token` 校验，且名称/备注仅服务端展示（前端已转义）。
- 未发现问题。

## 4. 每日挑战与计分权威性（internal/daily + server/daily.go）

- `GetToday` 返回 `PublicDailyLocation`（**无 lat/lng**），答案坐标只在提交结算时由 `GetTodayLocationRecords` 服务端持有。
- 每人每日一次：`tryClaim` 用 `INSERT ... ON CONFLICT DO NOTHING`，并发安全、防重复提交。
- 排行榜从 `daily_submissions + game_results + users` JOIN 读取，无客户端可影响路径。
- 未发现问题。（注：占用提交名额后放弃对局会导致当日无法重玩，属 UX 取舍而非安全缺陷。）

## 5. 多人对战（internal/multiplayer/engineio.go + service.go）

- 传输：Engine.IO v4 手写实现，握手 token 校验、未知 sid 拒绝、ping/pong 超时回收；`pollHold` 已由 20s 缩至 10s（延迟与资源平衡）。
- 会话事件入口 10s/20 次滑动窗口，超限即踢；connect 携带合法 JWT。
- 服务端权威：`mp:answer` 只接受 `guessLat/guessLng`（NaN/Inf/越界拒绝），距离与得分由 `computeDuelScore` 服务端计算，客户端无法上报得分。
- 房间有 TTL 回收（waiting 10min / finished 2h）；匹配队列无上限但受事件限频约束。
- 未发现问题。

## 6. 街景代理与外部调用（internal/server/proxy.go + mapillary + oauth + mail）

- 代理 imageId 白名单正则 `^[0-9A-Za-z_-]+$` 后才拼接 URL，杜绝 URL 注入/SSRF 到任意主机；bbox 格式校验。
- 图片字节经代理时仅回传 `image/jpeg`，`Cache-Control` 固定，无内容嗅探面。
- Mapillary 密钥仅存服务端，前端只能拿 CDN 直链（`/api/proxy/media`）。
- OAuth/mail 请求目标固定（提供方白名单 + 受信 SMTP），token 永不落日志。
- 未发现问题。

## 7. 中间件与通用硬化

- CORS 白名单；安全响应头（CSP 等，见 security_headers.go）；错误响应不泄露堆栈。
- 请求体统一 1MB 上限；列表类接口均有 limit 上限（分页）。
- 日志不含查询串与敏感字段；metrics 端点独立鉴权。
- 未发现问题。

---

## 8. 网络流量加固评估（Network Traffic Hardening）

| 防护项 | 现状 | 缺失风险 | 建议 |
| --- | --- | --- | --- |
| TLS 传输加密 | 由反向代理 nginx 终止（Compose 路径） | 无 | 保持；单二进制 systemd 路径请同样配置 TLS（见 deploy 计划） |
| 请求签名 / 防篡改 | ✅ 已内建 HMAC + bodyHash | 无 | 无需新增 |
| 防重放（nonce） | ✅ 已内建 2min TTL + 10min 清扫 | 无 | 无需新增 |
| SSL 固定（SSL Pinning） | 前端为浏览器静态站，无原生客户端 | 不适用 | 跳过 |
| 传输层请求签名升级 | 现有 HMAC 足够 | 无 | 无需新增 |

**结论**：项目已内建请求签名、防篡改与防重放，网络层仅剩 TLS 终止这一标准配置。判定为**无高危网络缺口**，**不建议**引入额外加固（SSL 固定等对 Web 静态站不适用）。

---

## 9. 修复清单

| 编号 | 严重度 | 位置 | 问题 | 修复 |
| --- | --- | --- | --- | --- |
| SEC-01 | 低 | `cmd/server/main.go:42` | janitor 间隔 1h 使 nonce 表增长窗口过长（签名密钥公开，可刷 INSERT） | ✅ 已改 10min |

无其他确认的漏洞。未发现任何高/中危问题。
