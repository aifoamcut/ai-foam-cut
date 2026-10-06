@echo off
setlocal
cd /d "%~dp0"
title AI Foam Cut - Build-Tool (Electron Win7-32)
where py >nul 2>&1
if %errorlevel%==0 (set PY=py -3) else (set PY=python)
%PY% build_tool_electron_win7.py %*
if %errorlevel% neq 0 pause
