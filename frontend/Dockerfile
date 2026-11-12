FROM node:22-slim AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS dev
COPY index.html vite.config.ts tsconfig.json tailwind.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
EXPOSE 3050
ENV VITE_BACKEND_URL=http://backend:5055
CMD ["npm", "run", "dev"]

FROM nginx:alpine AS production
COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 3050
CMD ["nginx", "-g", "daemon off;"]
