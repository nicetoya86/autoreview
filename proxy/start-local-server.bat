@echo off
cd /d "%~dp0"
netstat -ano | findstr "LISTENING" | findstr ":3000 " >nul
if %errorlevel%==0 (
  echo [review-proxy] already running on port 3000
) else (
  start "review-proxy" /min cmd /c "npm run dev:local"
  echo [review-proxy] started on port 3000
)
