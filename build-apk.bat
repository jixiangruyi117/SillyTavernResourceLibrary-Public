@echo off
setlocal

cd /d "%~dp0"
title SRL Packaged APK Build

echo ========================================
echo   SRL Packaged APK Debug Build
echo ========================================
echo.
echo UI: Vue bundled inside APK + Android native capabilities
echo Project: %CD%
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Build-AndroidApk.ps1" -Mode Packaged -Variant Debug
if errorlevel 1 (
    echo.
    echo [FAILED] Keep the build log above.
    pause
    exit /b 1
)

set "APK_PATH=%~dp0android\app\build\outputs\apk\debug\app-debug.apk"
if not exist "%APK_PATH%" (
    echo.
    echo [FAILED] APK not found:
    echo %APK_PATH%
    pause
    exit /b 1
)

echo.
echo [SUCCESS] APK generated:
echo %APK_PATH%
start "" explorer.exe /select,"%APK_PATH%"
pause
