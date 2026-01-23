# Claude Context Engine - Infrastructure Expansion Plan

## Vision
Run a software business from a phone on a yacht in a fjord. Complete infrastructure awareness + cross-server context sync.

---

## Current State

```
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL ONLY (per machine)                  │
│  ~/.claude/memory.db (global learnings, patterns, debt)      │
│  .claude/memory.db   (per-project context)                   │
│                                                              │
│  Zero dependencies • Bun/TypeScript • SQLite + FTS5          │
└─────────────────────────────────────────────────────────────┘
```

**Limitations:**
- No cross-server awareness
- No infrastructure knowledge
- No service topology understanding
- No deployment tracking across servers

---

## Target State

```
┌─────────────────────────────────────────────────────────────┐
│                     TURSO (Distributed SQLite)               │
│                     infra.db (replicated globally)           │
│                                                              │
│  • Infrastructure topology (servers, services, routes)       │
│  • Cross-project learnings and patterns                      │
│  • Deployment history and health                             │
│  • Service dependencies and communication maps               │
└─────────────────────────────────────────────────────────────┘
        ↑               ↑               ↑               ↑
   myserver    node1         hetzner          laptop
        │               │               │               │
        ▼               ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ local.db    │ │ local.db    │ │ local.db    │ │ local.db    │
│ (projects)  │ │ (projects)  │ │ (projects)  │ │ (projects)  │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

---

## Phase 1: Infrastructure Schema

New tables for `infra.db`:

### Servers
```sql
CREATE TABLE servers (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,           -- myserver, node1, hetzner
    hostname TEXT,                       -- actual hostname
    ip_addresses TEXT,                   -- JSON array: ["192.168.1.10", "10.0.0.1"]
    role TEXT,                           -- production, staging, development, homelab
    ssh_config TEXT,                     -- JSON: {user, port, keyPath, jumpHost}
    os TEXT,                             -- ubuntu-24.04, debian-12
    resources TEXT,                      -- JSON: {cpu: 8, ram: "32GB", disk: "1TB"}
    tags TEXT,                           -- JSON array: ["docker", "k8s", "gpu"]
    status TEXT DEFAULT 'unknown',       -- online, offline, degraded, unknown
    last_seen DATETIME,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Services
```sql
CREATE TABLE services (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,                  -- api, web, worker, postgres, redis
    server_id INTEGER REFERENCES servers(id),
    type TEXT,                           -- app, database, cache, queue, proxy
    runtime TEXT,                        -- bun, node, go, docker, systemd
    port INTEGER,
    health_endpoint TEXT,                -- /health, /api/health
    health_status TEXT,                  -- healthy, unhealthy, degraded, unknown
    last_health_check DATETIME,
    config TEXT,                         -- JSON: service-specific config
    env_vars TEXT,                       -- JSON: non-secret env var names
    project_path TEXT,                   -- /opt/apps/myapi
    git_repo TEXT,                       -- git@github.com:user/repo
    current_version TEXT,                -- git sha or semver
    deploy_command TEXT,                 -- "cd /app && git pull && bun run build"
    restart_command TEXT,                -- "systemctl restart myapp"
    log_path TEXT,                       -- /var/log/myapp/app.log
    status TEXT DEFAULT 'unknown',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, name)
);
```

### Routes (Ingress/DNS)
```sql
CREATE TABLE routes (
    id INTEGER PRIMARY KEY,
    domain TEXT NOT NULL,                -- api.example.com
    path TEXT DEFAULT '/',               -- /api/v1
    service_id INTEGER REFERENCES services(id),
    method TEXT DEFAULT '*',             -- GET, POST, *, etc.
    proxy_type TEXT,                     -- nginx, caddy, cloudflare, direct
    ssl TEXT,                            -- letsencrypt, cloudflare, self-signed
    rate_limit TEXT,                     -- JSON: {requests: 100, window: "1m"}
    auth_required INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(domain, path, method)
);
```

### Service Dependencies
```sql
CREATE TABLE service_deps (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id),
    depends_on_service_id INTEGER REFERENCES services(id),
    depends_on_external TEXT,            -- external service name if not in our infra
    dependency_type TEXT,                -- database, cache, api, queue, auth
    connection_string_env TEXT,          -- DATABASE_URL, REDIS_URL
    required INTEGER DEFAULT 1,          -- 1 = hard dependency, 0 = optional
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(service_id, depends_on_service_id)
);
```

### Deployments
```sql
CREATE TABLE deployments (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id),
    version TEXT NOT NULL,               -- git sha or semver
    previous_version TEXT,
    deployed_by TEXT,                    -- user, ci, claude
    deploy_method TEXT,                  -- manual, ci, claude
    status TEXT,                         -- pending, in_progress, success, failed, rolled_back
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    duration_seconds INTEGER,
    logs TEXT,
    rollback_version TEXT,               -- if rolled back, what version
    notes TEXT
);
```

### Infrastructure Events
```sql
CREATE TABLE infra_events (
    id INTEGER PRIMARY KEY,
    server_id INTEGER REFERENCES servers(id),
    service_id INTEGER REFERENCES services(id),
    event_type TEXT NOT NULL,            -- deploy, restart, health_change, alert, incident
    severity TEXT,                       -- info, warning, error, critical
    title TEXT NOT NULL,
    description TEXT,
    metadata TEXT,                       -- JSON
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Secrets Registry (metadata only, not actual secrets)
```sql
CREATE TABLE secrets_registry (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,                  -- DATABASE_URL, STRIPE_KEY
    service_id INTEGER REFERENCES services(id),
    server_id INTEGER REFERENCES servers(id),
    secret_manager TEXT,                 -- env_file, 1password, vault, doppler
    path TEXT,                           -- path in secret manager
    last_rotated DATETIME,
    rotation_policy TEXT,                -- JSON: {interval: "90d"}
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, service_id)
);
```

---

## Phase 2: CLI Commands

### Server Management
```bash
context infra server add myserver \
  --ip 192.168.1.10 \
  --role homelab \
  --ssh "user=deploy,port=22,key=~/.ssh/id_ed25519"

context infra server list
context infra server status [name]       # Check connectivity + basic metrics
context infra server ssh <name>          # Quick SSH connect
```

### Service Management
```bash
context infra service add api \
  --server myserver \
  --type app \
  --port 3000 \
  --health /health \
  --project /opt/apps/api \
  --deploy "cd /opt/apps/api && git pull && bun run build && pm2 restart api"

context infra service list [--server name]
context infra service status <name>      # Health check + recent logs
context infra service logs <name> [-f]   # Tail logs
context infra service restart <name>
```

### Route Management
```bash
context infra route add api.example.com \
  --service api \
  --ssl letsencrypt

context infra route list
context infra route check                # Verify all routes resolve correctly
```

### Dependency Mapping
```bash
context infra deps <service>             # Show what this service depends on
context infra deps --reverse <service>   # Show what depends on this service
context infra map                        # ASCII art or JSON of full topology
context infra map --mermaid              # Mermaid diagram output
```

### Deployment
```bash
context infra deploy <service>           # Run deploy command
context infra deploy <service> --version <sha>
context infra rollback <service>         # Rollback to previous version
context infra history <service>          # Deployment history
```

### Health & Monitoring
```bash
context infra health                     # Check all services
context infra health <service>           # Check specific service
context infra scan                       # Full infrastructure scan (discover services)
context infra events [--server] [--service] [--since]
```

### Quick Operations (Yacht Mode)
```bash
context infra status                     # One-liner: all servers + services health
context infra brief                      # AI summary of infrastructure state
context infra alert                      # Show any active issues

# From phone:
context infra deploy api                 # Deploy with confidence
context infra rollback api               # Quick rollback if broken
```

---

## Phase 3: Cross-Server Sync

### Option A: Turso (Recommended)
```
┌─────────────────────────────────────────┐
│  Turso Database (libsql)                │
│  URL: libsql://context.turso.io          │
│  Replicas: edge locations worldwide     │
└─────────────────────────────────────────┘
```

**Why Turso:**
- SQLite-compatible (minimal code changes)
- Built-in replication
- Works offline with embedded replicas
- Edge locations for low latency anywhere
- Free tier: 9GB storage, 500M rows read/month

**Implementation:**
```typescript
// context.ts changes
import { createClient } from "@libsql/client";

function getInfraDb() {
  return createClient({
    url: process.env.TURSO_URL || "file:~/.claude/infra.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
    // Embedded replica for offline support
    syncUrl: process.env.TURSO_URL,
    syncInterval: 60, // sync every 60 seconds
  });
}
```

### Option B: Self-Hosted (Litestream + S3/R2)
```
┌─────────────────────────────────────────┐
│  Cloudflare R2 / S3                     │
│  Continuous SQLite replication          │
└─────────────────────────────────────────┘
        ↑ replicate        ↓ restore
   myserver       node1 / hetzner
```

**Implementation:**
- Litestream on each server
- Write to one primary, replicate to object storage
- Others restore on demand
- Conflict risk if multiple writers

### Option C: Hybrid
- Local SQLite for projects (fast, offline)
- Turso for infra + global learnings (synced)
- Best of both worlds

---

## Phase 4: AI-Powered Infrastructure Intelligence

### Smart Deployment
```bash
context infra deploy api --smart
```
Claude analyzes:
- Recent commits since last deploy
- Dependencies that might be affected
- Current health of dependent services
- Time of day / traffic patterns
- Suggests: "Safe to deploy" or "Wait: database migration required first"

### Impact Analysis
```bash
context infra impact postgres
```
Shows:
- All services that depend on postgres
- Estimated downtime impact
- Suggested maintenance window
- Rollback plan

### Incident Response
```bash
context infra incident "api returning 500s"
```
Claude:
1. Checks service health
2. Tails recent logs
3. Checks recent deployments
4. Checks dependent service health
5. Suggests: "Redis connection timeout. Redis service on node1 shows high memory. Recommend: restart redis or increase memory limit."

### Cost Optimization
```bash
context infra costs
```
Analyzes:
- Underutilized servers
- Services that could be consolidated
- Suggests: "node1 CPU avg 5%. Consider moving worker service to myserver."

---

## Phase 5: Mobile-First Operations

### Telegram Bot (Optional)
```
You: /status
Bot:
✅ myserver: 3 services healthy
✅ node1: 2 services healthy
⚠️ hetzner: api degraded (high latency)

You: /deploy api
Bot:
Deploying api to hetzner...
✅ Build successful
✅ Health check passed
✅ Version a1b2c3d live
```

### Simple Web Dashboard
- Single HTML page served by `context infra serve`
- Real-time health status
- One-click deploy/rollback buttons
- Works on mobile

---

## Implementation Order

### Week 1: Foundation
1. [ ] Add infra schema to schema.sql
2. [ ] Implement server CRUD commands
3. [ ] Implement service CRUD commands
4. [ ] Basic SSH connectivity check

### Week 2: Operations
5. [ ] Health check system (HTTP + custom checks)
6. [ ] Deploy/rollback commands
7. [ ] Log tailing over SSH
8. [ ] Route management

### Week 3: Intelligence
9. [ ] `context infra map` - topology visualization
10. [ ] `context infra scan` - auto-discover services
11. [ ] AI-powered status brief
12. [ ] Dependency analysis

### Week 4: Sync
13. [ ] Turso integration for infra.db
14. [ ] Offline-first with embedded replicas
15. [ ] Sync global learnings to Turso
16. [ ] Test from multiple locations

### Week 5: Polish
17. [ ] `context infra incident` AI troubleshooting
18. [ ] Mobile web dashboard
19. [ ] Telegram bot (optional)
20. [ ] Documentation

---

## Architecture Decision

**Recommendation: Option C (Hybrid)**

```
┌─────────────────────────────────────────────────────────────┐
│                    TURSO (cloud sync)                        │
│  infra.db: servers, services, routes, deployments           │
│  global.db: learnings, patterns, debt (cross-project)       │
└─────────────────────────────────────────────────────────────┘
        ↑ sync              ↑ sync              ↑ sync
   myserver         node1              hetzner
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL SQLite (fast, offline)              │
│  .claude/memory.db: project files, decisions, sessions       │
└─────────────────────────────────────────────────────────────┘
```

**Why:**
- Project context stays local (fast, no network dependency for dev work)
- Infrastructure is shared (deploy from anywhere)
- Global learnings sync (what you learn on laptop helps on server)
- Works offline (embedded Turso replica syncs when connected)
- One dependency addition: `@libsql/client` (Turso's SQLite driver)

---

## Cost Estimate

| Service | Cost | Notes |
|---------|------|-------|
| Turso | $0/mo | Free tier: 9GB, 500M reads |
| Domain (optional) | ~$12/yr | For dashboard |
| **Total** | **~$0-1/mo** | |

---

## Questions Before Proceeding

1. **Server access**: Do all 3 servers have SSH access from each other, or is there a bastion/jump host?

2. **Current services**: What services are already running? (rough list helps design the scan feature)

3. **Deployment preference**:
   - Git pull + build on server?
   - Docker containers?
   - Pre-built binaries?

4. **Secrets management**: Currently using .env files, 1Password, Vault, or something else?

5. **Priority**: Start with sync (Turso) or infra commands first?

---

*"Infrastructure as code is good. Infrastructure as context is better."*
