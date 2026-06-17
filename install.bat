@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "ROOT_DIR=%CD%"
set "WEBGAL_DIR=%ROOT_DIR%\vendor\webgal-mygo"

echo ========================================
echo  Galcode Windows Installer
echo ========================================
echo.

echo [1/4] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org and reopen PowerShell.
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS and make sure Add to PATH is enabled.
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo        Node.js: %NODE_VERSION%
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo Galcode needs Node.js 20 or newer.
  echo Current version is %NODE_VERSION%. Install the latest Node.js LTS, then retry.
  exit /b 1
)

echo.
echo [2/4] Installing Galcode dependencies...
call npm install --include=optional
if errorlevel 1 exit /b %ERRORLEVEL%

if exist "%ROOT_DIR%\node_modules\electron\install.js" (
  if not exist "%ROOT_DIR%\node_modules\electron\dist\electron.exe" (
    echo        Electron runtime missing, fixing...
    if exist "%ROOT_DIR%\node_modules\electron\dist" rmdir /s /q "%ROOT_DIR%\node_modules\electron\dist"
    if exist "%ROOT_DIR%\node_modules\electron\path.txt" del /q "%ROOT_DIR%\node_modules\electron\path.txt"
    pushd "%ROOT_DIR%\node_modules\electron"
    node install.js
    if errorlevel 1 (
      popd
      exit /b 1
    )
    popd
  )
)

echo.
echo [3/4] Preparing WebGAL engine...
if not exist "%WEBGAL_DIR%\packages\webgal\package.json" (
  echo        WebGAL engine is incomplete. Downloading a fresh copy...
  call :download_webgal
  if errorlevel 1 exit /b 1
)
if not exist "%WEBGAL_DIR%\packages\webgal\package.json" (
  echo WebGAL package was not found after download: %WEBGAL_DIR%\packages\webgal\package.json
  exit /b 1
)
echo        Engine: OK

if not exist "%WEBGAL_DIR%\node_modules" (
  echo        Installing WebGAL dependencies...
  pushd "%WEBGAL_DIR%"
  call npm install --legacy-peer-deps
  if errorlevel 1 (
    popd
    exit /b 1
  )
  popd
)

if not exist "%WEBGAL_DIR%\packages\parser\build\es\index.js" (
  if exist "%WEBGAL_DIR%\packages\parser\package.json" (
    echo        Building WebGAL parser...
    pushd "%WEBGAL_DIR%\packages\parser"
    call npm run build
    if errorlevel 1 (
      popd
      exit /b 1
    )
    popd
  )
)

echo.
echo [4/4] Checking Galcode launcher...
call "%ROOT_DIR%\galcode.bat" --help >nul
if errorlevel 1 (
  echo Galcode launcher check failed.
  exit /b 1
)

echo.
echo Done!
echo Run: .\galcode yolo --offline --duration 30 --record --out outputs\first-test
exit /b 0

:download_webgal
set "GALCODE_ROOT=%ROOT_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=$env:GALCODE_ROOT;" ^
  "$vendor=Join-Path $root 'vendor';" ^
  "$target=Join-Path $vendor 'webgal-mygo';" ^
  "New-Item -ItemType Directory -Force -Path $vendor | Out-Null;" ^
  "if (Test-Path $target) { Remove-Item $target -Recurse -Force };" ^
  "$zip=Join-Path $env:TEMP ('webgal-mygo-' + [guid]::NewGuid().ToString() + '.zip');" ^
  "Invoke-WebRequest -Uri 'https://github.com/boomwwww/webgal-mygo/archive/refs/heads/main.zip' -OutFile $zip;" ^
  "Expand-Archive -Force -Path $zip -DestinationPath $vendor;" ^
  "Remove-Item $zip -Force;" ^
  "$src=Get-ChildItem -Path $vendor -Directory -Filter 'webgal-mygo-*' | Select-Object -First 1;" ^
  "if (-not $src) { throw 'Extracted webgal-mygo folder not found' };" ^
  "Move-Item -Path $src.FullName -Destination $target;"
exit /b %ERRORLEVEL%
