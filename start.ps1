# SyncWatch 一键启动脚本
# 自动启动后端服务 + Cloudflare 隧道，并显示连接信息

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   SyncWatch 一键启动" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否在项目目录
if (-not (Test-Path "package.json")) {
    Write-Host "[错误] 请在项目根目录运行此脚本" -ForegroundColor Red
    exit 1
}

# --- 1. 检查/启动后端服务 ---
$serverRunning = $false
try {
    $conn = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
    if ($conn) {
        Write-Host "[后端] 端口 3001 已在运行，跳过启动" -ForegroundColor Green
        $serverRunning = $true
    }
} catch {}

if (-not $serverRunning) {
    Write-Host "[后端] 正在启动..." -ForegroundColor Yellow
    Start-Process -FilePath "npm" -ArgumentList "run", "server:dev" -WindowStyle Hidden
    # 等待端口就绪
    $retries = 0
    while ($retries -lt 15) {
        Start-Sleep -Seconds 1
        try {
            $conn = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
            if ($conn) {
                Write-Host "[后端] 已启动 (端口 3001)" -ForegroundColor Green
                $serverRunning = $true
                break
            }
        } catch {}
        $retries++
    }
    if (-not $serverRunning) {
        Write-Host "[后端] 启动超时，请手动检查" -ForegroundColor Red
        exit 1
    }
}

# --- 2. 获取局域网 IP ---
$lanIp = ""
try {
    $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
} catch {}
if (-not $lanIp) {
    try {
        $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "10.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
    } catch {}
}

# --- 3. 启动 Cloudflare 隧道 ---
Write-Host ""
Write-Host "[隧道] 正在启动 Cloudflare 隧道..." -ForegroundColor Yellow

# 检查 cloudflared 是否安装
$cfInstalled = $false
try {
    $null = Get-Command cloudflared -ErrorAction Stop
    $cfInstalled = $true
} catch {}

if (-not $cfInstalled) {
    Write-Host "[隧道] 未安装 cloudflared，正在安装..." -ForegroundColor Yellow
    winget install cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
    # 刷新 PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 启动隧道并捕获输出
$tempLog = [System.IO.Path]::GetTempFileName()
$cfProcess = Start-Process -FilePath "cloudflared" -ArgumentList "tunnel", "--url", "http://localhost:3001" -WindowStyle Hidden -PassThru -RedirectStandardOutput $tempLog

# 等待获取公网地址
Start-Sleep -Seconds 5
$publicUrl = ""
$attempts = 0
while ($attempts -lt 20) {
    try {
        $logContent = Get-Content $tempLog -Raw -ErrorAction SilentlyContinue
        if ($logContent -match "https://[a-z0-9-]+\.trycloudflare\.com") {
            $publicUrl = [regex]::Match($logContent, "https://[a-z0-9-]+\.trycloudflare\.com").Value
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
    $attempts++
}

# --- 4. 显示连接信息 ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   连接信息" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  电脑端（本机浏览器/Electron）:" -ForegroundColor White
Write-Host "  http://localhost:3001" -ForegroundColor Green
Write-Host ""
Write-Host "  手机端（同一WiFi）:" -ForegroundColor White
if ($lanIp) {
    Write-Host "  http://${lanIp}:3001" -ForegroundColor Green
} else {
    Write-Host "  （未检测到局域网 IP）" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  手机端（不同网络，通过公网隧道）:" -ForegroundColor White
if ($publicUrl) {
    Write-Host "  $publicUrl" -ForegroundColor Green
} else {
    Write-Host "  （隧道地址获取中，请稍候查看上方输出）" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：" -ForegroundColor DarkGray
Write-Host "  - 在手机端 APP 的'服务器设置'中填入上面的地址" -ForegroundColor DarkGray
Write-Host "  - 按 Ctrl+C 可停止所有服务" -ForegroundColor DarkGray
Write-Host ""

# 保持脚本运行
try {
    Wait-Process -Id $cfProcess.Id -ErrorAction SilentlyContinue
} catch {
    Read-Host "按回车键退出"
}
