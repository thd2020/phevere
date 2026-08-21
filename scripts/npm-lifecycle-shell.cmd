@echo off
set ELECTRON_SKIP_BINARY_DOWNLOAD=1
if "%~1"=="-c" (
  %ComSpec% /d /s /c %~2
) else (
  %ComSpec% /d /s /c %*
)
