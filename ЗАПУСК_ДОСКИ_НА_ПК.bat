@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Whiteboard Pro 6.0

if not exist "index.html" (
  echo [!] Ошибка: файл index.html не найден рядом со скриптом.
  echo     Распакуйте весь архив в папку и запускайте этот файл внутри неё.
  echo.
  pause
  exit /b 1
)

if not exist "whiteboard-win-server.ps1" (
  echo [!] Ошибка: файл whiteboard-win-server.ps1 не найден рядом со скриптом.
  echo     Распакуйте весь архив целиком в одну папку.
  echo.
  pause
  exit /b 1
)

echo Запуск Whiteboard Pro 6.0 ^(Node.js не требуется^)...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0whiteboard-win-server.ps1"

if errorlevel 1 (
  echo.
  echo [!] Сервер завершился с ошибкой ^(код %errorlevel%^).
  pause
)
endlocal
