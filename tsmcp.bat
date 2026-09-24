@echo off
if "%~1"=="" (
  node "%LOCALAPPDATA%\TrueSearchMCP\build\menu.js"
) else (
  node "%LOCALAPPDATA%\TrueSearchMCP\build\cli.js" %*
)
if errorlevel 1 (
  echo.
  echo tsmcp exited with an error. If this persists, re-run install.bat
  pause
)
exit /b %errorlevel%
