FROM oven/bun:1 AS base
WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Install dependencies for both root (shared source) and cloud
COPY package.json bun.lock* ./
COPY cloud/package.json cloud/bun.lock* cloud/

# Install root deps (skip prepare script — git hooks not needed in Docker)
RUN bun install --frozen-lockfile --production --ignore-scripts

# Install cloud deps
WORKDIR /app/cloud
RUN bun install --frozen-lockfile --production

# Copy source (shared + cloud)
WORKDIR /app
COPY src/ src/
COPY schema.sql schema.sql
COPY cloud/src/ cloud/src/
COPY cloud/tsconfig.json cloud/tsconfig.json

# Copy landing page
COPY cloud/pages/ /srv/pages/

# Runtime
WORKDIR /app/cloud
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "src/server.ts"]
