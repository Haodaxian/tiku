@echo off
chcp 65001 >nul
title 题库与讲义系统 · 开发模式
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  没有找到 Node.js，请到 https://nodejs.org 下载 LTS 版本安装后再试。
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo   开发模式（直接运行源码，不打包）
echo  ============================================================
echo.
echo   · 改界面（public 下的 tpl / js / css）：存盘后在浏览器
echo     按 Ctrl+F5 就能看到效果，不用重启。
echo   · 改后端（server.js、lib 下的文件）：关掉这个窗口重新双击。
echo   · 数据写在项目的 data 目录，和打包后的成品互不影响。
echo   · 手动打开：http://127.0.0.1:7788
echo.
echo  关闭这个窗口即退出（数据自动保存）。
echo.

node server.js %*

echo.
echo  程序已停止。
pause
