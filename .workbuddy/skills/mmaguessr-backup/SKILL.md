---
name: mmaguessr-backup
description: MmaGuessr 版本化备份与回滚。双保险机制（远程 git annotated tag + 本地 git archive zip 快照）、MANIFEST.md 与 SHA256SUMS 生成、两种完整性校验方式、三种回滚场景。用户说"备份/打 tag/做快照/回滚/恢复版本/校验备份"时使用。
agent_created: true
---

# MmaGuessr 版本化备份与回滚

## 双保险机制

| 层 | 形式 | 位置 | 特点 |
|---|---|---|---|
| 远程 | **annotated git tag**（带版本说明） | GitHub `refs/tags/` | 含完整历史，可追溯 |
| 本地 | `git archive` 导出的 **zip 快照** | `backups/snapshots/vX.Y.Z.zip` | 独立文件，无 git 也能恢复 |

当前状态：**15 个 tag**（v0.1.0 ~ v1.18.10）、**11 个 zip 快照**在 `backups/snapshots/`。

## 创建备份（发布新版本后执行）

```bash
cd E:/Desktop/geoguesser

# 1. 确认工作区干净、提交已就位
git status --short
git log --oneline -1

# 2. 打带注释的 tag（版本号替换为实际值）
git tag -a vX.Y.Z -m "MmaGuessr vX.Y.Z — 版本说明"

# 3. 推送 tag 到远程（远程备份）
git push origin vX.Y.Z
# 或批量推送全部：git push origin --tags

# 4. 导出本地 zip 快照
git archive --format=zip --prefix="vX.Y.Z/" vX.Y.Z -o backups/snapshots/vX.Y.Z.zip

# 5. 重新生成清单与校验文件
node tools/gen-backup-manifest.js
```

> **推送 tag 走 git 还是 API？** tag 推送量小，本机 `git push origin <tag>` 通常可行；
> 若被 GFW 卡住，参考 **mmaguessr-push** 改用 REST API
> （`POST /repos/cn171g11/mma-guessr/git/refs` 创建 tag 引用）。

产出结构：

```
backups/snapshots/
├── MANIFEST.md      ← 版本清单：提交 / 日期 / 文件数 / 大小 / SHA256 / 说明
├── SHA256SUMS       ← 每个 zip 的 SHA256 校验文件
├── v1.0.0.zip
├── v1.7.0.zip
└── ...
```

## 校验备份完整性

### 方式 1：快速校验（SHA256）

```bash
cd E:/Desktop/geoguesser/backups/snapshots
sha256sum -c SHA256SUMS        # 全部输出 OK 即通过
```

### 方式 2：深度校验（文件数 + 列表 + 内容）

```bash
cd E:/Desktop/geoguesser
node tools/verify-backup.js    # 期望：全部版本 ✅ 通过
```

逐一验证每个版本：① SHA256 匹配 ② zip 内文件数与 git 树一致
③ 文件列表一致 ④ 关键文件内容哈希一致。

### 方式 3：抽查某版本文件内容

```bash
python -m zipfile -e backups/snapshots/v1.15.0.zip /tmp/check
```

与 git 中该版本对比时注意 **Windows CRLF**，需归一化后比较。

## 回滚操作

### 场景 A：整体回滚到历史版本

```bash
# 方式一（推荐）：基于 tag 拉分支，保留完整历史
git checkout -b rollback-v1.14.0 v1.14.0

# 方式二（应急）：解压 zip 快照覆盖，无需 git 历史
python -m zipfile -e backups/snapshots/v1.14.0.zip ./
```

> 直接 `git reset --hard vX.Y.Z` 会**丢弃之后的提交**，非必要不用。

### 场景 B：只恢复单个文件

```bash
git checkout v1.14.0 -- MmaGuessr.html
```

### 场景 C：撤销一次错误提交（软回滚，保留改动）

```bash
git revert <bad-commit>        # 生成反向提交，历史保留
```

## ⚠️ 已知陷阱

1. **tag 已推送后不可改名** —— 打错版本号只能换新 tag，
   **绝不要 `git push -f` 覆盖 tag**
2. **回滚前工作区有未提交改动** —— 先 `git status` 确认，必要时 `git stash`
3. **用 `git archive` 在 Windows 复现 CI 状态** —— 它会应用 autocrlf 转换输出 CRLF，
   会误判成全文件失败。要模拟 CI checkout 请用 `git show HEAD:path`
4. **只打 tag 不导出 zip**（或反之）—— 双保险缺一层，本地仓库损坏就没了
5. **忘了跑 `gen-backup-manifest.js`** —— SHA256SUMS 里没有新版本，校验会漏

## 版本历史（tag → 说明）

| Tag | 说明 |
|---|---|
| `v1.0.0` | 首次发布 + GitHub Pages 部署 |
| `v1.7.0` | 港澳台街景支持 + 搜索半径 1.3km |
| `v1.8.0` | 题库去重 173→167 + Notion 文档入口 |
| `v1.9.0` | 中国模式 +117 街景 + 挑战模式合并 |
| `v1.9.1` | 移除管理员面板 + Notion 同步 |
| `v1.10.0` | 计分系统重构（分区参数 + α + dMin） |
| `v1.11.0` | 历史记录面板 + Mapillary 回看 |
| `v1.12.0` | 中国点位排查 167→125 + 七城新增 |
| `v1.13.0` | 地图锁定 + 横屏适配 + 错误报告 + 世界+176 |
| `v1.14.0` | 题库隔离 + 中国题≤20% + 世界+502/中国+215 + 区域平衡+445 |
| `v1.15.0` | 数据统计：PV/UV + 游玩轮次 + 图表 + Node 后端 |

> v1.1.0 – v1.6.0 的改动包含在 `v1.0.0` 与 `v1.7.0` 之间的提交中，
> Git 历史无法逐版本切分，未单独打 tag；需要时用 `git log` 逐提交回溯。

## 校验清单

- [ ] 工作区干净、目标提交已就位
- [ ] annotated tag 已创建并推送远程
- [ ] zip 快照已导出到 `backups/snapshots/`
- [ ] `node tools/gen-backup-manifest.js` 已重跑
- [ ] `sha256sum -c SHA256SUMS` 全部 OK
- [ ] `node tools/verify-backup.js` 全部 ✅

## 相关文件

| 文件 | 说明 |
|---|---|
| `BACKUP.md` | 完整备份与回滚指南（本文档的权威来源） |
| `backups/snapshots/MANIFEST.md` | 版本清单 |
| `backups/snapshots/SHA256SUMS` | 校验文件 |
| `tools/gen-backup-manifest.js` | 重新生成清单（新版本时跑） |
| `tools/verify-backup.js` | 深度完整性校验 |
| `backups/v1.15.0-with-stats/` | v1.15.0 含统计面板的参考副本（已回滚，仅存档） |
