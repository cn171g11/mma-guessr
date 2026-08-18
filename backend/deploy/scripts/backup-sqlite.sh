#!/usr/bin/env bash
# =============================================================
# MmaGuessr SQLite 定时备份脚本
# 在宿主机配置 cron 调用，例如：
#   0 2 * * * /opt/mma-guessr/backend/deploy/scripts/backup-sqlite.sh >> /var/log/mma-guessr-backup.log 2>&1
# 保留最近 14 份，旧备份自动清理。
#
# 原理：SQLite 官方备份 API 的 CLI 等价物（VACUUM INTO），生成一致性快照。
# 两种运行模式：
#   默认       —— docker-compose 部署：docker compose exec 在容器内对运行中的库做快照
#   HOST_MODE=1 —— systemd 单二进制部署：直接对本机 SQLite 文件做快照（依赖宿主 sqlite3 CLI）
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# systemd 形态使用宿主数据路径；compose 形态使用容器内路径
HOST_MODE="${HOST_MODE:-0}"
HOST_DB_PATH="${SQLITE_PATH:-/var/lib/mma-guessr/mma_guessr.db}"
DB_PATH="${SQLITE_PATH_IN_CONTAINER:-/app/data/mma_guessr.db}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/mma-guessr-sqlite-$STAMP.db"

echo "[backup] 开始备份 -> $OUT_FILE"

if [ "$HOST_MODE" = "1" ]; then
    # 前置自检：宿主必须存在 sqlite3 CLI（VACUUM INTO 依赖）。
    if ! command -v sqlite3 >/dev/null 2>&1; then
        echo "[backup] 失败：宿主缺少 sqlite3 CLI。" >&2
        echo "[backup] 修复：apt-get install -y sqlite3 后重试。" >&2
        exit 1
    fi
    # 先落到临时文件再拷出，避免与运行中写入的交错。
    # 重定向必须挂在 cat 上：链式命令中行尾 >file 只会作用于最后一个命令。
    sqlite3 "$HOST_DB_PATH" 'VACUUM INTO "/tmp/mma-guessr-backup.db"' \
        && cat /tmp/mma-guessr-backup.db >"$OUT_FILE" \
        && rm -f /tmp/mma-guessr-backup.db
else
    # 前置自检：镜像内必须存在 sqlite3 CLI（VACUUM INTO 依赖），
    # 缺失时给出可操作的修复提示，避免产出空备份文件。
    if ! docker compose -f "$COMPOSE_FILE" exec -T backend sh -c \
        'command -v sqlite3 >/dev/null 2>&1'; then
        echo "[backup] 失败：backend 镜像缺少 sqlite3 CLI。" >&2
        echo "[backup] 修复：更新后端镜像（Dockerfile 已安装 sqlite 包）后重试。" >&2
        exit 1
    fi

    # VACUUM INTO 生成一致性快照；先落到容器内临时文件再拷出，
    # 避免并发写入期间的跨文件系统不一致。
    docker compose -f "$COMPOSE_FILE" exec -T backend sh -c \
        "sqlite3 '$DB_PATH' 'VACUUM INTO \"/tmp/mma-guessr-backup.db\"' && cat /tmp/mma-guessr-backup.db && rm -f /tmp/mma-guessr-backup.db" \
        >"$OUT_FILE"
fi

if [ ! -s "$OUT_FILE" ]; then
    echo "[backup] 备份失败：输出文件为空" >&2
    rm -f "$OUT_FILE"
    exit 1
fi

gzip -f "$OUT_FILE"
OUT_FILE="$OUT_FILE.gz"

# 清理超过保留天数的旧备份
find "$BACKUP_DIR" -name 'mma-guessr-sqlite-*.db*' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] 完成：$(du -h "$OUT_FILE" | cut -f1)"
