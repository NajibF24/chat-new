FROM node:20-alpine

# 1. Install dependensi sistem untuk Chromium dan dumb-init
# Kita gabungkan dalam satu perintah RUN untuk mengoptimalkan ukuran image
RUN apk add --no-cache \
    dumb-init \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# 2. Set Environment Variables agar Puppeteer menggunakan Chromium bawaan Alpine
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/src/app

# 3. Copy package files dan install dependencies
COPY package*.json ./
RUN npm install --production

# 4. Copy sisa kode aplikasi sesuai
COPY . .

# 5. [SECURITY FIX] Setup folder dan permission
# Memastikan semua folder yang dibutuhkan tersedia dan dimiliki oleh user 'node'
RUN mkdir -p /usr/src/app/data && \
    mkdir -p /usr/src/app/uploads/avatars && \
    mkdir -p /usr/src/app/uploads/knowledge && \
    mkdir -p /usr/src/app/public/embed && \
    chown -R node:node /usr/src/app

# 6. Beralih ke User 'node' demi keamanan (Non-Root)
USER node

EXPOSE 5000

# 7. Healthcheck untuk memantau status aplikasi
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# 8. Entrypoint menggunakan dumb-init untuk menangani signal terminasi (SIGTERM) dengan benar
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
