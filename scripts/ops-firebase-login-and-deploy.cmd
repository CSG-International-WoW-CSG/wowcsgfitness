@echo off
setlocal
cd /d "%~dp0.."
echo.
echo === WOW-CSG Firebase login + deploy Firestore rules ===
echo This opens a browser for Google login (needs a Firebase Owner/Editor on project wow-csg).
echo.
call npx firebase login
if errorlevel 1 (
  echo Login failed.
  exit /b 1
)
call npx firebase use wow-csg
call npx firebase deploy --only firestore:rules
if errorlevel 1 (
  echo Deploy failed.
  exit /b 1
)
echo.
echo Rules deployed. Next: seed admin doc if needed:
echo   node scripts/ops-seed-admin-privileged.mjs
echo.
pause
