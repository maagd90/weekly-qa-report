FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/batch/package.json ./apps/batch/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/batch --workspace=apps/api

COPY apps/batch/tsconfig.json ./apps/batch/
COPY apps/batch/src ./apps/batch/src
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src

RUN npm run build --workspace=apps/batch && npm run build --workspace=apps/api

FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV INPUT_DIR=/data/input
ENV OUTPUT_DIR=/data/output
ENV CONFIG_DIR=/data/config
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PDF_PRINT_URL=http://dashboard-web/print/report

RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  fonts-noto-color-emoji \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/batch/package.json ./apps/batch/
COPY apps/api/package.json ./apps/api/

RUN npm ci --workspace=apps/batch --workspace=apps/api --omit=dev

COPY --from=builder /app/apps/batch/dist ./apps/batch/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY config/integrations.example.json ./config/integrations.example.json

RUN mkdir -p /data/input /data/output /data/config

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
