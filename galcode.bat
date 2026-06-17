@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

if exist "%ROOT_DIR%\tools\bin\node.exe" (
  set "PATH=%ROOT_DIR%\tools\bin;%PATH%"
  set "NODE=%ROOT_DIR%\tools\bin\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Galcode needs Node.js 20 or newer, but node.exe was not found.
    echo Install Node.js LTS from https://nodejs.org and reopen PowerShell.
    exit /b 127
  )
  set "NODE=node"
)

"%NODE%" "%ROOT_DIR%\bin\galcode.js" %*
exit /b %ERRORLEVEL%
