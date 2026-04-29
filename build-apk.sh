#!/bin/bash
# ================================================================
#  build-apk.sh — Build GYS Portal AI APK via Docker (Linux/Mac)
#  Jalankan dari root project: ./build-apk.sh
# ================================================================
set -e

echo ""
echo "========================================"
echo "  GYS Portal AI - APK Builder"
echo "========================================"
echo ""

# Cek Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker tidak ditemukan!"
    exit 1
fi

echo "[1/3] Building Docker image..."
echo "      (10-20 menit pada build pertama)"
echo ""

docker build -f client/Dockerfile.apk -t gys-apk-builder ./client

echo ""
echo "[2/3] Generating APK..."

mkdir -p apk-output
docker run --rm -v "$(pwd)/apk-output:/output" gys-apk-builder

echo ""
echo "[3/3] Selesai!"
echo ""
echo "========================================"
echo "  APK: apk-output/GYS-Portal-AI.apk"
echo "========================================"
echo ""
