FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tailwind.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 3050
CMD ["nginx", "-g", "daemon off;"]
