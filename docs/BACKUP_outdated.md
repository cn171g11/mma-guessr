# MmaGuessr 多版本备份与回滚指南

> 本指南说明如何备份、验证、回滚 MmaGuessr 的任意历史版本。
> 备份采用 **双保险**：远程 git tag + 本地文件快照（`backups/snapshots/`）。

---

## 一、备份总览

### 1. 远程备份（git tag，已推送 GitHub）

每个发布版本都有一个**带注释的 git tag**（annotated tag，含版本说明），指向该版本的最终提交。tag 与提交一样存储在 GitHub 远程仓库，**包含全部新增/修改/删除文件的完整历史**。

| 版本 Tag  | 对应提交  | 版本说明                                                 |
| --------- | --------- | -------------------------------------------------------- |
| `v1.0.0`  | `c7d7f40` | 首次发布 + GitHub Pages 部署                             |
| `v1.7.0`  | `9ec8192` | 港澳台街景支持 + 搜索半径 1.3km                          |
| `v1.8.0`  | `339cf73` | 题库去重 173→167 + Notion 文档入口                       |
| `v1.9.0`  | `3f081c0` | 中国模式 +117 街景 + 挑战模式合并                        |
| `v1.9.1`  | `d42a10c` | 移除管理员面板 + Notion 同步                             |
| `v1.10.0` | `bee9aff` | 计分系统重构（分区参数 + α + dMin）                      |
| `v1.11.0` | `b3620f6` | 历史记录面板 + Mapillary 回看                            |
| `v1.12.0` | `0130eea` | 中国点位排查 167→125 + 七城新增                          |
| `v1.13.0` | `bebbdda` | 地图锁定 + 横屏适配 + 错误报告 + 世界+176                |
| `v1.14.0` | `6a6dbc8` | 题库隔离 + 中国题≤20% + 世界+502/中国+215 + 区域平衡+445 |
| `v1.15.0` | `2551da4` | 数据统计：PV/UV + 游玩轮次 + 图表 + Node 后端            |

> ⚠️ **版本覆盖说明**：v1.1.0 – v1.6.0 的改动（名称统一、题库扩充、移动端优化等）包含在
> `v1.0.0`（c7d7f40）与 `v1.7.0`（9ec8192）之间的提交中，Git 历史中无法逐版本切分，
> 因此未单独打 tag；如需查看该阶段任意时刻的文件，可用 `git log` 按提交逐一回溯。

### 2. 本地备份（文件快照，`backups/snapshots/`）

每个版本使用 `git archive` 导出的**独立 zip 快照**，包含该版本工作树的全部文件：

```
backups/
└── snapshots/
    ├── MANIFEST.md      ← 版本清单：提交/日期/文件数/大小/SHA256/说明
    ├── SHA256SUMS       ← 每个 zip 的 SHA256 校验文件
    ├── v1.0.0.zip       ← 该版本完整文件快照
    ├── v1.7.0.zip
    ├── ...
    └── v1.15.0.zip
```

---

## 二、备份命令（新增版本时执行）

在**发布新版本并打 commit 后**执行：

```bash
cd E:/Desktop/geoguesser

# 1. 确认工作区干净、提交已就位
git status --short
git log --oneline -1

# 2. 为当前版本打带注释的 tag（用实际版本号替换 vX.Y.Z）
git tag -a vX.Y.Z -m "MmaGuessr vX.Y.Z — 版本说明"

# 3. 推送 tag 到远程（远程备份）
git push origin vX.Y.Z          # 推送单个
# git push origin --tags        # 或推送全部

# 4. 导出本地 zip 快照（本地备份）
git archive --format=zip --prefix="vX.Y.Z/" vX.Y.Z -o backups/snapshots/vX.Y.Z.zip

# 5. 重新生成清单与校验文件
node tools/_gen-backup-manifest.js   # 重新生成 MANIFEST.md + SHA256SUMS
```

---

## 三、验证备份完整性

### 方式 1：快速校验（SHA256）

```bash
cd E:/Desktop/geoguesser/backups/snapshots
# 校验全部 zip 与 SHA256SUMS 一致（输出 OK 即通过）
sha256sum -c SHA256SUMS
```

### 方式 2：深度校验（文件数 + 列表 + 内容）

```bash
cd E:/Desktop/geoguesser
node tools/_verify-backup.js
# 期望输出：全部版本 ✅ 通过
```

该脚本逐一验证每个版本：① SHA256 匹配 ② zip 内文件数与 git 树一致
③ 文件列表一致 ④ 关键文件内容哈希一致。

### 方式 3：抽查某版本文件内容

```bash
# 从 zip 中提取任意文件检查
python -m zipfile -e backups/snapshots/v1.15.0.zip /tmp/check
# 与 git 中该版本文件对比（注意 Windows CRLF，用归一化比较）
```

---

## 四、回滚操作

### 场景 A：回滚到某个历史版本（覆盖当前工作区）

```bash
cd E:/Desktop/geoguesser

# 方式一：基于 git tag（推荐，保留完整历史）
git checkout -b rollback-v1.14.0 v1.14.0   # 从 tag 拉出新分支
# 或直接重置当前分支（谨慎，会丢弃之后的提交）
# git reset --hard v1.14.0

# 方式二：基于本地 zip 快照（应急，无需 git 历史）
# 解压 v1.14.0.zip 覆盖当前目录文件（MmaGuessr.html 等）
python -m zipfile -e backups/snapshots/v1.14.0.zip ./
```

### 场景 B：只恢复某个文件到旧版本

```bash
git checkout v1.14.0 -- MmaGuessr.html    # 从 tag 恢复单个文件
```

### 场景 C：撤销一次错误提交（软回滚，保留改动）

```bash
git revert <bad-commit>                    # 生成反向提交，历史保留
```

> 🛡️ **回滚安全提示**：回滚前先确认工作区无未提交改动（`git status`），
> 必要时先 `git stash` 暂存。修改 tag 已推送后不可改名，请勿用 `git push -f` 覆盖 tag。

---

## 五、备份文件清单

| 文件                           | 位置                           | 说明                                                             |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| 版本 tag ×11                   | GitHub `refs/tags/`            | 远程备份，含完整历史                                             |
| 版本 zip ×11                   | `backups/snapshots/vX.Y.Z.zip` | 本地备份，独立快照                                               |
| `MANIFEST.md`                  | `backups/snapshots/`           | 版本清单（提交/日期/文件数/SHA256）                              |
| `SHA256SUMS`                   | `backups/snapshots/`           | 全部快照校验文件                                                 |
| `tools/gen-backup-manifest.js` | 开发工具                       | 重新生成清单（新版本时用）                                       |
| `tools/verify-backup.js`       | 开发工具                       | 完整性深度校验                                                   |
| `backups/v1.15.0-with-stats/`  | 本地参考副本                   | v1.15.0 含数据统计面板的完整代码参考（已于 2026-08-03 回滚移除） |

---

_最后验证时间：2026-08-02 — 全部 11 个版本备份验证通过 ✅_
