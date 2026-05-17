@echo off
REM ================================================================
REM  build-apk.bat — Build GYS Portal AI APK via Docker
REM  Tidak perlu install Android Studio atau Node.js lokal!
REM ================================================================
echo.
echo ========================================
echo   GYS Portal AI - APK Builder
echo ========================================
echo.

REM Cek Docker tersedia
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker tidak ditemukan! Pastikan Docker Desktop terinstall.
    echo         Download: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo [1/3] Building Docker image (termasuk React build + Android SDK)...
echo       Ini mungkin memakan waktu 10-20 menit pada build pertama.
echo.

docker build -f client/Dockerfile.apk -t gys-apk-builder ./client
if errorlevel 1 (
    echo.
    echo [ERROR] Docker build gagal!
    pause
    exit /b 1
)

echo.
echo [2/3] Generating APK...

REM Buat folder output jika belum ada
if not exist "apk-output" mkdir apk-output

docker run --rm -v "%cd%/apk-output:/output" gys-apk-builder
if errorlevel 1 (
    echo.
    echo [ERROR] APK generation gagal!
    pause
    exit /b 1
)

echo.
echo [3/3] Selesai!
echo.
echo ========================================
echo   APK tersedia di: apk-output\GYS-Portal-AI.apk
echo ========================================
echo.
echo   Cara install di HP Android:
echo   1. Transfer file APK ke HP via USB/WhatsApp/Email
echo   2. Buka file APK di HP
echo   3. Izinkan "Install dari sumber tidak dikenal"
echo   4. Tap "Install"
echo.
pause
