# Web app image. Build context is the repository root:
#   docker build -f apps/web/Dockerfile .
# Next.js standalone output: the runtime image carries only the traced server
# bundle and static assets, no pnpm and no workspace.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile

COPY . .
# Build-only placeholders: pages are dynamic, nothing connects at build time,
# but the auth module refuses to load without a secret in production mode.
ENV NEXT_TELEMETRY_DISABLED=1 \
    BETTER_AUTH_SECRET=build-only \
    DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @abacus/web build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
ENV HOSTNAME=0.0.0.0 PORT=3000
CMD ["node", "apps/web/server.js"]
