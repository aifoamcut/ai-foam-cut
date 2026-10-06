@echo off
setlocal
cd /d "%~dp0"
title AI Foam Cut - Build-Tool (Windows 7 / 32 Bit)
rem Build-Tool mit Python 3.8 (32 Bit) starten. PyInstaller packt immer fuer
rem das Python, mit dem es laeuft - jede exe aus DIESEM Fenster ist deshalb
rem eine 32-Bit-exe, die ab Windows 7 SP1 laeuft (auch auf 64-Bit-Windows).
rem Python 3.8 ist die letzte Version fuer Windows 7.

py -3.8-32 -c "import sys" >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo  Python 3.8 ^(32 Bit^) fehlt. Bitte einmalig installieren:
  echo    https://www.python.org/ftp/python/3.8.10/python-3.8.10.exe
  echo  Im Installer "Add Python to PATH" NICHT anhaken - das vorhandene
  echo  Python bleibt dann der Standard. tcl/tk ^(tkinter^) und pip mitnehmen.
  echo.
  pause
  exit /b 1
)

rem PyInstaller 5.13.2: letzte Reihe, die Windows 7 noch offiziell bedient.
py -3.8-32 -c "import PyInstaller" >nul 2>&1
if %errorlevel% neq 0 (
  echo  PyInstaller 5.13.2 wird fuer Python 3.8 ^(32 Bit^) installiert ...
  py -3.8-32 -m pip install "pyinstaller==5.13.2"
  if errorlevel 1 (
    echo  *** PyInstaller liess sich nicht installieren ***
    pause
    exit /b 1
  )
)

echo.
echo  Windows-7-/32-Bit-Ausgabe: der exe im Build-Tool einen eigenen Namen
echo  geben ^(z.B. mit dem Zusatz "Win7-32"^), sonst ueberschreibt sie die
echo  normale 64-Bit-exe gleichen Namens im Ordner dist\.
echo.
py -3.8-32 build_tool.py %*
if %errorlevel% neq 0 pause
