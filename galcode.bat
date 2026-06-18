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
    echo Galcode needs Node.js 20 or newer, but node.exe was not found.
    echo Install Node.js LTS from https://nodejs.org and reopen PowerShell.
    exit /b 127
  )
  set "NODE=node"
)

for /f "delims=" %%v in ('"%NODE%" -e "process.stdout.write(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%v"
if %NODE_MAJOR% LSS 20 (
  for /f "delims=" %%v in ('"%NODE%" --version') do set "NODE_VERSION=%%v"
  echo Galcode needs Node.js 20 or newer. Current version is %NODE_VERSION%.
  exit /b 1
)

"%NODE%" "%ROOT_DIR%\bin\galcode.js" %*
exit /b %ERRORLEVEL%
