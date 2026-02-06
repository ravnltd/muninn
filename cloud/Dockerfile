FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies for both root (shared source) and cloud
COPY package.json bun.lock* ./
COPY cloud/package.json cloud/

# Install root deps (shared source uses these)
RUN bun install --frozen-lockfile --production

# Install cloud deps
WORKDIR /app/cloud
RUN bun install --frozen-lockfile --production

# Copy source (shared + cloud)
WORKDIR /app
COPY src/ src/
COPY schema.sql schema.sql
COPY cloud/src/ cloud/src/
COPY cloud/tsconfig.json cloud/tsconfig.json

# Runtime
WORKDIR /app/cloud
ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "src/server.ts"]
