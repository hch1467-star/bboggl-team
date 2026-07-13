@echo off
chcp 65001 >nul
title Bboggl-Team 로컬 서버
echo Bboggl-Team 서버를 시작합니다 (포트 5174). 이 창을 닫으면 서버가 꺼져요.
echo.

start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:5174/index.html"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

pause
