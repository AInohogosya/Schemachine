@echo off
REM SCHEMACHINE one-command launcher (Windows).
REM Checks node+npm, installs deps, builds, serves on http://localhost:3000
REM and opens the default browser.
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=3000
set URL=http://localhost:%PORT%

where node >nul 2>nul
if errorlevel 1 (
  echo SCHEMACHINE: 'node' is required but was not found on PATH.
  echo Please install Node.js v18+ (https://nodejs.org) and re-run start.bat
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo SCHEMACHINE: 'npm' is required but was not found on PATH.
  exit /b 1
)

if not exist node_modules (
  echo SCHEMACHINE: installing dependencies (first run)...
  call npm install --no-audit --no-fund
  if errorlevel 1 exit /b 1
)

if not exist dist\index.html (
  echo SCHEMACHINE: building production bundle...
  call npm run build
  if errorlevel 1 exit /b 1
) else (
  echo SCHEMACHINE: build found, starting server. Delete .\dist to force a rebuild.
)

echo SCHEMACHINE: starting server at %URL%
start "" "%URL%"
call npm run serve
