@echo off
setlocal EnableExtensions
set "SRC=%~dp0"
set "DEST=%LOCALAPPDATA%\TrueSearchMCP"
set "SHIMDIR=%APPDATA%\npm"

echo.
echo  TrueSearchMCP installer
echo  -----------------------

where node >nul 2>nul
if errorlevel 1 goto :no_node

if exist "%SRC%build\index.js" goto :have_build
if exist "%SRC%src\index.ts" goto :build_source
goto :no_build

:build_source
echo  Source checkout detected - installing dev dependencies and building...
pushd "%SRC%" >nul
call npm install
popd >nul
if exist "%SRC%build\index.js" goto :have_build
goto :no_build

:have_build
echo  Installing to %DEST%
REM rename-first: fails cleanly if locked - never partially deletes like rmdir /s can
if not exist "%DEST%" goto :dest_new
move "%DEST%" "%DEST%.old" >nul 2>nul
if exist "%DEST%" goto :dest_locked
rmdir /s /q "%DEST%.old" >nul 2>nul

:dest_new
mkdir "%DEST%" >nul 2>nul
if not exist "%DEST%" goto :mkdir_fail
xcopy /e /i /y "%SRC%build" "%DEST%\build" >nul
if not exist "%DEST%\build" goto :copy_fail
copy /y "%SRC%package.json" "%DEST%\" >nul
if exist "%SRC%package-lock.json" copy /y "%SRC%package-lock.json" "%DEST%\" >nul
copy /y "%SRC%README.md" "%DEST%\" >nul
if exist "%SRC%LICENSE" copy /y "%SRC%LICENSE" "%DEST%\" >nul
if exist "%SRC%uninstall.bat" copy /y "%SRC%uninstall.bat" "%DEST%\" >nul

if not exist "%DEST%\build\menu.js" goto :incomplete

echo  Installing dependencies (one-time, may take a minute)...
pushd "%DEST%" >nul
call npm install --omit=dev
popd >nul
if errorlevel 1 goto :npm_fail
if not exist "%DEST%\node_modules\better-sqlite3" (
  echo  WARNING: native dependency better-sqlite3 missing - check npm output above.
)
if not exist "%DEST%\build\menu.js" goto :incomplete

echo  Adding "tsmcp" command to %SHIMDIR%
if not exist "%SHIMDIR%" mkdir "%SHIMDIR%"
copy /y "%SRC%tsmcp.bat" "%SHIMDIR%\tsmcp.bat" >nul
if errorlevel 1 goto :shim_fail

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

:no_node
echo  ERROR: Node.js not found. Install Node.js 18+ first: https://nodejs.org
pause
exit /b 1

:no_build
echo  ERROR: build\index.js not found and could not be built.
echo  - Release ZIP: run install.bat from inside the extracted TrueSearchMCP folder
echo  - Source checkout: needs Node.js 18+, then run "npm install" first
pause
exit /b 1

:dest_locked
echo  ERROR: install folder is in use. Close tsmcp/menu windows and re-run install.bat.
pause
exit /b 1

:mkdir_fail
echo  ERROR: could not create %DEST%
pause
exit /b 1

:copy_fail
echo  ERROR: failed to copy build files to %DEST%
pause
exit /b 1

:incomplete
echo  ERROR: install incomplete - build\menu.js missing. Re-run install.bat.
pause
exit /b 1

:npm_fail
echo  ERROR: npm install failed - check the output above. Re-run install.bat.
pause
exit /b 1

:shim_fail
echo  ERROR: could not write %SHIMDIR%\tsmcp.bat
pause
exit /b 1
