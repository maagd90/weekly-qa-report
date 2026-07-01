FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/batch/package.json ./apps/batch/
COPY apps/web/package.json ./apps/web/

RUN npm ci --workspace=apps/batch --workspace=apps/web

COPY apps/batch/tsconfig.json ./apps/batch/
COPY apps/batch/src ./apps/batch/src
COPY apps/web ./apps/web

RUN npm run build --workspace=apps/batch && npm run build --workspace=apps/web

FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
