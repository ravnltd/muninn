# Muninn Cloud Incident Runbook

## Incident Response Framework

### Detection Phase

**Automated Monitoring**
- Prometheus AlertManager triggers alerts based on thresholds
- Grafana dashboards show real-time metrics
- Health check endpoint monitored by load balancer
- Log aggregation tool (ELK/Datadog) for error patterns

**Manual Detection**
- On-call engineer receives PagerDuty/Slack alert
- Check `/health` and `/metrics` endpoints
- Review recent deployments or configuration changes

### Triage Phase

**Step 1: Confirm the Issue**

```bash
# Health check
curl -s http://localhost:3000/health | jq '.checks'

# Readiness check
curl -s http://localhost:3000/ready

# Metrics snapshot
curl -s -H "Authorization: Bearer ${METRICS_TOKEN}" \
  http://localhost:3000/metrics | head -50

# Container logs
docker-compose logs -f --tail=100 api

# Management DB status
curl -s "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -X POST \
  -d "SELECT COUNT(*) FROM tenants"
```

**Step 2: Categorize**

- **Service Issue**: Container/HTTP layer problem
- **Database Issue**: Management DB or tenant DB unreachable
- **Billing Issue**: Stripe webhook failure
- **MCP Issue**: Protocol-level session or communication problem
- **Capacity Issue**: Resource exhaustion

### Mitigation Phase

**Immediate Actions (First 2 Minutes)**

1. **For partial degradation** (some tenants affected):
   - Don't restart. Investigate cause first.
   - Check error logs for patterns.

2. **For full outage**:
   - Restart container: `docker-compose restart api`
   - Check if issue persists.

3. **For cascading failures**:
   - Scale down: `docker-compose stop api`
   - Drain load balancer: Remove from active pool
   - Prevent further damage while investigating

### Resolution Phase

**Fix the Root Cause**

See specific failure modes below for detailed procedures.

**Verify Fix**

```bash
# Health endpoint should return "ok"
curl -s http://localhost:3000/health | jq '.status'

# Test MCP endpoint
curl -s http://localhost:3000/mcp \
  -H "Authorization: Bearer ${TEST_API_KEY}" \
  -X POST \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Check metrics trending toward normal
curl -s http://localhost:3000/metrics | grep http_requests_total
```

### Postmortem Phase

**Timeline**
- Note exact times: detection, mitigation, resolution
- Review logs for causation

**Root Cause Analysis**
- Why did this fail?
- Why wasn't it caught earlier?
- What's the permanent fix?

**Action Items**
- Update monitoring thresholds
- Add tests
- Update runbook
- Schedule review for next sprint

---

## Common Failure Modes

### 1. Management Database Unreachable

**Symptoms:**
- `/health` returns `managementDb: error`
- `/ready` returns 503
- MCP requests fail with "database unavailable"
- Error logs: "Cannot connect to management database"

**Triage:**

```bash
# Check Turso service status
curl -s https://status.turso.tech/

# Verify credentials
echo "MGMT_DB_URL: ${MGMT_DB_URL}"
echo "MGMT_DB_TOKEN: ${MGMT_DB_TOKEN:0:20}..."

# Test connectivity to Turso
curl -s -I "${MGMT_DB_URL}/health" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}"

# Check container logs for detailed error
docker-compose logs api | grep -i "management\|database\|turso"
```

**Immediate Actions:**

1. **If Turso is down** (check status.turso.tech):
   - Set degraded mode: Return 503 for new MCP requests
   - Notify customers: Post status update
   - Wait for Turso recovery (typically < 30 min)

2. **If credentials invalid**:
   - Verify `MGMT_DB_TOKEN` not expired
   - Regenerate new token in Turso dashboard
   - Update `.env` and restart: `docker-compose restart api`

3. **If network issue**:
   - Check Docker network: `docker network ls`
   - Verify DNS: `docker exec api nslookup api.muninn.pro`
   - Check firewall rules: `sudo iptables -L -n | grep -E "3306|5432|8080"`

**Long-term Fix:**

- Add database failover (read-replica or backup instance)
- Implement circuit breaker with caching for short outages
- Add telemetry for connection pool health

---

### 2. Circuit Breaker Open (DB Connection Failures)

**Symptoms:**
- Random 503 responses from `/mcp` endpoint
- Error logs: "Circuit breaker is open"
- Metrics: Spike in 503 errors without actual DB connection errors
- `/health` shows managementDb as "ok" but MCP requests still fail

**Root Cause:**
- Too many consecutive connection failures trigger circuit breaker
- Breaker opens for 30s, blocking all requests during that window
- Often caused by: slow queries, pool exhaustion, or temporary network issues

**Triage:**

```bash
# Check recent error logs
docker-compose logs api --since 5m | grep -i "circuit\|connection\|timeout"

# Monitor circuit breaker state in real-time
watch -n 1 'curl -s http://localhost:3000/metrics | grep -E "circuit_breaker|connection_failures"'

# Check pool utilization
curl -s http://localhost:3000/health | jq '.checks.pool'
```

**Immediate Actions:**

1. **If pool is exhausted** (available == 0):
   - Look for connection leaks (see Connection Pool Leak below)
   - Increase pool size: Edit `src/tenants/pool.ts` MAX_POOL_SIZE
   - Rebuild and restart: `docker-compose up -d --build`

2. **If pool is available but circuit breaker still open**:
   - Check database query performance (see troubleshooting section)
   - Verify no "stuck" transactions: Query management DB for open txns

3. **To force circuit breaker reset**:
   ```bash
   # Restart container (graceful shutdown waits 5s for in-flight requests)
   docker-compose restart api
   ```

**Long-term Fix:**

- Implement exponential backoff on retries (currently linear)
- Add query timeout monitoring
- Increase circuit breaker timeout from 30s to 60s for transient issues
- Add metrics for circuit breaker half-open success rate

---

### 3. Rate Limit Misconfigured / Quota Exceeded

**Symptoms:**
- Legitimate clients receive 429 (Too Many Requests)
- Error logs: "Rate limit exceeded" or "Plan quota exceeded"
- Specific tenant can't make requests, others unaffected
- Metrics: spike in 429 status codes

**Triage:**

```bash
# Check rate limit in memory (requires access to container)
docker exec api cat /proc/self/environ | tr '\0' '\n' | grep -i limit

# Verify billing plan
curl -s "http://localhost:3000/api/tenants/${TENANT_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" | jq '.plan, .quotas'

# Check request count for tenant
curl -s http://localhost:3000/metrics | grep "requests_total{.*${TENANT_ID}.*}"

# View rate limit window
curl -s "http://localhost:3000/api/tenants/${TENANT_ID}/rate-limit" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

**Immediate Actions:**

1. **If tenant has legitimate higher quota**:
   - Upgrade plan in management DB:
     ```bash
     curl -s -X PATCH "http://localhost:3000/api/tenants/${TENANT_ID}" \
       -H "Authorization: Bearer ${ADMIN_TOKEN}" \
       -H "Content-Type: application/json" \
       -d '{"plan":"pro"}'
     ```
   - Verify change took effect (rate limiter checks on each request)

2. **If rate limit is too strict**:
   - Adjust in `src/api/rate-limit.ts`:
     ```typescript
     const LIMITS = {
       free: 60,      // Was 60
       pro: 300,      // Increase to 600?
       team: 1000,
     };
     ```
   - Rebuild and restart

3. **If one tenant is overusing**:
   - Throttle that tenant via management DB: `UPDATE tenants SET rate_limit_override = 10 WHERE id = ?`
   - Notify tenant of abuse

**Long-term Fix:**

- Implement sliding-window rate limiting (more accurate than fixed buckets)
- Add rate limit warnings before hard cutoff (e.g., 429 at 90% quota)
- Add metrics for per-tenant quota usage
- Implement quota recovery (e.g., allow burst if baseline is low)

---

### 4. MCP Session Leak (Sessions Not Closing)

**Symptoms:**
- `/health` shows `mcpSessions` growing over time (never decreases)
- Metrics: `mcp_active_sessions` continuously increasing
- Memory usage climbing
- Eventually: OOM killer or 503 errors when session limit hit

**Triage:**

```bash
# Monitor session count over 5 minutes
for i in {1..5}; do
  curl -s http://localhost:3000/health | jq '.checks.mcpSessions'
  sleep 60
done

# Check memory usage
docker stats api --no-stream

# Identify long-running sessions
docker exec api ps aux | grep -i mcp

# View session creation logs
docker-compose logs api --since 10m | grep -i "session\|connect\|close" | tail -20
```

**Immediate Actions:**

1. **Force close old sessions:**
   ```bash
   # Send DELETE to /mcp endpoint (session termination)
   curl -X DELETE "http://localhost:3000/mcp" \
     -H "Authorization: Bearer ${TENANT_TOKEN}"
   ```

2. **If sessions refuse to close**:
   - Check client code: Are they calling session.close()?
   - Review MCP protocol implementation in `src/mcp-endpoint.ts`

3. **As temporary mitigation**:
   - Lower session timeout in `src/mcp-endpoint.ts`:
     ```typescript
     const SESSION_TIMEOUT_MS = 300_000; // Was 600_000, reduce to 5 min
     ```
   - Restart: `docker-compose restart api`

4. **Long-term: Implement session reaping**:
   - Add job that scans active sessions and closes idle ones
   - Add idle timeout detection (no messages for N seconds = close)

**Long-term Fix:**

- Add metrics for session lifecycle (created, closed, timeout)
- Implement heartbeat/keepalive mechanism
- Add session max-lifetime (kill after 24 hours even if active)
- Add detailed logging for session creation/close events
- Test with long-running client scenarios

---

### 5. Stripe Webhook Failures

**Symptoms:**
- Billing events not processed (charges don't create, subscriptions not updated)
- Error logs: "Webhook processing failed" or "Invalid signature"
- Stripe dashboard shows delivered webhooks, but no update in management DB
- Customers not billed for usage

**Triage:**

```bash
# Check webhook signatures in Stripe dashboard
# https://dashboard.stripe.com/webhooks (look for recent failures)

# Query management DB for webhook logs
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "SELECT * FROM audit_log WHERE action = 'webhook' ORDER BY created_at DESC LIMIT 10"

# Verify webhook secret
echo "STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:0:20}..."

# Test webhook endpoint
curl -s -X POST "http://localhost:3000/webhooks/stripe" \
  -H "Stripe-Signature: t=${TIMESTAMP},v1=${SIGNATURE}" \
  -H "Content-Type: application/json" \
  -d '{"id":"evt_test","type":"charge.succeeded","data":{"object":{"id":"ch_test"}}}'
```

**Immediate Actions:**

1. **If signature is invalid** (webhook secret mismatch):
   - Regenerate webhook in Stripe dashboard: Endpoints → Re-sign secret
   - Update `STRIPE_WEBHOOK_SECRET` in `.env`
   - Restart: `docker-compose restart api`
   - Manually replay missed webhooks in Stripe dashboard (Attempt to re-send)

2. **If webhook endpoint is unreachable**:
   - Verify endpoint URL in Stripe dashboard is correct
   - Check firewall: `curl -I https://api.muninn.pro/webhooks/stripe` from external
   - Check DNS: `nslookup api.muninn.pro`

3. **If webhook is received but processing fails**:
   - Check application logs for parsing errors:
     ```bash
     docker-compose logs api --since 10m | grep -i webhook
     ```
   - Verify event handler for specific event type exists

4. **Manual Reconciliation:**
   ```bash
   # Query Stripe for recent charges
   curl -s "https://api.stripe.com/v1/charges?limit=10" \
     -u "${STRIPE_SECRET_KEY}:"

   # Backfill missing events in management DB
   # (implement manual webhook replay in admin dashboard)
   ```

**Long-term Fix:**

- Implement webhook signature verification with time tolerance (Stripe's clock skew buffer)
- Add webhook idempotency handling (safe to replay same event)
- Add webhook retry queue with exponential backoff (Stripe already retries)
- Add metrics for webhook success/failure rates
- Add admin dashboard for manual webhook replay
- Add audit trail for all billing events

---

## Troubleshooting Commands

### General Diagnostics

```bash
# Overall service health
curl -s http://localhost:3000/health | jq .

# Database connectivity
curl -s "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -X POST \
  -d "SELECT COUNT(*) as tenant_count FROM tenants"

# Container status
docker-compose ps
docker-compose logs -f api --tail=100

# Resource usage
docker stats api --no-stream

# Network connectivity
docker exec api curl -s https://api.stripe.com/v1/ -u "test:"
```

### API Testing

**Test MCP Endpoint:**

```bash
# List available tools
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer ${TENANT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' | jq .
```

**Test Auth Endpoints:**

```bash
# OAuth discovery
curl -s http://localhost:3000/.well-known/oauth-authorization-server | jq .

# Generate access token (if client credentials flow is supported)
curl -s -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}"
```

**Test Metrics Endpoint:**

```bash
# Retrieve metrics (requires local IP or token)
curl -s http://localhost:3000/metrics | head -30

# Extract specific metric
curl -s http://localhost:3000/metrics | grep "mcp_active_sessions"
```

### Database Queries

**Check Tenant Status:**

```bash
# Query management DB
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "SELECT id, org_name, plan, api_keys_count FROM tenants WHERE id = ?"
```

**Audit Log Review:**

```bash
# Recent actions by tenant
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20"

# Find webhook-related actions
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "SELECT * FROM audit_log WHERE action LIKE '%webhook%' ORDER BY created_at DESC LIMIT 20"
```

**Connection Pool Status:**

```bash
# Current connections
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "PRAGMA database_list"

# Open transactions (if supported)
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "SELECT * FROM sqlite_stat WHERE name = 'db'"
```

### Log Analysis

**Extract Errors from Last Hour:**

```bash
docker-compose logs api --since 1h | grep -E "ERROR|error|failed|exception"
```

**Follow Live Logs with Filter:**

```bash
docker-compose logs -f api | grep -E "circuit|timeout|pool"
```

**Count Specific Error Pattern:**

```bash
docker-compose logs api --since 24h | grep -c "429"  # Rate limit errors
```

---

## Maintenance Procedures

### Deployment

**Blue-Green Deployment:**

```bash
# Build new image
docker-compose build api

# Start new container alongside existing one
docker-compose up -d api

# Verify new container is healthy
sleep 5 && curl -s http://localhost:3000/health

# Drain old container (stop accepting new requests)
# Then switch load balancer to new container

# Remove old container
docker-compose rm -f api-old
```

**Canary Deployment:**

```bash
# Route 10% of traffic to new version
# (requires load balancer support, e.g., Nginx or Caddy)

# Monitor metrics for new version
curl -s http://localhost:3000/metrics | grep "version"

# If stable, gradually increase traffic to 100%
```

### Rollback

**If Deployment Fails:**

```bash
# Immediately stop new container
docker-compose stop api

# Restart previous version
docker tag muninn-cloud:previous muninn-cloud:latest
docker-compose up -d api

# Verify health
curl -s http://localhost:3000/health

# Investigate root cause
docker-compose logs api --since 10m > /tmp/deployment-error.log
```

### Tenant Migration

**Move Tenant to Different Database (Manual):**

1. **Export tenant data from source DB:**
   ```bash
   TENANT_ID="xxx"
   SOURCE_DB_URL="libsql://source.turso.io"

   curl -s -X POST "${SOURCE_DB_URL}/dump" \
     -H "Authorization: Bearer ${SOURCE_TOKEN}" \
     > /tmp/tenant-backup.db
   ```

2. **Create new database in Turso:**
   ```bash
   turso db create "${TENANT_ID}-new"
   NEW_DB_URL=$(turso db show "${TENANT_ID}-new" | grep URL)
   ```

3. **Restore to new database:**
   ```bash
   curl -s -X POST "${NEW_DB_URL}/restore" \
     -H "Authorization: Bearer ${NEW_TOKEN}" \
     -H "Content-Type: application/octet-stream" \
     --data-binary @/tmp/tenant-backup.db
   ```

4. **Update management DB pointer:**
   ```bash
   curl -s -X POST "${MGMT_DB_URL}" \
     -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
     -X PATCH \
     -d "UPDATE tenants SET db_url = ? WHERE id = ?"
   ```

5. **Verify migration:**
   ```bash
   # Test MCP endpoint against new database
   curl -s -X POST http://localhost:3000/mcp \
     -H "Authorization: Bearer ${TENANT_API_KEY}" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

### Database Maintenance

**Vacuum (Optimize SQLite):**

```bash
# Only if using local SQLite (not Turso)
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "VACUUM"
```

**Reindex (Repair Indexes):**

```bash
curl -s -X POST "${MGMT_DB_URL}" \
  -H "Authorization: Bearer ${MGMT_DB_TOKEN}" \
  -d "REINDEX"
```

---

## Escalation Paths

**Severity Levels:**

- **P1 (Critical)**: Service fully down or >5% error rate → Page on-call immediately
- **P2 (High)**: Partial outage or >1% error rate → Contact team lead within 30 min
- **P3 (Medium)**: Degraded performance or <1% error rate → Schedule for next sprint
- **P4 (Low)**: Non-customer-facing issue → Add to backlog

**Escalation Contacts:**

1. On-call engineer (PagerDuty)
2. Team lead (Slack #muninn-incidents)
3. VP Engineering (if ongoing >1 hour)
4. Stripe support (if billing-related and persists >30 min)

---

## Post-Incident Steps

1. **Create incident report** with timeline, impact, and root cause
2. **File action items** as GitHub issues with labels: `incident-followup`
3. **Update runbook** with lessons learned
4. **Schedule blameless postmortem** for team to review
5. **Implement fixes** within 1 sprint (P1) or next sprint (P2-4)

