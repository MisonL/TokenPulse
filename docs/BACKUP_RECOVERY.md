# TokenPulse 备份与恢复指南

## 数据概述

TokenPulse 使用 PostgreSQL 存储核心数据，默认由 `docker-compose.yml` 中的 `postgres` 服务承载：

| 数据类型 | Schema | 关键表 |
| --- | --- | --- |
| 网关与 OAuth 数据 | `core` | `credentials`、`oauth_sessions`、`request_logs` |
| 企业能力数据 | `enterprise` | `admin_users`、`admin_roles`、`audit_events` |

---

## 备份策略

### 1. 逻辑备份（推荐）

```bash
mkdir -p ./backups
docker exec tokenpulse-postgres pg_dump \
  -U tokenpulse -d tokenpulse -Fc \
  > ./backups/tokenpulse_$(date +%Y%m%d_%H%M%S).dump
```

### 2. 自动备份脚本

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=./backups
RETENTION_DAYS=7
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/tokenpulse_$(date +%Y%m%d_%H%M%S).dump"
docker exec tokenpulse-postgres pg_dump -U tokenpulse -d tokenpulse -Fc > "$FILE"
find "$BACKUP_DIR" -name "*.dump" -mtime +$RETENTION_DAYS -delete
echo "backup done: $FILE"
```

---

## 恢复流程

### 1. 全量恢复

```bash
docker compose stop tokenpulse
cat ./backups/tokenpulse_20260303_020000.dump | \
  docker exec -i tokenpulse-postgres pg_restore \
  -U tokenpulse -d tokenpulse --clean --if-exists
docker compose start tokenpulse
curl http://localhost:9009/health
```

### 2. 选择性恢复（单表）

```bash
cat ./backups/tokenpulse_20260303_020000.dump | \
  docker exec -i tokenpulse-postgres pg_restore \
  -U tokenpulse -d tokenpulse -n core -t credentials
```

---

## 备份验证

```bash
docker exec tokenpulse-postgres psql -U tokenpulse -d tokenpulse -c "\dt core.*"
docker exec tokenpulse-postgres psql -U tokenpulse -d tokenpulse -c "SELECT count(*) FROM core.credentials;"
```

若 `\dt` 能看到表且关键计数正常，说明备份可用。
