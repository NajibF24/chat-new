#!/bin/sh

echo "🧹 Clearing OneDrive cache..."

node scripts/clear-onedrive-cache.js || echo "⚠️ Clear cache skipped"

echo "🚀 Starting server..."
exec node server.js
