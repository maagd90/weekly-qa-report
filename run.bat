@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if "%~1"=="" goto help
if /I "%~1"=="setup" goto setup
if /I "%~1"=="dev" goto dev
if /I "%~1"=="build" goto build
if /I "%~1"=="test" goto test
if /I "%~1"=="generate" goto generate
if /I "%~1"=="help" goto help
if /I "%~1"=="-h" goto help
if /I "%~1"=="--help" goto help

echo error: unknown command "%~1"
echo Run: run.bat help
exit /b 1

:ensure_runtime
if not exist input mkdir input
if not exist output mkdir output
if not exist config mkdir config
if not exist config\runtime.json copy config\runtime.example.json config\runtime.json
if not exist config\integrations.json copy config\integrations.example.json config\integrations.json
exit /b 0

:setup
call :ensure_runtime
call npm install
echo Setup complete. Use the Settings screen for credentials. Optional server runtime overrides are in config\runtime.json.
exit /b 0

:dev
if not exist node_modules call npm install
call :ensure_runtime
echo Starting dev servers (API http://localhost:3001, UI http://localhost:3000)
call npm run dev
exit /b %ERRORLEVEL%

:build
call npm run build
exit /b %ERRORLEVEL%

:test
call npm test
exit /b %ERRORLEVEL%

:generate
shift
call npm run generate -- %*
exit /b %ERRORLEVEL%

:help
echo.
echo Weekly QA Dashboard - Windows runner
echo.
echo   run.bat setup      First-time setup (runtime config, folders, npm install)
echo   run.bat dev        Start API + UI
echo   run.bat build      Production build
echo   run.bat test       Parser tests
echo   run.bat generate   CLI report generation
echo.
echo Configure credentials from the Settings screen.
echo Optional server runtime overrides are stored in config\runtime.json.
echo.
exit /b 0
