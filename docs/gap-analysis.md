# 与真实「图寻」的差距分析

> 结论先行: 核心玩法 (单机猜图 + 每日挑战 + 多人对战) 已完成并逐字节保持前端兼容, 差距集中在**社交/竞技长线玩法**与**生态化**层面. 本文档列出差距项与建议路线, 供后续阶段排期.

## 一、当前已实现 (对标图寻核心)

- 单机猜图: 全球题库随机 / 区域模式 / 难度过滤, 服务端权威计分 (`5000*e^(-10*max(d,dMin)/(refSpan*α))`)
- 每日挑战: 每日固定 10 题, 服务端权威结算, 每日仅一次, 惰性抽题 + 重建自愈
- 多人对战: 1v1 匹配 (queue → matched → 5 rounds → finished), 服务端计分与落库, Engine.IO v4 polling 与前端 socket.io 4.8.1 字节兼容
- 账号体系: 注册/登录/游客/邮箱验证码/刷新令牌, 成就 (19 项) + 称号, 个人统计, 排行榜 (总榜/日榜)
- 安全: 请求签名 + nonce 防重放, JWT 短时效, 登录锁定, 分级限频, CORS 白名单, SSRF 防护, 指标鉴权

## 二、差距项进度

### ✅ 1. 好友与私房对战 (P1) — 已完成

- `friends` 表 + 好友申请/同意/删除 (`internal/social/friends.go`), 支持按用户名发送请求
- 房间 `private` 模式: `mp:createPrivate` 生成 6 位房间码, 好友凭码加入 (`mp:join {mode:'private', roomCode}`)
- 等待房 10 分钟 TTL, 进入房间后按 duel 规则结算连胜/天梯
- 前端: `features.js` 好友面板 + `mp.js` 私房控件

### ✅ 2. 天梯排位与段位 (P2) — 已完成

- `season_ratings` 表 + `internal/ratings` 包: 赛季 `2026-S1`, 段位 青铜→宗师 8 级, 评分上限 3000
- `ApplyGame` (单机) / `RecordDuel` (对战) 结算, `Leaderboard` 天梯前 N
- 前端: 账号面板展示个人段位 + 天梯前 5

### ✅ 3. 对局轨迹回放 (P2) — 已完成

- `games.Store.FetchGame` + `GET /api/games/{gameId}` 返回完整 rounds (guess/answer 坐标)
- 前端: 历史列表回放按钮 → Leaflet 地图标记 + 连线, 逐轮查看

### ✅ 4. 连胜挑战与成就扩展 (P2) — 已完成

- 新增 5 项成就: `streak_3` / `streak_10` / `consecutive_5` / `regions_4` / `daily_full` (共 19 项)
- 聚合扩展: BestStreak / MaxConsecutive / DistinctRegions / PerfectDailyGames
- `season_ratings` 连胜字段同步结算

### 5. 图包工坊 / 自定义题库 (P3) — 待排期

图寻支持玩家自制图包并发布/订阅. 当前题库为内置静态数据 (data.js seed).

- 建议: `packs` + `pack_locations` 表, 图包审核/订阅/计分隔离; 属于较大生态功能, 建议排在最后

### ✅ 6. 每日挑战计分排行 (P3) — 已完成

- `daily.Leaderboard(date)` 按日聚合每日挑战得分 (服务端权威结算)
- 前端: 每日面板展示今日计分榜

### ✅ 7. 第三方登录 (P3) — 已完成

- `oauth_accounts` 表 + `internal/oauth` 包 (授权码流程, 现支持 Google, 可扩展)
- 路由: `GET /api/oauth/providers` / `/authorize/:provider` / `/callback/:provider`; 未配置凭据时优雅降级 (providers 空 / 404), 前端自动隐藏按钮
- 安全: state 令牌 `HMAC-SHA256(provider:ts:随机nonce)`, 10 分钟 TTL + **单次消费防重放**; 回调地址白名单校验 (HTTPS, 本地开发放行 localhost); 登录 CSRF 防护
- 环境变量: `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` + `OAUTH_STATE_SECRET` (生产必填强随机值)
- 前端: 登录表单动态展示第三方按钮; 回调后 `?oauth=success|failed` 提示并自动恢复会话 (HttpOnly 刷新 Cookie)

### ✅ 8. 冷知识 / 地点图鉴 (P3) — 已完成

- `location_facts` 表 + `internal/facts` 包 (curated 10 条 + 模板兜底), `GET /api/locations/fact?name=`
- 结果弹窗出现答案后自动展示冷知识 (前端 MutationObserver)
- 地点图鉴: `profile.Collections` 统计已答对地点 (点亮/次数/首次·末次), 账号面板展示

## 三、建议路线 (剩余)

| 阶段 | 内容 | 优先级 |
| --- | --- | --- |
| 1 | 第三方登录 (OAuth 白名单 + CSRF 防护) | P3 |
| 2 | 图包工坊 (packs + pack_locations + 审核) | P3 |

## 四、技术可行性备注

- SQLite 单文件 + WAL 已支撑上述扩展 (好友/排位/图包均为普通关系表), 无需引入 Redis/PostgreSQL
- 多人私房只需扩展现有 Engine.IO 房间状态机 (增加 `private` 字段与邀请码), 传输层不变
- 轨迹回放所需坐标数据已存于 `game_rounds`, 零后端成本即可落地
- 所有扩展均需保持 `/api` 契约与 socket 事件形状不破坏现有前端 (api.md 契约为准)