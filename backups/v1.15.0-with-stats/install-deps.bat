@echo off
chcp 65001 >nul
title MmaGuessr 统计后端 - 依赖安装
echo 正在安装 express + better-sqlite3 ...
cd /d "%~dp0"
npm install express better-sqlite3 --no-audit --no-fund
if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络。
    pause
    exit /b 1
)
echo [完成] 依赖安装成功。
exit /b 0
