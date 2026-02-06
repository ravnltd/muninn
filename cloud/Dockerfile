FROM oven/bun:1 AS base
WORKDIR /app

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

CMD ["bun", "run", "src/server.ts"]
