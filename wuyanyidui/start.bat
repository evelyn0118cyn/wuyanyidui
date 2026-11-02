@echo off
chcp 65001 >nul
setlocal
title 财务舞弊111 - 本地服务
cd /d "%~dp0"

echo ============================================================
echo   财务舞弊111 - 舞弊审计调查 AI 助理（本地服务）
echo ============================================================
echo.

rem ---- 查找 Node.js ----
set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
)
if not defined NODE_EXE (
  if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
)
if not defined NODE_EXE (
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
)

if not defined NODE_EXE (
  echo [提示] 未找到 Node.js。
  echo        本项目的「大模型API」与「MySQL 数据库接入」需要 Node.js 运行本地代理。
  echo        请安装 Node.js 18+ : https://nodejs.org/
  echo.
  echo        即使不安装，仍可直接双击 web\index.html 使用全部离线功能
  echo        （预置数据、风险筛查、线索梳理、评分、报告导出均可正常运行）。
  echo.
  pause
  exit /b 1
)

echo [1/3] Node.js 版本：
"%NODE_EXE%" -v
echo.

rem ---- 读取 .env 配置（若存在）----
if exist "%~dp0.env" (
  echo [2/3] 已加载 .env 配置文件
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~dp0.env") do (
    if not "%%~a"=="" set "%%a=%%~b"
  )
) else (
  echo [2/3] 未找到 .env 配置（将使用默认设置，可在页面「大模型API设置」中配置）
)
echo.

set "PORT=5178"
if defined FRAUD111_PORT set "PORT=%FRAUD111_PORT%"

echo [3/3] 启动本地服务 http://127.0.0.1:%PORT%
echo       浏览器将自动打开，关闭本窗口即停止服务。
echo.
echo ------------------------------------------------------------

start "" "http://127.0.0.1:%PORT%/web/index.html"
"%NODE_EXE%" "server\server.js"

echo.
echo 服务已停止。
pause
