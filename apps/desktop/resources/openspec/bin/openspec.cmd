@echo off
:: Churro Coder — OpenSpec CLI shim (Windows).
:: Preferred: run via Electron's built-in Node runtime (CSCODE_ELECTRON_PATH).
:: Fallback: use node.exe from PATH when the env var isn't forwarded by the agent.
setlocal
set "SCRIPT_DIR=%~dp0"
set "PKG_ENTRY=%SCRIPT_DIR%..\pkg\bin\openspec.js"
set "ELECTRON_ENTRY=%SCRIPT_DIR%openspec-electron-entry.mjs"
if not defined OPENSPEC_TELEMETRY set "OPENSPEC_TELEMETRY=0"
if not "%CSCODE_ELECTRON_PATH%"=="" (
  :: Use the wrapper so process.defaultApp=true is set before Commander parses argv.
  :: Without it, Commander's Electron auto-detection applies argv.slice(1) and treats
  :: the script path as a CLI subcommand ("unknown command" for all non-flag args).
  set "ELECTRON_RUN_AS_NODE=1"
  "%CSCODE_ELECTRON_PATH%" "%ELECTRON_ENTRY%" %*
  exit /b %ERRORLEVEL%
)
where node >nul 2>&1
if %ERRORLEVEL%==0 (
  node "%PKG_ENTRY%" %*
  exit /b %ERRORLEVEL%
)
echo openspec: CSCODE_ELECTRON_PATH is not set and 'node' was not found in PATH. 1>&2
exit /b 1
endlocal
