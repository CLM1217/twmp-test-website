@echo off
setlocal
set "TWMP_NODE=node"
where node >nul 2>&1
if errorlevel 1 (
  set "TWMP_NODE="
  for /d %%D in ("%LOCALAPPDATA%\OpenAI\Codex\runtimes\cua_node\*") do (
    if exist "%%~fD\bin\node.exe" set "TWMP_NODE=%%~fD\bin\node.exe"
  )
)
if not defined TWMP_NODE (
  echo Node.js 20 or newer is required. Please install Node.js and try again.
  pause
  exit /b 1
)
"%TWMP_NODE%" "%~dp0server.mjs"
