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

:setup
call npm install
if not exist .env copy .env.example .env
if not exist input mkdir input
if not exist output mkdir output
if not exist config mkdir config
if not exist config\integrations.json copy config\integrations.example.json config\integrations.json
echo Setup complete. Edit .env then run: run.bat dev
exit /b 0

:dev
if not exist node_modules call npm install
echo Starting dev servers (API http://localhost:3001, UI http://localhost:3000)
echo .env is loaded automatically — do NOT use "source .env" in Git Bash.
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
echo DLM QA Dashboard — Windows runner
echo.
echo   run.bat setup      First-time setup (.env, folders, npm install)
echo   run.bat dev        Start API + UI (loads .env automatically)
echo   run.bat build      Production build
echo   run.bat test       Parser tests
echo   run.bat generate   CLI report generation
echo.
echo Edit .env in the repo root. Quote paths with spaces, e.g.:
echo   PUPPETEER_EXECUTABLE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
echo.
exit /b 0
