@echo off
REM Install WOW-CSG Fitness on a connected Android phone (USB debugging ON).
REM This prints the real Android error if install fails (e.g. INSTALL_FAILED_*).

setlocal
set SDK=%LOCALAPPDATA%\Android\Sdk
set ADB=%SDK%\platform-tools\adb.exe
set APK=%~dp0..\downloads\WOW-CSG-Fitness.apk

if not exist "%ADB%" (
  echo ERROR: adb not found at %ADB%
  echo Install Android Platform-Tools or Android Studio first.
  pause
  exit /b 1
)
if not exist "%APK%" (
  echo ERROR: APK not found at %APK%
  pause
  exit /b 1
)

echo.
echo Connecting...
"%ADB%" start-server
"%ADB%" devices -l
echo.
echo If your Redmi shows "Allow USB debugging", tap Allow.
echo.
echo Uninstalling any old build (ignore errors if not installed)...
"%ADB%" uninstall com.csgi.wowcsgfitness
"%ADB%" uninstall com.csgi.wowcsg.fitness
echo.
echo Installing %APK% ...
"%ADB%" install -r -d --user 0 "%APK%"
set ERR=%ERRORLEVEL%
echo.
if %ERR% neq 0 (
  echo INSTALL FAILED with exit code %ERR%
  echo Copy the INSTALL_FAILED_* line above and send it for support.
) else (
  echo SUCCESS. Launch WOW-CSG Fitness on the phone.
)
echo.
pause
