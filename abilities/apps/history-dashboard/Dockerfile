FROM node:22-slim AS deps

WORKDIR /app
COPY abilities/apps/history-dashboard/web/package.json abilities/apps/history-dashboard/web/package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY abilities/apps/history-dashboard/web ./
RUN npm run build

FROM node:22-slim AS runner

ENV NODE_ENV=production
WORKDIR /workspace/abilities/apps/history-dashboard/web

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY abilities/apps/history-dashboard/docker/history-dashboard-status.js /usr/local/bin/history-dashboard-status.js

EXPOSE 3000
