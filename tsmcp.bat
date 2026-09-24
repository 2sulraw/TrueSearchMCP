@echo off
if "%~1"=="" (
  node "%LOCALAPPDATA%\TrueSearchMCP\build\menu.js"
) else (
  node "%LOCALAPPDATA%\TrueSearchMCP\build\cli.js" %*
)
