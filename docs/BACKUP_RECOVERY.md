# TokenPulse 备份与恢复指南

## 数据概述

TokenPulse 使用 SQLite 存储所有持久化数据：

| 数据类型 | 存储位置              | 说明                         |
| -------- | --------------------- | ---------------------------- |
| 凭证数据 | `data/credentials.db` | OAuth tokens、refresh tokens |
| 系统设置 | `data/credentials.db` | 用户配置项                   |

## 备份策略

### 手动备份

```bash
# 停止服务（确保数据一致性）
docker compose stop tokenpulse

# 备份数据库
cp ./data/credentials.db ./backups/credentials_$(date +%Y%m%d_%H%M%S).db

# 重启服务
docker compose start tokenpulse
```

### 热备份（服务运行中）

```bash
# SQLite 支持热备份
sqlite3 ./data/credentials.db ".backup './backups/credentials_hot.db'"
```

### 自动备份脚本

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/path/to/backups"
DB_PATH="./data/credentials.db"
RETENTION_DAYS=7

# 创建备份
BACKUP_FILE="${BACKUP_DIR}/credentials_$(date +%Y%m%d_%H%M%S).db"
sqlite3 $DB_PATH ".backup '${BACKUP_FILE}'"

# 压缩
gzip $BACKUP_FILE

# 清理旧备份
find $BACKUP_DIR -name "*.db.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: ${BACKUP_FILE}.gz"
```

### Cron 定时备份

```bash
# 每天凌晨 2 点备份
0 2 * * * /path/to/backup.sh >> /var/log/tokenpulse-backup.log 2>&1
```

## 恢复流程

### 完整恢复

```bash
# 1. 停止服务
docker compose stop tokenpulse

# 2. 备份当前数据（以防万一）
mv ./data/credentials.db ./data/credentials.db.bak

# 3. 恢复备份
gunzip -c /path/to/backup/credentials_20260121.db.gz > ./data/credentials.db

# 4. 重启服务
docker compose start tokenpulse

# 5. 验证
curl http://localhost:9009/health
```

### 选择性恢复（仅特定 Provider）

```bash
# 从备份中导出特定 provider 的凭证
sqlite3 backup.db "SELECT * FROM credentials WHERE provider='claude'" > claude_creds.sql

# 导入到当前数据库
sqlite3 ./data/credentials.db < claude_creds.sql
```

## 灾难恢复

### 场景 1：数据库损坏

```bash
# 尝试修复
sqlite3 ./data/credentials.db "PRAGMA integrity_check"

# 如果损坏，从备份恢复
```

### 场景 2：容器丢失

```bash
# 重新部署
docker compose up -d --build

# 恢复数据
# (按上述恢复流程操作)
```

### 场景 3：主机迁移

```bash
# 在旧主机上
tar -czvf tokenpulse-data.tar.gz ./data ./docker-compose.yml ./.env

# 传输到新主机
scp tokenpulse-data.tar.gz user@newhost:/path/to/

# 在新主机上
tar -xzvf tokenpulse-data.tar.gz
docker compose up -d --build
```

## 备份验证

```bash
# 验证备份完整性
sqlite3 backup.db "PRAGMA integrity_check"
# 预期输出: ok

# 验证数据
sqlite3 backup.db "SELECT COUNT(*) FROM credentials"
```
