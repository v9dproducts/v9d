@echo off
rem Keeps the V9D monitor running: restarts it 5 seconds after it stops for any reason.
cd /d "%~dp0"
:loop
node monitor.js >> data\monitor.log 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
