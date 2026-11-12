FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl poppler-utils tesseract-ocr tesseract-ocr-data-rus tesseract-ocr-data-eng
COPY data/kaz.traineddata /usr/share/tessdata/kaz.traineddata
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY dist ./dist
COPY data/*.json data/*.pem ./data/
RUN npm prune --omit=dev && mkdir -p uploads && chown -R node:node /app

FROM build AS migrator
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM build AS dev
EXPOSE 5055
CMD ["npm", "run", "dev"]

FROM build AS production
USER node
EXPOSE 5055
CMD ["node", "dist/server.js"]

