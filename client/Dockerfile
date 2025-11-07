# Build stage
FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage dengan Nginx
FROM nginx:alpine

# Copy build React ke folder nginx
COPY --from=build /usr/src/app/build /usr/share/nginx/html

# Copy konfigurasi nginx custom (opsional)
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
