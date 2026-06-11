@echo off
chcp 65001 > nul
title Shiftee Server Stop
echo Stopping Shiftee server (port 3000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
echo Done.
timeout /t 3 >nul
