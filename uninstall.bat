@echo off
setlocal EnableExtensions
set "DEST=%LOCALAPPDATA%\TrueSearchMCP"
set "SHIM=%APPDATA%\npm\tsmcp.bat"

echo.
echo  TrueSearchMCP uninstaller
echo  -------------------------

if exist "%SHIM%" (
  del /f /q "%SHIM%"
  echo  Removed: %SHIM%
) else (
  echo  Shim not found (already removed?)
)

if exist "%DEST%" (
  echo  Removing: %DEST%
  rmdir /s /q "%DEST%"
  if exist "%DEST%" (
    echo  ERROR: could not fully remove %DEST% - close tsmcp/menu and re-run.
    pause
    exit /b 1
  )
  echo  Removed: %DEST%
) else (
  echo  Install dir not found (already removed?)
)

echo.
echo  Done. Note: MCP entries added to harness configs (Claude Desktop/Code,
echo  Hermes, OpenCode, etc.) are NOT removed automatically - edit those
echo  configs manually if you want them gone.
echo.
pause
exit /b 0
