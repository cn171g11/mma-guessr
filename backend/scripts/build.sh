#!/usr/bin/env bash
# MmaGuessr backend 跨平台构建脚本 (Linux/macOS)
# 用法:
#   ./scripts/build.sh                  # 构建当前平台到 bin/mma-guessr
#   ./scripts/build.sh v1.2.3           # 注入版本号
#   OUT_DIR=dist ./scripts/build.sh     # 自定义输出目录
#   GOOS=windows ./scripts/build.sh     # 交叉编译(输出 bin/mma-guessr-windows-amd64.exe)
# 产物统一写入 bin/(或 OUT_DIR), 不再污染源码目录。
set -euo pipefail

VERSION="${1:-dev}"
OUT_DIR="${OUT_DIR:-bin}"

if ! command -v go >/dev/null 2>&1; then
    echo "错误: 未找到 Go 工具链" >&2
    exit 1
fi

GOOS_RAW="${GOOS:-}"
GOARCH_RAW="${GOARCH:-amd64}"
EXPLICIT_TARGET=0
if [ -n "$GOOS_RAW" ]; then
    EXPLICIT_TARGET=1
fi
if [ -z "$GOOS_RAW" ]; then
    case "$(uname -s)" in
        Darwin) GOOS_RAW=darwin ;;
        Linux)  GOOS_RAW=linux ;;
        MINGW*|MSYS*|CYGWIN*) GOOS_RAW=windows ;;
        *) GOOS_RAW=linux ;;
    esac
fi
GOOS="${GOOS_RAW}"

OUT_NAME="mma-guessr"
if [ "$EXPLICIT_TARGET" = "1" ]; then
    OUT_NAME="mma-guessr-${GOOS}-${GOARCH_RAW}"
fi
if [ "${GOOS}" = "windows" ]; then
    OUT_NAME="${OUT_NAME}.exe"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_PATH="${ROOT}/${OUT_DIR}/${OUT_NAME}"
mkdir -p "$(dirname "$OUT_PATH")"

cd "$ROOT"
go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o "$OUT_PATH" ./cmd/server

echo "已构建: $OUT_PATH (GOOS=${GOOS} GOARCH=${GOARCH_RAW} version=${VERSION})"