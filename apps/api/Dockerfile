FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY apps/batch/package*.json ./apps/batch/
COPY apps/api/package*.json ./apps/api/
RUN npm install --workspace=apps/batch --workspace=apps/api

COPY apps/batch/tsconfig.json ./apps/batch/
COPY apps/batch/src ./apps/batch/src
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src ./apps/api/src
RUN npm run build --workspace=apps/batch && npm run build --workspace=apps/api

FROM node:20-slim
WORKDIR /app
COPY package*.json ./
COPY apps/batch/package.json ./apps/batch/
COPY apps/api/package.json ./apps/api/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/batch/dist ./apps/batch/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
