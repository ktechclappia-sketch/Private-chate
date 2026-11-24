@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Privacy Chat APK - Java 21 Auto Fix

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0BUILD_APK_JAVA21.ps1"
set "BUILD_RESULT=%ERRORLEVEL%"
echo.
if "%BUILD_RESULT%"=="0" (
    echo APK build completed successfully.
) else (
    echo APK could not be built. Please share a screenshot of the error above.
)
echo.
pause
exit /b %BUILD_RESULT%
