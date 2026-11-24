@echo off
chcp 65001 >nul
title 一键打包 · 题库与讲义系统
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  没有找到 Node.js。
  echo  打包需要 Node.js，请到 https://nodejs.org 下载 LTS 版本安装后再试。
  echo  注意：只有你这台改代码、打包的电脑需要装，老师那边不需要。
  echo.
  pause
  exit /b 1
)

echo.
echo  即将打包。第一次会自动下载对应平台的 Node 运行时（约 50MB），
echo  之后再打包就不需要联网了。整个过程约 1～3 分钟。
echo.
echo  1 = 只打 Windows 单文件版（最常用，约 58MB）
echo  2 = 只打 Mac（Apple 芯片 + Intel）
echo  3 = Windows + Mac 全部
echo  4 = 只把现有程序重新压成发布包（不重新打包）
echo  5 = 打桌面版 Electron（安装版 + 免安装版，各约 115MB）
echo.
set /p choice=请输入序号后回车（直接回车 = 1）：

if "%choice%"=="" set choice=1
if "%choice%"=="1" set mode=win
if "%choice%"=="2" set mode=mac
if "%choice%"=="3" set mode=all
if "%choice%"=="4" set mode=zip
if "%choice%"=="5" set mode=electron
if not defined mode set mode=win

if "%mode%"=="electron" goto electron

node tools/build.js %mode%
goto done

:electron
echo.
echo 正在打桌面版（Electron）。第一次会下载约 100MB 的 Electron 运行时……
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npx electron-builder --win --config electron-builder.json
copy /y "dist-electron\题库与讲义系统-安装版-1.3.0.exe" "dist\发布包\" >nul 2>nul
copy /y "dist-electron\题库与讲义系统-免安装版.exe" "dist\发布包\" >nul 2>nul
goto done

:done
echo.
echo  完成。程序在 dist 目录，给老师的压缩包在 dist\发布包 目录。
echo  桌面版在 dist-electron 目录。
echo.
pause
