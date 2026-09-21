@echo off
call "%~1" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 exit /b %errorlevel%
set
