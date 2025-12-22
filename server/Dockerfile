FROM node:20-alpine

# Install Chromium and dependencies for Puppeteer
#RUN apk add --no-cache \
#    chromium \
#    nss \
#    freetype \
#    harfbuzz \
#    ca-certificates \
#    ttf-freefont \
#    nodejs \
#    yarn \
    # Puppeteer deps
#    dumb-init \
#    udev \
#    xvfb-run \
#    mesa-gl \
#    libx11 \
#    libxext \
#    libxrender \
#    libxi \
#    libxtst \
#   libxrandr \
#    libxcomposite \
#    libxdamage \
#    alsa-lib \
#    libjpeg-turbo \
#    libpng \
#    libstdc++ \
#    libgcc

# Environment variables for Puppeteer
#ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
#    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
#    CHROME_BIN=/usr/bin/chromium-browser \
#    CHROME_PATH=/usr/bin/chromium-browser

WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app files
COPY . .

# Prepare directories
#RUN mkdir -p /usr/src/app/data/screenshots && \
#    mkdir -p /tmp/.X11-unix && \
#    chmod -R 755 /usr/src/app/data && \
#    chmod 1777 /tmp/.X11-unix
RUN mkdir -p /usr/src/app/data
# Create a non-root user
#RUN addgroup -g 1000 node && \
#    adduser -D -u 1000 -G node node || true
#RUN chown -R node:node /usr/src/app

#USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "server.js"]
