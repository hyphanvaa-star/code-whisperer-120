@echo off
rem Khoi phuc PATH co ban (phong truong hop PATH bi loi khien chcp/powershell khong chay)
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
chcp 65001 >nul 2>&1
title Tro ly Dispatch Board
cd /d "%~dp0"

echo ============================================================
echo   TRO LY DISPATCH BOARD - cai dat va chay tu dong
echo   Chi cai lan dau. Xong se chay ngam, khong can giu CMD.
echo ============================================================
echo.

rem --- 1. Tim Python (thu nhieu cach) ---
set "PYCMD="

where python >nul 2>nul
if %errorlevel%==0 (
    set "PYCMD=python"
    goto :have_python
)

where py >nul 2>nul
if %errorlevel%==0 (
    set "PYCMD=py -3"
    goto :have_python
)

rem Thu cac duong dan cai dat thuong gap
for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
    "C:\Python310\python.exe"
    "%ProgramFiles%\Python313\python.exe"
    "%ProgramFiles%\Python312\python.exe"
    "%ProgramFiles%\Python311\python.exe"
) do (
    if exist %%P (
        set "PYCMD=%%~P"
        goto :have_python
    )
)

echo [1/3] Chua tim thay Python - dang cai tu dong (mat vai phut)...
where winget >nul 2>nul
if %errorlevel%==0 (
    winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
) else (
    echo Khong co winget. Dang tai bo cai Python...
    "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.7/python-3.12.7-amd64.exe' -OutFile '%TEMP%\python-install.exe'"
    "%TEMP%\python-install.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1
)
rem Nap lai PATH sau khi cai
set "PATH=%LOCALAPPDATA%\Programs\Python\Python312;%LOCALAPPDATA%\Programs\Python\Python312\Scripts;%PATH%"
where python >nul 2>nul
if %errorlevel%==0 (
    set "PYCMD=python"
) else (
    echo.
    echo [LOI] Khong cai duoc Python tu dong. Hay nho IT cai Python 3 roi chay lai file nay.
    pause
    exit /b 1
)

:have_python
echo [1/3] Python: OK (%PYCMD%)

rem --- 2. Cai thu vien (chi mat thoi gian lan dau) ---
echo [2/3] Dang kiem tra thu vien...
%PYCMD% -m pip install --quiet --disable-pip-version-check requests pywin32 openpyxl selenium
if not %errorlevel%==0 (
    echo [LOI] Khong cai duoc thu vien - kiem tra mang roi chay lai.
    pause
    exit /b 1
)
echo [2/3] Thu vien: OK

rem --- Bao ve ma: bien dich sang dang may doc, xoa ma nguon, an thu muc ---
if exist "%~dp0app\background.py" (
    echo [2/3] Dang bao ve ma nguon...
    %PYCMD% -m compileall -b -q -f "%~dp0app" >nul
    if exist "%~dp0app\background.pyc" if exist "%~dp0app\pc_agent.pyc" (
        del /s /q "%~dp0app\*.py" >nul 2>&1
        for /d /r "%~dp0app" %%D in (__pycache__) do rd /s /q "%%D" >nul 2>&1
    )
)
if exist "%~dp0app" attrib +h "%~dp0app" >nul 2>&1

rem --- Tu chay cung Windows: dat loi tat vao thu muc Startup cua nguoi dung ---
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Sohee-Agent.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0Chay-Ngam.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()" >nul 2>&1
echo [3/3] Da bat tu chay khi mo may.

rem --- 3. Chay ngam, khong de lai cua so CMD ---
echo [3/3] Dang mo tro ly chay ngam...
wscript.exe "%~dp0Chay-Ngam.vbs"
exit /b 0
