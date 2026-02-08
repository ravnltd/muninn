FROM oven/bun:1 AS base
WORKDIR /app

# Install api dependencies
COPY api/package.json api/bun.lock* api/
WORKDIR /app/api
RUN bun install --frozen-lockfile --production

# Copy api source
WORKDIR /app
COPY api/src/ api/src/
COPY api/tsconfig.json api/tsconfig.json

# Runtime
WORKDIR /app/api
ENV NODE_ENV=production
EXPOSE 3400

CMD ["bun", "run", "src/server.ts"]
