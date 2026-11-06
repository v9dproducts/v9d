@echo off
rem Keeps the V9D monitor running: restarts it 5 seconds after it stops for any reason.
cd /d "%~dp0"
:loop
rem Move a log over 5 MB aside before (re)starting, so it never grows without limit.
for %%F in ("data\monitor.log") do if %%~zF GTR 5242880 move /y "data\monitor.log" "data\monitor.old.log" >nul
node monitor.js >> data\monitor.log 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
