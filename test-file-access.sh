#!/bin/bash

echo ""
echo "======================================================================"
echo "🧪 TESTING FILE ACCESS"
echo "======================================================================"
echo ""

# Test 1: Health check
echo "1️⃣ Testing server health..."
echo "----------------------------------------------------------------------"
curl -s http://localhost:5000/health | head -n 5
echo ""
echo ""

# Test 2: Image file
echo "2️⃣ Testing image file access..."
echo "----------------------------------------------------------------------"
echo "URL: http://localhost:5000/api/files/dashboard-iot.jpeg"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/files/dashboard-iot.jpeg)
CONTENT_TYPE=$(curl -s -I http://localhost:5000/api/files/dashboard-iot.jpeg | grep -i content-type)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Status: $HTTP_CODE (OK)"
    echo "   $CONTENT_TYPE"
    echo "   File is accessible!"
else
    echo "❌ Status: $HTTP_CODE (Failed)"
    echo "   File cannot be accessed"
fi
echo ""

# Test 3: PDF file
echo "3️⃣ Testing PDF file access..."
echo "----------------------------------------------------------------------"
echo "URL: http://localhost:5000/api/files/dashboard-iot-caliper.pdf"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/files/dashboard-iot-caliper.pdf)
CONTENT_TYPE=$(curl -s -I http://localhost:5000/api/files/dashboard-iot-caliper.pdf | grep -i content-type)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Status: $HTTP_CODE (OK)"
    echo "   $CONTENT_TYPE"
    echo "   File is accessible!"
else
    echo "❌ Status: $HTTP_CODE (Failed)"
    echo "   File cannot be accessed"
fi
echo ""

# Test 4: CORS headers
echo "4️⃣ Testing CORS headers..."
echo "----------------------------------------------------------------------"
CORS_HEADER=$(curl -s -I http://localhost:5000/api/files/dashboard-iot.jpeg | grep -i access-control)
echo "$CORS_HEADER"
echo ""

echo "======================================================================"
echo "✅ TEST COMPLETE"
echo "======================================================================"
echo ""
echo "If all tests passed, try accessing in browser:"
echo "  http://16.79.23.146:5000/api/files/dashboard-iot.jpeg"
echo ""
