# MmaGuessr 全量安全审计报告

- **审计时间**：2026-08-13
- **审计范围**：backend/src、frontend/src、配置与 .env、数据库迁移、CI/CD、Docker/部署、第三方依赖
- **审计依据**：`.opencode/skills/security-check/SKILL.md`（12 大项）+ `AGENTS.md` 安全审计规范
- **依赖扫描**：`npm audit`（backend 367 依赖 / frontend 1 依赖）——**均为 0 个已知漏洞**

---

## 一、总体结论

这是一个安全基线**明显高于同类型开源项目**的全栈应用。后端在认证、会话、注入、越权、限流、SSRF、供应链等核心领域均做了扎实且专业的防护（大量 `timingSafeEqual` 常量时间比较、原子化 Lua 脚本防 TOCTOU、Redis 滑动窗口限流 + 进程内兜底、生产配置强制强随机密钥等）。

**风险分布**：`High × 0`、`Medium × 1`、`Low × 4`、`Info × 6`。无高危漏洞，无需紧急处置；唯一 Medium 项是「非每日模式的成绩校验可被伪造」，属游戏完整性（防作弊）层面的设计权衡，而非数据泄露或越权。

---

## 二、逐项审计结果（对照 security-check 12 大项）

### 1. 密钥、凭据与环境变量 ✅ 通过
- **源码零硬编码密钥**：`git ls-files` 确认仓库仅跟踪 `.env.example`（占位符）；`backend/.env` 已被 `.gitignore` 忽略、未入 git。
- CI 含「拒绝硬编码 Mapillary token」的 `grep` 扫描步骤（`backend-checks.yml`/`ci.yml`/`deploy.yml`）。
- `config/env.ts` 的 `requiredSecret()` 强制密钥 ≥ 32 字节，且生产环境禁止使用开发默认值、缺失即拒绝启动。
- Mapillary token 仅服务端持有，经代理调用，永不下发前端。

### 2. 注入防御（SQL/NoSQL/命令/模板）✅ 通过
- 全部 SQL 使用 `pg` 参数化占位符（`$1/$2/...`），**无字符串拼接**；动态过滤条件也通过占位符列表构建（`locations/repository.ts`）。
- 无 `eval`/`exec` 于运行时用户输入路径。唯一 `eval` 在 `scripts/seed-locations.mjs`，解析对象是仓库内可信的 `data.js`（构建期脚本，见 Info-6）。

### 3. 认证与会话 ✅ 通过（含 1 处 Low）
- 密码 bcrypt（12 轮）；登录对「账号不存在」执行假 bcrypt 比较，抹平时序差防账号枚举（`accounts.ts`）。
- JWT 固定算法 `HS256`（显式指定，防算法混淆）、access 15 分钟 / refresh 7 天、含 `jti` 与 `role`/`type` 声明。
- 刷新令牌仅存 Redis 哈希（SHA-256），换发用 Lua 脚本原子完成（防 TOCTOU 并发双刷）。
- 刷新令牌走 `HttpOnly + Secure(生产) + SameSite` Cookie；access 令牌仅存前端内存（不走 localStorage）。
- 邮箱验证码 HMAC 哈希存储、5 次尝试上限、60s 重发锁、`timingSafeEqual` 比较。
- **Low-3**：JWT 使用对称 `HS256` 且未校验 `iss`/`aud`。单服务部署下可接受；若未来多服务共享令牌，建议迁移 RS256/ES256 并校验 `iss`/`aud`。

### 4. 授权与访问控制（IDOR/RBAC）✅ 通过
- 所有玩家数据查询均带 `player_type = $n AND player_id = $n` 双键过滤（games/profile/leaderboard 等），无横向越权。
- 游客/注册用户角色在令牌声明中区分，`requireAuth`/`requireRegisteredUser` 服务端强制。
- 游戏删除、成就、称号装备均校验归属。

### 5. 数据保护 ✅ 通过
- 密码仅存 `password_hash`（bcrypt），API 返回 DTO（`toPublicProfile`）不含哈希。
- 日志不落密码/验证码明文（生产）；邮箱在日志中脱敏 `maskEmail`；刷新令牌仅存哈希。
- PII（邮箱/用户名）未做落库加密——本项目不涉及身份证/银行卡等强敏感数据，风险可接受。

### 6. 输入校验与输出编码（XSS/CSRF）✅ 通过
- 全路由用 `zod` 白名单校验（类型/长度/范围/格式），如 `roundSchema` 对 lat/lng/score/距离均限界。
- 前端 `escapeHtml` 应用于用户可控字符串（用户名/区域名/得分）；URL 场景走 DOM 构建而非 innerHTML（`game.js`/`mp.js`）。
- 用户名注册限 `[a-zA-Z0-9_]{3,20}`，天然阻断通过用户名注入 XSS。
- CSP（meta + Nginx 双下发）、CDN 依赖 SRI 锁定；状态变更接口依赖 HttpOnly Cookie 的 SameSite 防 CSRF。

### 7. 安全配置（CORS/头/错误处理）✅ 通过
- CORS 白名单精确匹配、无 `*`；`credentials` 开启但来源严格受限（生产必须显式配置域名）。
- 安全头齐全：`nosniff`/`X-Frame-Options: DENY`/`Referrer-Policy`/CSP/HSTS（生产）。
- 错误处理统一返回 `Internal Server Error`，不泄露堆栈/SQL 细节（`errorHandler.ts`）。

### 8. 文件上传与 SSRF ✅ 通过（含 1 处 Low）
- 无文件上传端点。图源代理（`/api/proxy/*`）仅访问硬编码的 `https://graph.mapillary.com`，imageId/bbox 均严格正则校验，图片大小上限 1MB、超时 10s、宽度归一化到 256/1024/2048 三档。
- **Low-4**：`fetchImageBuffer` 直接跟随 Mapillary API 返回的 `thumb_*_url`，未校验该 URL 域名是否属于 Mapillary CDN。上游被攻陷时可诱导 SSRF；已被 `image/jpeg` 响应头 + CSP + 大小上限缓解。建议加域名白名单。

### 9. 限流与防爆破 ✅ 通过（含 2 处 Info）
- 登录/验证码/注册/刷新/游客/成绩/题库/代理/排行榜均有 Redis 滑动窗口限流（Redis 故障自动降级为进程内计数，绝不静默放行）。
- 登录另有账号级锁定（5 次 / 15 分钟）。
- **Info-1**：`/auth/guest/bind` 与 `/auth/logout` 未挂 IP 级限频（bind 依赖验证码机制、logout 需鉴权，滥用面有限）。

### 10. 网络流量加固评估 → 见「五、网络加固评估」

### 11. 依赖与供应链 ✅ 通过
- `npm audit` 前后端均 0 漏洞。版本锁定（`package-lock.json`），生产镜像 `npm ci --omit=dev`。
- Release 流程生成 **SBOM + SLSA provenance** 镜像签名（`release.yml`）；产物带 SHA256SUMS。
- **Info-2**：`package.json` 用 `^` 前缀（但配合 lockfile 实际被锁定），可考虑 `npm audit` 纳入 CI 常驻步骤。

### 12. 游戏完整性（成绩防伪）⚠️ 含 1 处 Medium
- 每日挑战：服务端按当日题单真实坐标权威结算，客户端不得携带答案坐标 ✅。
- 多人对战：服务端权威算距离/得分 ✅。
- **Medium-1**：经典/挑战/区域/中国/无限/地标等**非每日模式**的 `verifyRoundScore` 用客户端提交的 `answerLat/answerLng` 重算距离，未用 `locationId` 回源 DB 核对真实答案坐标。作弊者可提交 `answer = guess`（距离 0）伪造满分。属于「题库坐标随前端 data.js 公开下发」这一纯静态架构的固有权衡，但仍与「服务端权威计分」目标存在落差。

---

## 三、风险清单（按严重级排序）

| 级别 | 编号 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| Medium | M-1 | `backend/src/games/service.ts:56-80` | 非每日模式按客户端提交的答案坐标重算得分，可被伪造满分 | 在线/登录模式下按 `locationId` 回源 DB 真实坐标校验（对齐 daily 模式） |
| Low | L-1 | `frontend/src/js/data.js` | 1570 条题库含 lat/lng 全量公开，可离线提取答案 | 纯静态前端固有；如需严格防作弊，题目坐标改为服务端按需下发 |
| Low | L-2 | `backend/src/auth/tokens.ts` | JWT 用 HS256 对称密钥，未校验 iss/aud | 单服务可接受；多服务迁移 RS256/ES256 并补 iss/aud |
| Low | L-3 | `frontend/src/js/config.js:22` | `API_SIGNING_SECRET` 硬编码 dev 占位值 | 部署时替换为随机值并与后端 `API_SIGNING_SECRET` 一致 |
| Low | L-4 | `backend/src/services/mapillary.ts:128-166` | 图源代理跟随上游返回的 thumb URL，未做域名白名单 | 校验 thumb URL 域名属于 Mapillary CDN |
| Info | I-1 | `backend/src/routes/auth.ts:123,170` | `guest/bind`、`logout` 无 IP 限频 | 补齐 IP 级限流，与其他 auth 端点一致 |
| Info | I-2 | `backend/package.json` | 依赖用 `^` 前缀；CI 无 npm audit 步骤 | 将 `npm audit` 纳入 CI 常驻 |
| Info | I-3 | `backend/.env`（本地未入库） | DB/Redis 弱默认密码 `mma` | 开发环境也避免与默认一致 |
| Info | I-4 | `backend/src/auth/email.ts:47-50` | 开发/测试环境验证码明文落日志 | 可接受；注意日志文件访问权限 |
| Info | I-5 | `deploy/.env.prod.example` | `METRICS_TOKEN` 注释「留空则端点开放」与代码不符（代码更严格：生产留空即拒绝） | 修正注释 |
| Info | I-6 | `backend/scripts/seed-locations.mjs:77` | 脚本内 `eval` 解析 data.js 数组 | 构建期可信输入，风险极低；可改安全解析 |

---

## 四、修复建议（高优先级代码示例）

### M-1 非每日模式服务端权威校验（示例方向）
```ts
// games/service.ts：对携带 locationId 的回合，回源核对真实坐标后再重算距离
import * as locationsService from '../locations/service.js';

async function verifyRoundScoreAuthoritative(round: GameRoundInput, mode: GameMode, region: string | null) {
    if (round.locationId != null) {
        const [real] = await locationsService.getLocationsByIds([round.locationId]);
        if (real) {
            const distance = haversineKm(round.guessLat!, round.guessLng!, real.lat, real.lng);
            return computeRoundScore(mode, region, distance);
        }
    }
    return verifyRoundScore({ mode, region } as SubmitGameInput, round); // 回退
}
```
> 注：纯离线/游客本地模式因坐标本就随 data.js 公开，严格防作弊收益有限；但「已登录 + 在线提交」路径值得按 locationId 权威校验，与 daily/duel 口径统一。

### L-4 图源域名白名单
```ts
const ALLOWED_IMAGE_HOSTS = new Set([
  'images.mapillary.com', 'd1cuyjsrcm0gby.cloudfront.net', // 按实际 CDN 域名调整
]);
const u = new URL(thumbUrl);
if (!ALLOWED_IMAGE_HOSTS.has(u.hostname)) throw serviceUnavailable('图源域名不受信任');
```

---

## 五、网络流量加固评估（security-check 第 10 节）

| 检查项 | 现状 | 缺口风险 |
|---|---|---|
| TLS/HTTPS 强制 | ✅ 生产 Nginx 终结 TLS 1.2/1.3 + HSTS + Secure Cookie | 无 |
| 证书固定（Pinning） | N/A——Web 前端无客户端可固定证书，不适用 | 无 |
| 请求签名（HMAC） | ✅ 已实现 `apiSignature` + 前端签名（`API_SIGNING_SECRET` 开启后生效） | 默认关闭，需配置启用 |
| 防重放 | ✅ 已实现（时间戳 ±5 分钟 + Redis nonce 去重 + 进程内兜底） | 无 |
| 载荷随机化/填充 | ❌ 未实现（混淆长度） | Low |
| mTLS | N/A——单一公网后端，无内部服务间调用 | 无 |

**评估结论**：本项目网络层**已基本完成加固**——TLS、请求签名、防重放三项均已落地（签名/防重放为「配置即启用」），证书固定与 mTLS 对纯 Web 场景不适用。**剩余缺口仅有 Low 级的载荷填充**，收益极小（本项目无高敏数据流量）。

**因此我建议：不额外应用网络加固**（现有防护已覆盖 Medium/High 项，仅剩 Low 级可选增强，且会引入密钥分发与维护成本）。

> 如果你仍希望启用「请求签名 + 防重放」这一已实现但默认关闭的能力，只需在生产 `deploy/.env` 设置 `API_SIGNING_SECRET=<随机值>`，并同步写入 `frontend/src/js/config.js` 的 `API_SIGNING_SECRET`。是否要我代为实现这一步？或需要我修复上面的 Medium/Low 项，请告知。
