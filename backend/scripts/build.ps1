# MmaGuessr backend 跨平台构建脚本 (Windows PowerShell)
# 用法:
#   .\scripts\build.ps1                     # 构建当前平台到 bin\mma-guessr[.exe]
#   .\scripts\build.ps1 -Version v1.2.3     # 注入版本号
#   .\scripts\build.ps1 -OutDir dist        # 自定义输出目录
#   $env:GOOS="linux"; .\scripts\build.ps1  # 交叉编译(输出 bin\mma-guessr-linux-amd64)
# 产物统一写入 bin\(或 -OutDir), 不再污染源码目录。

param(
    [string]$Version = "dev",
    [string]$OutDir = "bin"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "未找到 Go 工具链, 请先安装 go"
}

$goos = $env:GOOS
$goarch = $env:GOARCH
$explicitTarget = $false
if ($goos) { $explicitTarget = $true }
if (-not $goos) {
    $goos = if ($env:OS -eq "Windows_NT") { "windows" } else { "linux" }
}
if (-not $goarch) { $goarch = "amd64" }

if ($explicitTarget) {
    $outName = "mma-guessr-$goos-$goarch"
} else {
    $outName = "mma-guessr"
}
if ($goos -eq "windows") { $outName += ".exe" }

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$out = Join-Path $root (Join-Path $OutDir $outName)
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null

Push-Location $root
try {
    $ldflags = "-s -w -X main.version=$Version"
    go build -trimpath -ldflags $ldflags -o $out ./cmd/server
    if ($LASTEXITCODE -ne 0) { throw "go build 失败 (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host "已构建: $out (GOOS=$goos GOARCH=$goarch version=$Version)"