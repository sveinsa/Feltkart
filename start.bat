@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js er ikke installert. Last ned LTS fra https://nodejs.org og kjor denne filen paa nytt.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installerer pakker, dette tar et minutt ...
  call npm install
)
echo Starter Feltkart. Apne http://localhost:5173 i nettleseren.
call npm run dev -- --open
pause
