@echo off
chcp 65001 >nul
title Tro ly Dispatch Board
cd /d "%~dp0"

echo ============================================================
echo   TRO LY DISPATCH BOARD - cai dat va chay tu dong
echo   Cua so nay phai MO trong luc lam viec. Dong = tro ly tat.
echo ============================================================
echo.

rem --- 1. Tim Python ---
where python >nul 2>nul
if %errorlevel%==0 goto :have_python

echo [1/3] Chua co Python - dang cai tu dong (mat vai phut)...
where winget >nul 2>nul
if %errorlevel%==0 (
    winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
) else (
    echo Khong co winget. Dang tai bo cai Python...
    powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '%TEMP%\python-install.exe'"
    "%TEMP%\python-install.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1
)
rem Nap lai PATH sau khi cai
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
where python >nul 2>nul
if not %errorlevel%==0 (
    echo.
    echo [LOI] Khong cai duoc Python tu dong. Hay nho IT cai Python 3 roi chay lai file nay.
    pause
    exit /b 1
)

:have_python
echo [1/3] Python: OK

rem --- 2. Cai thu vien (chi mat thoi gian lan dau) ---
echo [2/3] Dang kiem tra thu vien...
python -m pip install --quiet --disable-pip-version-check requests pywin32 openpyxl selenium
if not %errorlevel%==0 (
    echo [LOI] Khong cai duoc thu vien - kiem tra mang roi chay lai.
    pause
    exit /b 1
)
echo [2/3] Thu vien: OK

rem --- 3. Chay tro ly (tu chay lai neu bi rot) ---
echo [3/3] Dang chay tro ly...
:run_loop
python "%~dp0pc_agent.py"
echo.
echo Tro ly vua dung - tu chay lai sau 10 giay. (Dong cua so nay de tat han.)
timeout /t 10 /nobreak >nul
goto :run_loop
