# Build Stage (Tetap sama)
FROM node:20-alpine AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Production Stage
FROM nginxinc/nginx-unprivileged:alpine

# Copy hasil build React
COPY --from=build /usr/src/app/build /usr/share/nginx/html

# Copy konfigurasi custom
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Expose port 8080
EXPOSE 8080

# --- TAMBAHAN PENTING ---
# Kita tegaskan ke Trivy bahwa kita pakai user 'nginx'
# (Sebenarnya image ini sudah otomatis pakai user ini, tapi Trivy butuh tulisan ini)
USER nginx
# ------------------------
# --- [PERBAIKAN TRIVY DS-026] ---
# Cek kesehatan setiap 30 detik
# Menggunakan 'wget' ke localhost:8080
# Jika gagal (exit 1), Docker akan menandai container sebagai "unhealthy"
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8080/ || exit 1
# --------------------------------
CMD ["nginx", "-g", "daemon off;"]
