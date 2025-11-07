# Gunakan Node.js LTS
FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Ekspos port 5000
EXPOSE 5000

# Jalankan server
CMD ["node", "server.js"]
