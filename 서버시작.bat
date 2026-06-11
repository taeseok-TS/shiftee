@echo off
chcp 65001 > nul
title Shiftee Server
echo ============================================
echo   Shiftee server starting...
echo   http://localhost:3000
echo   (Close this window to stop the server)
echo ============================================
cd /d C:\shiftee\apps\web
npm run dev
pause
