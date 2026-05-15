@echo off
setlocal
title ScrollLearn installer
echo ScrollLearn installer
echo =====================
echo.
echo If Windows SmartScreen blocked this file, click "More info" then
echo "Run anyway" to continue. The installer is open source - source at
echo https://github.com/tasszz2k/scroll-learn
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.ps1 | iex"
echo.
pause
endlocal
