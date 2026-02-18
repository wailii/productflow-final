# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:20-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
RUN corepack enable
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=3000
ENV ENABLE_LOCAL_AUTH=true
ENV LOCAL_STORAGE_ROOT=/data

EXPOSE 3000

RUN mkdir -p /data && chown -R app:app /app /data
USER app

CMD ["node", "dist/index.js"]
