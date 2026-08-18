# MmaGuessr 性能开销审查报告

- 日期：2026-08-18
- 范围：多人对战 / 同步 / 积分 / 排行榜 / 图包 / 街景图片链路
- 原则：**只审查，不改动功能**。所有结论均基于当前代码路径（Go 后端 + SQLite 单实例 + 前端静态站点）。

---

## 1. 结论概览

| 模块 | 当前复杂度 | 判定 | 关键约束 |
| --- | --- | --- | --- |
| 积分计算 | O(1) 纯数学 | ✅ 无风险 | 服务端权威结算 |
| 每日/图包权威结算 | O(轮数) | ✅ 无风险 | 题单仅 5~20 轮 |
| 排行榜 | 每次得分 O(N) 全表重写 | 🟡 可接受 | N=该模式条目数；当前规模小 |
| 资料统计聚合 | O(该用户记录数) | 🟡 可接受 | 5 分钟缓存 + 提交时失效 |
| 多人对战 | 每会话 1 goroutine + 轮询 | 🟡 可接受 | 轮询长连接 20s 保持 |
| 街景图片 | CDN 直连 + 24h KV 缓存 | ✅ 无风险 | 后端已退化为兜底 |
| 图包 | 提交时一次 DB 查询 | ✅ 无风险 | 图包地点 ≤50 |

**总体结论**：当前架构对"单实例、中小规模（数十~数百并发）"的设计边界完全够用。仅列出 3 项低风险优化建议（§7），均非必须。

---

## 2. 积分计算（games/scoring.go）

- `ComputeRoundScore`：一次 `math.Exp` + 两次三角函数，纯 CPU O(1)。
- 距离由服务端 `HaversineKm` 计算，禁止客户端携带结果，杜绝篡改与重算开销。
- **无热点**。每日结算、图包结算、普通结算走同一函数，峰值每局仅执行 5~20 次。

---

## 3. 服务端权威结算（games/service.go）

### 每日挑战 `verifyDailyRoundsAuthoritative`
- `GetTodayLocationRecords()`：一次按 `date` 的 SQLite 查询，返回今日题单。
- 每个回合一次 `map` 查找 + 一次 haversine，O(轮数)。
- 题单固定（5~20 题），内存 map 尺寸极小。

### 图包 `verifyPackRoundsAuthoritative`（新增）
- `FetchPackLocations(packID)`：每局**一次** SQLite 查询 + 一次权限检查，随后按 locationID 建立 map。
- 每回合 O(1) 查表。图包地点上限 50，map 构建成本可忽略。
- **注意点**：多人同时结算同一图包会并发读同一行——SQLite WAL 下多读不冲突，单实例 `MaxOpenConns(1)` 串行化写入，无写锁竞争。

---

## 4. 排行榜（leaderboard/leaderboard.go）

### 现状
- `RecordScore`（每局一次）：写 `lb:overall:<mode>` 与 `lb:daily:<mode>:<date>` 两个 KV 条目。
- 实现方式为 `readCache` 读全量条目列表 → 追加/替换 → `writeCache` 全量写回（存于 SQLite `mapillary_cache` 表，TTL 30 天 / 8 天）。
- 读路径 `GetRankings`：优先命中缓存，仅缓存失效/被清空时做懒重建（`Rebuild` 一次全表 GROUP BY）。

### 风险
- **每次得分都是 O(N) 全列表重写**（N=该模式条目数）。N 到万级时单次写入 ~几百 KB，会成为写热点。
- `fetchUsernames` 每次读榜单都要按 user_id 回查用户名（JOIN `users`），属于读路径的次要开销。

### 建议（未实施，见 §7）
- 换用 `leaderboard` 排序集（如 Redis）或 SQLite `scores` 表的增量 UPSERT + `ORDER BY LIMIT` 直查，去掉全量重写。
- 用户名映射加 5 分钟 KV 缓存。

---

## 5. 多人对战与同步（multiplayer/）

### 传输层（engineio.go）
- **仅 polling 长轮询**（20s 保持，Ping 25s / 超时 20s）：无 WebSocket 推送，服务器把事件**队列化**，客户端轮询取走。
- 每会话一个 `pingLoop` goroutine（每 25s 唤醒一次做超时探测），全局一把 `sync.Mutex` 保护 session map 与队列。
- 事件帧文本传输，无压缩；单帧大小由业务 payload 决定（地图坐标等）。

### 房间层（service.go）
- 单 `matchmaker` ticker（1.5s 间隔）驱动匹配，无每房间 goroutine；回合倒计时用 `time.Timer`（独立 goroutine 回调）。
- 广播为对房间成员线性遍历 + 逐条 `json.Marshal`（O(玩家数)，duel 规模≤2，多人大厅规模可控）。
- 事件入口有 10s 滑动窗口限频，防止单客户端事件风暴。

### 风险
- 轮询模型的**固有延迟**：事件到客户端最坏等待一个 poll 周期（≤20s），玩家感知"卡顿"。
- 全局单 Mutex 在数百并发连接下会竞争，但目前规模无感。
- 每会话常驻 goroutine 在几千连接时浪费（无事件也每 25s 唤醒）。

### 建议（未实施，见 §7）
- 上线 WebSocket 传输（Engine.IO v4 规范兼容）可显著降延迟；属功能性改进，超出"只审查"范围。

---

## 6. 街景图片链路（mapillary/ + 前端）

- **主路径**：后端 `ResolveMediaURL` 仅解析出公开 CDN 缩略图直链，不下载字节 → 浏览器直连 Mapillary CDN，后端零带宽零缓存。
- **兜底路径**：`/api/proxy/mapillary/image/:id` 服务端抓图，24h KV 字节缓存，重复请求命中缓存不触上游。
- **搜索路径**：`/search` 坐标搜索同样走 24h 元数据缓存（`resolveMedia` 也缓存 mediaRecord）。
- 前端 `loadPanoramaTexture` 优先 CDN 直链、失败自动降级代理；`img-src https:` + `connect-src https:` CSP 放行。
- **无热点**。图片带宽全部由 Mapillary CDN 承载，后端仅在 CDN 故障时参与。

---

## 7. 低风险优化建议（均未实施，不改变功能）

| # | 模块 | 建议 | 收益 | 工作量 |
| --- | --- | --- | --- | --- |
| 1 | 排行榜 | 增量 UPSERT + 直查取代全量 KV 重写 | 消除 O(N) 写热点 | 中 |
| 2 | 排行榜 | 用户名映射加短 TTL 缓存 | 降低读路径回查 | 小 |
| 3 | 多人对战 | 轮询保持期缩短到 ~10s 或升级 WebSocket | 改善玩家体感延迟 | 中~大 |

> 以上建议在并发规模达到千级或排行榜条目达到万级前无需处理；当前单实例架构是设计边界（见 deploy.md §3.3、FAQ Q2）。

---

## 8. 附：验证记录

- `go build ./...` / `go vet ./...` / `go test ./...`：全部通过。
- 前端 `node --check` 全部 JS 文件：通过。
- 图包链路关键点（CSP 放行 / CDN 直连 / 代理兜底 / CORS / 签名）：均已核实代码路径，详见本次会话变更。
