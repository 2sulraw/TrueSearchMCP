@echo off
setlocal EnableExtensions
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\TrueSearchMCP"
set "SHIMDIR=%APPDATA%\npm"

echo.
echo  TrueSearchMCP installer
echo  -----------------------

where node >nul 2>nul
if errorlevel 1 (
  echo  ERROR: Node.js not found. Install Node.js 18+ first: https://nodejs.org
  pause
  exit /b 1
)

if not exist "%SRC%build\index.js" (
  echo  ERROR: build\index.js not found next to this script.
  echo  Run install.bat from the extracted release folder.
  pause
  exit /b 1
)

echo  Installing to %DEST%
REM rename-first: fails cleanly if locked — never partially deletes like rmdir /s can
if exist "%DEST%" (
  move "%DEST%" "%DEST%.old" >nul 2>nul
  if exist "%DEST%" (
    echo  ERROR: install folder is in use. Close tsmcp/menu windows and re-run install.bat.
    pause
    exit /b 1
  )
  rmdir /s /q "%DEST%.old" >nul 2>nul
)
mkdir "%DEST%" || (pause & exit /b 1)
xcopy /e /i /y "%SRC%build" "%DEST%\build" >nul || (pause & exit /b 1)
copy /y "%SRC%package.json" "%DEST%\" >nul
if exist "%SRC%package-lock.json" copy /y "%SRC%package-lock.json" "%DEST%\" >nul
copy /y "%SRC%README.md" "%DEST%\" >nul
if exist "%SRC%LICENSE" copy /y "%SRC%LICENSE" "%DEST%\" >nul

if not exist "%DEST%\build\menu.js" (
  echo  ERROR: install incomplete - build\menu.js missing. Re-run install.bat.
  pause
  exit /b 1
)

echo  Installing dependencies (one-time, may take a minute)...
pushd "%DEST%" >nul
call npm install --omit=dev
popd >nul
if not exist "%DEST%\node_modules\better-sqlite3" (
  echo  WARNING: native dependency better-sqlite3 missing - check npm output above.
)
if not exist "%DEST%\build\menu.js" (
  echo  ERROR: install incomplete - build\menu.js missing. Re-run install.bat.
  pause
  exit /b 1
)

echo  Adding "tsmcp" command to %SHIMDIR%
if not exist "%SHIMDIR%" mkdir "%SHIMDIR%"
copy /y "%SRC%tsmcp.bat" "%SHIMDIR%\tsmcp.bat" >nul || (pause & exit /b 1)

echo.
where tsmcp >nul 2>nul
if errorlevel 1 (
  echo  NOTE: tsmcp is not on PATH yet. Add this folder to your user PATH:
  echo    %SHIMDIR%
) else (
  echo  Installed OK.
)
echo  Open a NEW terminal and type: tsmcp
echo.
pause
exit /b 0
