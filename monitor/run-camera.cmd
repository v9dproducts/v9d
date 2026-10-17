@echo off
rem Keeps the camera relay (go2rtc) running: restarts it 5 seconds after it stops.
cd /d "%~dp0go2rtc"
:loop
go2rtc.exe -config go2rtc.yaml >> go2rtc.log 2>&1
ping -n 6 127.0.0.1 >nul
goto loop
