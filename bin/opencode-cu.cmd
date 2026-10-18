@echo off
setlocal
set DSH_CU_THEME=opencode
node "%~dp0..\src\cli.js" %*
