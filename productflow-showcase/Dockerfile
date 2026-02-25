FROM node:20-alpine AS base
RUN corepack enable && \
    ok=0 && \
    for i in 1 2 3 4 5; do \
      if corepack prepare pnpm@10.4.1 --activate; then \
        ok=1; \
        break; \
      fi; \
      echo "corepack prepare failed (attempt ${i}), retrying..." >&2; \
      sleep 3; \
    done && \
    test "${ok}" -eq 1
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM node:20-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
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
