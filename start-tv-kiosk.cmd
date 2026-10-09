@echo off
rem ======================================================
rem NEXUS TV ENTERPRISE - KIOSK SAFE LAUNCHER (WINDOWS CMD)
rem ======================================================
rem Ejecuta start-tv-kiosk.ps1 aplicando bypass de ExecutionPolicy
rem exclusivamente en la memoria del subproceso, preservando intacta
rem la politica de seguridad global del sistema operativo Windows.
rem ======================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-tv-kiosk.ps1" %*
