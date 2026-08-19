# MCP server image. Build context is the repository root:
#   docker build -f apps/mcp/Dockerfile .
# Node 24 runs the TypeScript sources directly (type stripping): no build step,
# what runs in the container is exactly what the tests exercised.
FROM node:24-slim
WORKDIR /app

RUN corepack enable

# Install with only the manifests first so the layer caches across code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --prod

COPY migrations migrations
COPY packages/core packages/core
COPY apps/mcp apps/mcp

ENV NODE_ENV=production
EXPOSE 3000

# Migrations run at startup: forward-only, advisory-locked, so concurrent
# replicas cannot race each other.
CMD ["sh", "-c", "node packages/core/src/db/migrate.ts && node apps/mcp/src/main.ts"]
