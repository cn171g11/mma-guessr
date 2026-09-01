---
name: mmaguessr-push
description: MmaGuessr 推送 GitHub 与部署。GFW 环境下 git HTTPS 不可用，必须走 GitHub REST API 脚本（push_web.py / push_to_github.py）；含 CRLF 导致 CI prettier 失败这一头号陷阱的规避与排查方法、PAT 环境变量规范、推送后验证 Actions。用户说"推送 GitHub/push/部署网页端/更新线上/Actions 失败"时使用。
agent_created: true
---

# MmaGuessr GitHub 推送与部署

## 为什么不用 `git push`

**GFW 干扰 git HTTPS**，直推经常超时或中途失败。本项目统一用 GitHub REST API 脚本推送：

| 脚本 | 位置 | 作用 |
|---|---|---|
| `push_web.py` | `E:\Desktop\mma-guessr-apk\push_web.py` | 更新 `main` 分支的 `frontend/src/**`，触发 Pages 部署 |
| `push_to_github.py` | `E:\Desktop\mma-guessr-apk\push_to_github.py` | 更新 `android` 分支 + 创建 release + 上传 APK 附件 |

两者都用 Python 标准库 `urllib` 直连 `api.github.com`（不依赖 git、不走系统代理）。

## PAT 处理（安全红线）

脚本从**环境变量**读取，绝不写进文件、绝不进 Git：

```bash
export GITHUB_TOKEN=<你的 GitHub PAT>
python push_web.py
```

PAT 需覆盖 `cn171g11/mma-guessr` 仓库作用域。脚本缺失该变量时自行报错退出（`缺少 GITHUB_TOKEN 环境变量`）。

> 🔒 本 skill **不保存**任何 PAT 明文。AI 执行时也不得把 token 回显到对话或写入任何文件。

## ⚠️ 头号陷阱：CRLF 导致部署静默失败（2026-08-30 踩过）

### 现象

代码明明推送成功了，但线上页面**停留在旧版本**，用户看不到更新。
GitHub Actions 的 Deploy 工作流报 prettier 全文件错误。

### 根因（两层）

1. **推送脚本用 `open()` 直接读 Windows 工作区文件** —— 仓库 `core.autocrlf=true`，
   工作区检出为 **CRLF**；上传的 blob 变成 CRLF 后，CI 的 prettier（`endOfLine: lf`）
   对**整个文件**报错。未变更的文件因为继承旧 blob（LF）反而不报错，
   所以只有改动过的文件中招，现象极具迷惑性。
2. 那次还叠加了真实格式问题：`game.js` 里的 `if (isOpen) setTimeout(...)` 写成单行，
   不符合 prettier 规范 —— 即使行尾是 LF 也会失败。

### 正确做法

推送脚本**必须**用 `git show HEAD:<path>` 读取 git 对象原始内容（LF）：

```python
# ✅ 正确：读 git 对象原始内容（LF 行尾）
raw = subprocess.check_output(["git", "-C", ROOT, "show", f"HEAD:{rel}"])

# ❌ 错误：直接读工作区文件，Windows 下是 CRLF
raw = open(os.path.join(ROOT, rel), "rb").read()
```

### 排查复现时的坑

- ✅ 用 `git show HEAD:path` 模拟 CI checkout —— 拿到的是 git 对象原始内容（LF）
- ❌ **不要用 `git archive`** —— Windows 下它会应用 autocrlf 转换，输出 CRLF，
  会让你误判成"所有文件都格式失败"，白白浪费排查时间

### 排查命令

```bash
cd E:/Desktop/geoguesser

# 用 git 对象原始内容跑 prettier（等价于 CI 的行为）
git show HEAD:frontend/src/js/game.js > /tmp/game.js
cd frontend && npx prettier --check /tmp/game.js
```

## ⚠️ FILES 只列本次真正改动过的文件

脚本会把列表里的每个文件**用本地 go 分支的 HEAD 内容覆盖到远程分支**。
所以**不要**保留历史遗留的完整文件清单 —— 列了未改动的文件，
一旦该文件在远程分支上的内容与本地 go 分支不同源，就会被静默覆盖成旧版本。

```python
# ✅ 正确：只列本次改动的
FILES = ["frontend/src/js/config.js", ".github/workflows/ci.yml"]

# ❌ 错误：把历史清单原样留着，未改动的文件会被覆盖
FILES = ["frontend/src/css/style.css", "frontend/src/index.html", ...]
```

`.github/workflows/*.yml` **也能推**（路径是相对仓库根的，不限于 `frontend/src`）。
改了 CI 规则就必须一起推，否则远程分支仍用旧规则，部署照样失败。

## 推送前必改脚本头部的变量

`push_web.py`：

```python
BRANCH   = "main"
BASE_SHA = "<origin/main 当前 HEAD>"   # 每次推送前更新
ROOT     = "E:/Desktop/geoguesser"
FILES    = [ "frontend/src/css/style.css", "frontend/src/index.html", ... ]  # 本次变更文件
```

`push_to_github.py`：

```python
BRANCH  = "android"
VERSION = "X.Y.Z"                       # 与 build.gradle 的 versionName 一致
changed = [ "android/app/build.gradle", "web/js/config.js", ... ]            # 本次变更文件
```

> `BASE_SHA` 只是脚本里的注释性参考值，实际父提交由脚本运行时
> `GET /git/ref/heads/<branch>` 动态获取；但 `FILES` / `changed` / `VERSION`
> 是**手写的**，漏填 = 文件没被推送，务必逐一核对。

脚本会自动跳过本地不存在的文件（`[p for p in changed if os.path.isfile(p)]`），
所以路径写错不会报错，只会静默漏推 —— 推完要核对输出的文件列表。

## 推送后必验

**不要只看 push 返回 200。** 必须确认 Actions 真的跑成功了：

```bash
export GITHUB_TOKEN=<PAT>
# 查看最近一次 Deploy 工作流状态
curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/cn171g11/mma-guessr/actions/workflows/deploy.yml/runs?per_page=3" \
  | grep -E '"(status|conclusion|display_title)"'
```

期望：`status: completed` 且 `conclusion: success`。
若 `conclusion: failure`，点进 run 看具体 job（多半是 prettier 或 validate-data）。

## 分支与触发规则速查

| 分支 | 用途 | 部署触发 |
|---|---|---|
| `go` | 本地开发主分支（当前所在） | 不触发部署 |
| `main` | 网页端发布 | `deploy.yml` → GitHub Pages |
| `android` | App 端发布 | release + APK 附件 |
| `gh-pages` / `node-js` | 历史遗留 | — |

`deploy.yml` 的 `paths-ignore` 排除了 `README.md` / `CONTRIBUTING.md` / `AGENTS.md` /
`docs/**` / `backend/**` —— **只改这些不会触发 Pages 部署**，别白等。

后端改动走另一条链路：push `backend/**` → `backend.yml`（quality + GHCR 镜像）。

## ⚠️ 已知陷阱

1. **CRLF**（见上，头号杀手）
2. **用 `git push` 硬推** —— GFW 下大概率失败，且失败前可能已经卡了好几分钟
3. **漏填 `FILES` / `changed`** —— 脚本静默跳过，文件没推上去
4. **只看 push 返回码** —— 必须验证 Actions 的 `conclusion`
5. **backend 改动等 Pages 部署** —— `backend/**` 被 `paths-ignore`，走的是 `backend.yml`
6. **PAT 硬编码进脚本** —— 一旦提交就永久留在 git 历史里，只能轮换 PAT

## 校验清单

- [ ] `GITHUB_TOKEN` 已从环境变量注入，且未在任何文件中明文出现
- [ ] 推送脚本读取文件内容用的是 `git show HEAD:path`（LF），不是 `open()`
- [ ] `FILES` / `changed` / `VERSION` 已按本次改动更新
- [ ] 脚本输出的文件列表与预期一致（无静默跳过）
- [ ] Actions 的 Deploy 工作流 `conclusion: success`
- [ ] 线上页面版本号与 `config.js` 的 `VERSION` 一致

## 相关文件

| 文件 | 说明 |
|---|---|
| `E:\Desktop\mma-guessr-apk\push_web.py` | 网页端推送（main → Pages） |
| `E:\Desktop\mma-guessr-apk\push_to_github.py` | App 端推送（android + release + APK） |
| `.github/workflows/deploy.yml` | Pages 部署（validate 阶段 = prettier + node --check + validate-data） |
| `.github/workflows/ci.yml` | 前端 CI |
| `.github/workflows/backend.yml` | 后端 CI/CD（GHCR 镜像） |
| `frontend/.prettierrc.json` | prettier 配置，含 `endOfLine: lf` |
