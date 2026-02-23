# Muninn Cloud Operations Guide

## Overview

Muninn Cloud runs on Docker with Hono framework, Turso/sqld for databases, Stripe for billing, and MCP protocol for client communication. This guide covers backup strategies, health monitoring, alerting, and scaling procedures.

**Key Systems:**
- **Management DB**: Turso SQLite (single tenant metadata store)
- **Tenant DBs**: One SQLite per tenant via Turso (isolated workspaces)
- **Container**: Bun runtime with Hono HTTP framework
- **Metrics**: Prometheus-compatible text format endpoint
- **Billing**: Stripe integration with webhooks

---

## Backup Strategy

### Architecture

**Two-tier backup system:**

1. **Management Database** (`MGMT_DB_URL`)
   - Single shared database storing tenant metadata, API keys, audit logs, billing records
   - URL points to Turso HTTP endpoint (e.g., `libsql://xxx.turso.io`)
   - Token: `MGMT_DB_TOKEN` (readonly or readwrite depending on backup scope)

2. **Tenant Databases** (per tenant)
   - Individual SQLite databases per tenant
   - Managed via Turso API with `TURSO_API_TOKEN`
   - Org: `TURSO_ORG`

### Backup Commands

#### Full Management DB Backup (Daily)

```bash
#!/bin/bash
# /opt/muninn/scripts/backup-mgmt-db.sh
set -euo pipefail

BACKUP_DIR="$HOME/.claude/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/mgmt-${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

# Use Turso CLI to export database
# Requires: turso auth login && turso db show <db-name>
export DB_NAME="muninn-mgmt"
export TURSO_ORG="${TURSO_ORG}"
export TURSO_API_TOKEN="${TURSO_API_TOKEN}"

# Option 1: Using turso CLI (if available)
# turso db dump "$DB_NAME" > "$BACKUP_FILE" 2>/dev/null

# Option 2: Using curl + HTTP API (preferred for CI/CD)
MGMT_DB_URL="${MGMT_DB_URL}"
TOKEN="${MGMT_DB_TOKEN}"

# Export as SQL dump
curl -s -X POST "${MGMT_DB_URL}/dump" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  > "$BACKUP_FILE"

chmod 400 "$BACKUP_FILE"
echo "Backup created: $BACKUP_FILE"
```

**Add to crontab (3:00 AM daily):**

```bash
0 3 * * * /opt/muninn/scripts/backup-mgmt-db.sh
```

#### Tenant Database Backups (Per-Tenant Scheduled)

```bash
#!/bin/bash
# /opt/muninn/scripts/backup-tenant-db.sh
set -euo pipefail

TENANT_ID="$1"  # Pass as argument or query from management DB
BACKUP_DIR="$HOME/.claude/backups/tenants"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${TENANT_ID}-${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

# Query management DB to get tenant's database URL
# SELECT db_url FROM tenants WHERE id = ? LIMIT 1

DB_URL=$(curl -s "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -X POST \
  -d "SELECT db_url FROM tenants WHERE id = ?" \
  | jq -r '.rows[0][0]')

# Export tenant database
curl -s -X POST "${DB_URL}/dump" \
  -H "Authorization: Bearer ${TURSO_API_TOKEN}" \
  > "$BACKUP_FILE"

chmod 400 "$BACKUP_FILE"
echo "Tenant backup created: $BACKUP_FILE"
```

### Retention Policy

**Daily Backups:**
- Keep 7 most recent daily backups
- Stored in: `~/.claude/backups/`

**Weekly Backups (Sunday):**
- Keep 4 most recent weekly backups
- Naming: `mgmt-weekly-YYYYWW.db`

**Monthly Backups (1st of month):**
- Keep 12 most recent monthly backups
- Naming: `mgmt-monthly-YYYYMM.db`

**Cleanup Script:**

```bash
#!/bin/bash
# /opt/muninn/scripts/cleanup-backups.sh
set -euo pipefail

BACKUP_DIR="$HOME/.claude/backups"

# Keep 7 daily
ls -1t "$BACKUP_DIR"/mgmt-*.db | tail -n +8 | xargs -r rm

# Keep 4 weekly (synced separately on Sundays)
ls -1t "$BACKUP_DIR"/mgmt-weekly-*.db | tail -n +5 | xargs -r rm

# Keep 12 monthly (synced separately on 1st)
ls -1t "$BACKUP_DIR"/mgmt-monthly-*.db | tail -n +13 | xargs -r rm

echo "Backup cleanup complete"
```

**Cron scheduling:**

```bash
# Cleanup runs at 4 AM daily
0 4 * * * /opt/muninn/scripts/cleanup-backups.sh

# Weekly backup (Sunday 3:30 AM)
30 3 * * 0 cp ~/.claude/backups/mgmt-$(date +\%Y\%m\%d)*.db ~/.claude/backups/mgmt-weekly-$(date +\%Y%V).db 2>/dev/null || true

# Monthly backup (1st of month, 3:30 AM)
30 3 1 * * cp ~/.claude/backups/mgmt-$(date +\%Y\%m\%d)*.db ~/.claude/backups/mgmt-monthly-$(date +\%Y\%m).db 2>/dev/null || true
```

---

## Recovery Procedures

### Single Tenant Recovery

**Scenario:** One tenant's data corrupted or lost.

**Procedure:**

1. **Identify the incident:**
   ```bash
   # Query management DB to confirm tenant status
   curl -s "http://localhost:3000/api/tenants/{tenantId}" \
     -H "Authorization: Bearer ${ADMIN_TOKEN}"
   ```

2. **Stop the container (optional, non-disruptive):**
   ```bash
   docker-compose pause api
   ```

3. **Restore from backup:**
   ```bash
   # Find the most recent backup
   BACKUP_FILE=$(ls -1t ~/.claude/backups/tenants/${TENANT_ID}-*.db | head -1)

   # Get tenant's database URL from management DB
   DB_URL=$(curl -s -X POST "${MGMT_DB_URL}" \
     -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
     -d "SELECT db_url FROM tenants WHERE id = ?" | jq -r '.rows[0][0]')

   # Restore (creates new database, overwrites with backup contents)
   curl -s -X POST "${DB_URL}/restore" \
     -H "Authorization: Bearer ${TURSO_API_TOKEN}" \
     -H "Content-Type: application/octet-stream" \
     --data-binary @"$BACKUP_FILE"
   ```

4. **Resume operations:**
   ```bash
   docker-compose unpause api
   ```

5. **Verify:**
   ```bash
   # Test MCP endpoint for tenant
   curl -s "http://localhost:3000/mcp" \
     -H "Authorization: Bearer ${TENANT_API_KEY}" \
     -X POST \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

### Full Recovery (Management DB)

**Scenario:** Complete management database loss or catastrophic failure.

**Procedure:**

1. **Stop the service:**
   ```bash
   docker-compose down
   ```

2. **Create new management database in Turso:**
   ```bash
   turso db create muninn-mgmt-recovery
   turso db tokens create muninn-mgmt-recovery
   # Copy connection URL and token to .env
   ```

3. **Restore from latest backup:**
   ```bash
   BACKUP_FILE=$(ls -1t ~/.claude/backups/mgmt-*.db | head -1)

   # Use Turso CLI or HTTP API to restore
   turso db restore muninn-mgmt-recovery < "$BACKUP_FILE"
   ```

4. **Update environment variables:**
   ```bash
   # Edit .env or docker-compose.yml
   export MGMT_DB_URL="libsql://xxx-recovery.turso.io"
   export MGMT_DB_TOKEN="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
   ```

5. **Verify schema:**
   ```bash
   curl -s "${MGMT_DB_URL}" \
     -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
     -X POST \
     -d "SELECT name FROM sqlite_master WHERE type='table'" | jq .
   ```

6. **Restart the service:**
   ```bash
   docker-compose up -d
   docker-compose logs -f api
   ```

### Point-in-Time Recovery (PITR)

**Scenario:** Need to restore to a specific point in time (e.g., before accidental data deletion).

**Procedure:**

1. **Identify the backup closest to target time:**
   ```bash
   ls -1lt ~/.claude/backups/mgmt-*.db | head -10
   # Pick backup BEFORE the incident
   ```

2. **Create a temporary recovery database:**
   ```bash
   turso db create muninn-mgmt-pitr --seed "$(cat BACKUP_FILE.db | base64)"
   ```

3. **Spin up temporary recovery container:**
   ```bash
   docker run -d \
     -e MGMT_DB_URL="libsql://xxx-pitr.turso.io" \
     -e MGMT_DB_TOKEN="token..." \
     -p 3001:3000 \
     --name muninn-recovery \
     muninn-cloud:latest
   ```

4. **Query recovered data to verify:**
   ```bash
   curl -s "http://localhost:3001/health"
   curl -s "http://localhost:3001/api/tenants" \
     -H "Authorization: Bearer ${ADMIN_TOKEN}"
   ```

5. **When verified, promote recovery database:**
   ```bash
   # Update primary environment
   export MGMT_DB_URL="libsql://xxx-pitr.turso.io"
   export MGMT_DB_TOKEN="token..."

   # Restart production service
   docker-compose down && docker-compose up -d
   ```

6. **Cleanup:**
   ```bash
   docker stop muninn-recovery && docker rm muninn-recovery
   turso db delete muninn-mgmt  # old database
   turso db rename muninn-mgmt-pitr muninn-mgmt
   ```

---

## Health Check Monitoring

### Health Endpoints

**GET /health** — Liveness check (is service running?)

```bash
curl -s http://localhost:3000/health | jq .
```

**Response (healthy):**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "managementDb": "ok",
    "pool": {
      "size": 2,
      "available": 1
    },
    "mcpSessions": 5
  }
}
```

**Response (degraded):**
```json
{
  "status": "degraded",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "managementDb": "error",
    "pool": {
      "size": 2,
      "available": 0
    },
    "mcpSessions": 5
  }
}
```

**GET /ready** — Readiness check (can accept requests?)

```bash
curl -s http://localhost:3000/ready | jq .
```

Returns `{"ready": true}` (200) or `{"ready": false}` (503).

**GET /metrics** — Prometheus metrics (requires local IP or bearer token)

```bash
# From Docker host
curl -s http://localhost:3000/metrics

# From external (requires METRICS_TOKEN)
curl -s http://api.muninn.pro/metrics \
  -H "Authorization: Bearer ${METRICS_TOKEN}"
```

### Key Metrics

**Counters:**
- `http_requests_total{method,status}` — Total requests by method and status code
- `mcp_requests_total{method,status}` — MCP requests
- `stripe_webhooks_total{event}` — Webhook events processed

**Gauges:**
- `db_pool_size` — Current pool connections
- `db_pool_available` — Available connections (not in use)
- `mcp_active_sessions` — Active MCP protocol sessions

**Histograms:**
- `http_request_duration_seconds{method,status}` — Request latency (0.005 to 10s buckets)
- `mcp_request_duration_seconds{method,status}` — MCP latency

### Monitoring Setup (Prometheus + Grafana)

**prometheus.yml:**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "muninn-cloud"
    static_configs:
      - targets: ["localhost:3000"]
    metrics_path: "/metrics"
    bearer_token: "your-metrics-token"
    scrape_interval: 10s
```

**Grafana Dashboard JSON:**

```json
{
  "dashboard": {
    "title": "Muninn Cloud",
    "panels": [
      {
        "title": "Request Rate (req/s)",
        "targets": [
          {
            "expr": "rate(http_requests_total[1m])"
          }
        ]
      },
      {
        "title": "P95 Request Latency",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, http_request_duration_seconds)"
          }
        ]
      },
      {
        "title": "Error Rate (%)",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[1m]) / rate(http_requests_total[1m]) * 100"
          }
        ]
      },
      {
        "title": "DB Pool Exhaustion (%)",
        "targets": [
          {
            "expr": "(db_pool_size - db_pool_available) / db_pool_size * 100"
          }
        ]
      },
      {
        "title": "Active MCP Sessions",
        "targets": [
          {
            "expr": "mcp_active_sessions"
          }
        ]
      }
    ]
  }
}
```

---

## Alerting Thresholds

### Critical Alerts

**1. Management DB Unavailable**

Trigger: `/health` returns `managementDb: error`

```
Alert: CRITICAL
Duration: Immediate
Action: Page on-call, check Turso status, review error logs
Recovery: See Recovery Procedures > Full Recovery
```

**2. Request Latency (P95 > 500ms)**

Trigger: `histogram_quantile(0.95, http_request_duration_seconds) > 0.5`

```
Alert: WARNING
Duration: 2 minutes sustained
Threshold: 500ms P95
Action: Check metrics, consider scaling or investigating slow queries
```

**3. Error Rate > 1%**

Trigger: `rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01`

```
Alert: CRITICAL
Duration: 1 minute sustained
Threshold: 1% of requests failing
Action: Page on-call, check error logs, review recent deployments
```

**4. DB Pool Exhaustion > 80%**

Trigger: `(db_pool_size - db_pool_available) / db_pool_size > 0.8`

```
Alert: WARNING
Duration: 30 seconds sustained
Threshold: >80% pool used
Action: Check for connection leaks, consider scaling pool size
```

**5. MCP Session Leak**

Trigger: `mcp_active_sessions > threshold` (e.g., >1000)

```
Alert: WARNING
Duration: 5 minutes sustained
Threshold: Configurable per deployment
Action: Check for hung MCP clients, review session manager logs
```

**6. Disk Backup Failure**

Trigger: Backup script exits with error code

```
Alert: CRITICAL (if production backup)
Duration: Immediate
Action: Review cron logs, check backup directory permissions
```

### Instrumentation (Prometheus AlertManager)

**alerting_rules.yml:**

```yaml
groups:
  - name: muninn_cloud
    interval: 30s
    rules:
      - alert: MgmtDBUnavailable
        expr: health_checks{check="managementDb"} == 0
        for: 1m
        annotations:
          summary: "Management DB is unavailable"

      - alert: P95LatencyHigh
        expr: histogram_quantile(0.95, http_request_duration_seconds) > 0.5
        for: 2m
        annotations:
          summary: "P95 latency above 500ms ({{ $value }}s)"

      - alert: ErrorRateHigh
        expr: |
          (rate(http_requests_total{status=~"5.."}[5m]) /
           rate(http_requests_total[5m])) > 0.01
        for: 1m
        annotations:
          summary: "Error rate above 1% ({{ $value | humanizePercentage }})"

      - alert: DBPoolExhaustion
        expr: (db_pool_size - db_pool_available) / db_pool_size > 0.8
        for: 30s
        annotations:
          summary: "DB pool >80% exhausted"

      - alert: MCPSessionLeak
        expr: mcp_active_sessions > 1000
        for: 5m
        annotations:
          summary: "Possible MCP session leak ({{ $value }} active)"
```

---

## Scaling Procedures

### Vertical Scaling (Single Instance)

**Increase container resources:**

```yaml
# docker-compose.yml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "4"      # Was 2
          memory: "2G"   # Was 1G
        reservations:
          cpus: "1"      # Was 0.5
          memory: "512M" # Was 256M
```

**Apply:**

```bash
docker-compose up -d --force-recreate
```

**Monitor:**

```bash
# Watch metrics during restart
watch -n 1 'curl -s http://localhost:3000/metrics | grep -E "^(mcp_|http_|db_)"'
```

### Horizontal Scaling (Multi-Instance Preparation)

**Current Status:** Single instance with local DB pool. Horizontal scaling requires:

1. **Shared State Management**
   - MCP session tracking moved to Redis or management DB
   - Rate limiting moved to Redis (currently in-memory per instance)
   - Circuit breaker state shared across instances

2. **Sticky Sessions**
   - Load balancer must route MCP connections to same instance
   - Or: Implement session store in management DB

3. **Configuration (when ready):**

```yaml
# docker-compose.yml (multi-instance)
services:
  api-1:
    build:
      context: ..
      dockerfile: cloud/Dockerfile
    environment:
      - NODE_INSTANCE_ID=api-1
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  api-2:
    build:
      context: ..
      dockerfile: cloud/Dockerfile
    environment:
      - NODE_INSTANCE_ID=api-2
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  caddy:
    image: caddy:latest
    volumes:
      - ./Caddyfile-multi:/etc/caddy/Caddyfile
    depends_on:
      - api-1
      - api-2

volumes:
  redis_data:
```

**Caddyfile (sticky sessions by client IP):**

```
api.muninn.pro {
  reverse_proxy localhost:3001 localhost:3002 {
    policy ip_hash
  }
}
```

### Connection Pool Tuning

**Current pool configuration (in `src/tenants/pool.ts`):**

```typescript
// Max connections across all tenants
const MAX_POOL_SIZE = 100;
const IDLE_TIMEOUT_MS = 300_000; // 5 minutes

// Limits per tenant (circuit breaker)
const TENANT_LIMITS = {
  free: 5,
  pro: 20,
  team: 50,
};
```

**Adjust for load:**

```typescript
// High-load production
const MAX_POOL_SIZE = 200;
const IDLE_TIMEOUT_MS = 600_000; // 10 minutes

const TENANT_LIMITS = {
  free: 10,
  pro: 40,
  team: 100,
};
```

---

## Deployment Guide

### Quick Start

```bash
cd cloud
cp .env.example .env
# Edit .env with your values (see Environment Variables below)
docker compose up -d --build
```

### Environment Variables

See `.env.example` for the full list. Critical ones for first deploy:

| Variable | Required | Notes |
|----------|----------|-------|
| `MGMT_DB_URL` | Yes | Turso management database URL |
| `MGMT_DB_TOKEN` | Yes | Turso auth token |
| `TURSO_ORG` | Yes | Turso org for tenant DB provisioning |
| `TURSO_API_TOKEN` | Yes | Turso API token |
| `STRIPE_SECRET_KEY` | Yes | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe webhook signing secret |
| `STRIPE_PRO_PRICE_ID` | Yes | Stripe price ID for pro plan |
| `CSRF_SECRET` | Recommended | Persists OAuth forms across restarts. Generate: `openssl rand -hex 32` |
| `METRICS_TOKEN` | Recommended | Secures `/metrics` endpoint from external access |
| `SSO_ENCRYPTION_KEY` | If SSO | Encrypts OIDC secrets. Generate: `openssl rand -base64 32` |
| `BASE_URL` | If not muninn.pro | Public URL for OAuth/SAML callbacks |

### Database Initialization

On first startup, the server automatically:
1. Creates all management DB tables from `schema.sql`
2. Runs idempotent migrations (RBAC, SSO, rate limiting tables)
3. Creates owner users for any existing tenants

No manual migration step needed.

### Verifying Deployment

```bash
# Health check
curl -s http://localhost:3000/health | jq .

# Readiness
curl -s http://localhost:3000/ready | jq .

# OAuth discovery (used by Claude Code)
curl -s http://localhost:3000/.well-known/oauth-authorization-server | jq .

# Metrics (from localhost)
curl -s http://localhost:3000/metrics | head -20
```

### Capacity Planning (~100 Users)

**Recommended server spec:**

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 1 GB |
| Disk | 10 GB | 20 GB (logs + Caddy certs) |
| Network | 10 Mbps | 100 Mbps |

**Why this is enough:**
- Bun + Hono handles ~50k req/s on a single core (hello world). Real workload with DB is ~2-5k req/s
- 100 users doing ~10 MCP tool calls/min = ~17 req/s peak — well under capacity
- Each MCP SSE session holds ~2 KB memory. 100 concurrent = ~200 KB
- Turso handles the DB load externally (no local disk I/O for queries)
- Rate limiting: in-memory token buckets use ~500 bytes/tenant = ~50 KB for 100 tenants
- Connection pool: default 100 max connections, 5 per free tenant

**Bottlenecks to watch at scale:**
- DB pool exhaustion: monitor `db_pool_available` via `/metrics`
- MCP session count: if users leave sessions open indefinitely
- Rate limit sync: background DB sync every 10s adds ~1 write/sec per instance

**Cost estimate (Turso):**
- Free tier: 500 databases, 9 GB storage, 25M row reads/month
- 100 tenants = 101 databases (1 mgmt + 100 tenant) — fits free tier
- ~10 tool calls/user/min * 100 users * ~5 queries/call = ~3M reads/day = ~90M/month → Pro tier ($29/mo)

**VPS options at this scale:**
- Hetzner CX22: 2 vCPU, 4 GB RAM, 40 GB — ~$4.50/mo
- DigitalOcean Basic: 2 vCPU, 2 GB RAM, 50 GB — ~$18/mo
- AWS t3.small: 2 vCPU, 2 GB RAM — ~$15/mo

---

## Deployment Checklist

- [ ] `.env` created from `.env.example` with all required values
- [ ] `CSRF_SECRET` set (prevents OAuth breakage on restart)
- [ ] `METRICS_TOKEN` set (secures metrics endpoint)
- [ ] Backup strategy configured (cron jobs running)
- [ ] Health checks integrated into monitoring
- [ ] Alerting thresholds set in Prometheus/AlertManager
- [ ] Metrics exposed and scraped by Prometheus
- [ ] Load balancer health check pointing to `/health`
- [ ] Log aggregation configured (e.g., ELK, Datadog, CloudWatch)
- [ ] Incident response runbook reviewed (see runbook.md)

