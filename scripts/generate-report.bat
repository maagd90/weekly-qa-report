@echo off
setlocal
cd /d "%~dp0.."

if "%START_DATE%"=="" set /p START_DATE=Start date (YYYY-MM-DD): 
if "%END_DATE%"=="" set /p END_DATE=End date (YYYY-MM-DD): 
if "%REPORT_TYPE%"=="" set REPORT_TYPE=full

call npm run generate --workspace=apps/batch -- --start-date %START_DATE% --end-date %END_DATE% --report-type %REPORT_TYPE%
exit /b %ERRORLEVEL%
