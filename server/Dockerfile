FROM node:20-alpine
#contoh
# Install dumb-init (Penting untuk signal handling di non-root user)
RUN apk add --no-cache dumb-init

# WORKDIR sudah otomatis dimiliki root saat dibuat, kita akan ubah nanti
WORKDIR /usr/src/app

# Copy package files dan install dependencies
COPY package*.json ./
RUN npm install --production

# Copy aplikasi
COPY . .

# [SECURITY FIX]
# 1. Buat folder data (jika belum ada)
# 2. Ubah kepemilikan folder kerja (/usr/src/app) ke user bawaan 'node'
RUN mkdir -p /usr/src/app/data && \
    chown -R node:node /usr/src/app

# [SECURITY FIX] Beralih ke User 'node' (Bukan Root lagi)
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Gunakan dumb-init sebagai entrypoint agar proses node bisa dimatikan dengan bersih
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
