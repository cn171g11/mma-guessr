#!/usr/bin/env bash
# =============================================================
# MmaGuessr PostgreSQL 定时备份脚本
# 在宿主机配置 cron 调用，例如：
#   0 2 * * * /opt/mma-guessr/backend/deploy/scripts/backup-postgres.sh >> /var/log/mma-guessr-backup.log 2>&1
# 保留最近 14 份，旧备份自动清理。
# =============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# 读取 .env 中的数据库连接参数（不落日志）
ENV_FILE="$DEPLOY_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "[backup] 缺少 $ENV_FILE" >&2
    exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_FILE="$BACKUP_DIR/mma-guessr-pg-$STAMP.sql.gz"

echo "[backup] 开始备份 -> $OUT_FILE"

docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip >"$OUT_FILE"

if [ ! -s "$OUT_FILE" ]; then
    echo "[backup] 备份失败：输出文件为空" >&2
    rm -f "$OUT_FILE"
    exit 1
fi

# 清理超过保留天数的旧备份
find "$BACKUP_DIR" -name 'mma-guessr-pg-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[backup] 完成：$(du -h "$OUT_FILE" | cut -f1)"
