@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
cd /d "%ROOT_DIR%"

if exist "%ROOT_DIR%\tools\bin\node.exe" (
  set "PATH=%ROOT_DIR%\tools\bin;%PATH%"
  set "NODE=%ROOT_DIR%\tools\bin\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Galcode needs Node.js 22.19+ or 24+, but node.exe was not found.
    echo Install Node.js LTS from https://nodejs.org and reopen PowerShell.
    exit /b 127
  )
  set "NODE=node"
)

for /f "tokens=1,2 delims=." %%a in ('"%NODE%" -e "process.stdout.write(process.versions.node)"') do (
  set "NODE_MAJOR=%%a"
  set "NODE_MINOR=%%b"
)
set "NODE_OK=1"
if %NODE_MAJOR% LSS 22 set "NODE_OK=0"
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% LSS 19 set "NODE_OK=0"
if %NODE_MAJOR% EQU 23 set "NODE_OK=0"
if "%NODE_OK%"=="0" (
  for /f "delims=" %%v in ('"%NODE%" --version') do set "NODE_VERSION=%%v"
  echo Galcode needs Node.js 22.19+ or 24+. Current version is %NODE_VERSION%.
  exit /b 1
)

"%NODE%" "%ROOT_DIR%\bin\galcode.js" %*
exit /b %ERRORLEVEL%
