# TokenPulse AI Gateway - 部署文档

## 系统要求

- Docker 20.10+
- Docker Compose 2.0+
- 至少 512MB RAM
- 至少 1GB 可用磁盘空间

## 快速开始

### 1. 克隆仓库

```bash
git clone <repository-url>
cd TokenPulse
```

### 2. 配置环境变量

创建 `.env` 文件：

```env
# 服务器配置
PORT=9009
BASE_URL=http://localhost:9009

# 数据库配置
DB_FILE_NAME=data/credentials.db

# API 密钥（生产环境必须修改）
API_SECRET=your-secret-key-here

# 代理配置（可选）
HTTP_PROXY=
HTTPS_PROXY=
```

### 3. 启动服务

```bash
docker-compose up -d
```

### 4. 访问应用

- 前端界面: http://localhost:9009
- API 文档: http://localhost:9009/docs/API.md

## Docker 部署

### 使用 Docker Compose

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f tokenpulse

# 停止服务
docker-compose down

# 重启服务
docker-compose restart
```

### 单独使用 Docker

```bash
# 构建镜像
docker build -t tokenpulse .

# 运行容器
docker run -d \
  --name tokenpulse \
  -p 9009:3000 \
  -v $(pwd)/data:/app/data \
  -e PORT=3000 \
  -e API_SECRET=your-secret-key \
  tokenpulse
```

## 生产环境部署

### 1. 环境变量配置

生产环境必须配置以下环境变量：

```env
# 服务器配置
PORT=3000
BASE_URL=https://your-domain.com
NODE_ENV=production

# 安全配置
API_SECRET=<强随机密钥，至少32字符>

# 数据库配置
DB_FILE_NAME=/data/credentials.db

# 代理配置（如需要）
HTTP_PROXY=
HTTPS_PROXY=
```

### 2. 使用反向代理

#### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Caddy 配置示例

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

### 3. HTTPS 配置

使用 Let's Encrypt 免费证书：

```bash
# 安装 certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 4. 数据持久化

```bash
# 创建数据目录
mkdir -p /var/lib/tokenpulse

# 修改 docker-compose.yml 添加卷映射
volumes:
  - /var/lib/tokenpulse:/app/data
```

### 5. 日志管理

```bash
# 查看容器日志
docker logs -f tokenpulse

# 配置日志轮转
docker run -d \
  --name tokenpulse \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  tokenpulse
```

### 6. 健康检查

```bash
# 检查服务状态
curl http://localhost:9009/health

# 预期响应
{
  "status": "ok",
  "service": "oauth2api",
  "providers": ["claude", "gemini", "antigravity", "kiro", "codex", "qwen", "iflow", "aistudio"]
}
```

## 端口映射

| 服务 | 容器端口 | 宿主机端口 | 说明 |
|------|---------|-----------|------|
| 主应用 | 3000 | 9009 | Web 界面和 API |
| Claude 回调 | 54545 | 54545 | OAuth 回调 |
| Gemini 回调 | 8085 | 8085 | OAuth 回调 |
| Codex 回调 | 1455 | 1455 | OAuth 回调 |
| iFlow 回调 | 11451 | 11451 | OAuth 回调 |

## 监控和维护

### 查看日志

```bash
# 实时日志
docker-compose logs -f

# 最近 100 行
docker-compose logs --tail=100

# 查看特定服务
docker-compose logs tokenpulse
```

### 备份数据

```bash
# 备份数据库
docker exec tokenpulse cp /app/data/credentials.db /tmp/
docker cp tokenpulse:/tmp/credentials.db ./backup-$(date +%Y%m%d).db

# 恢复数据库
docker cp ./backup-20260113.db tokenpulse:/tmp/
docker exec tokenpulse cp /tmp/backup-20260113.db /app/data/credentials.db
```

### 更新应用

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build

# 清理旧镜像
docker image prune -f
```

## 故障排除

### 容器无法启动

```bash
# 查看详细日志
docker-compose logs tokenpulse

# 检查端口占用
netstat -tlnp | grep 9009

# 检查磁盘空间
df -h
```

### OAuth 回调失败

1. 确认回调端口未被占用
2. 检查防火墙设置
3. 验证 BASE_URL 配置正确
4. 查看浏览器控制台错误信息

### 数据库错误

```bash
# 检查数据库文件权限
ls -la data/credentials.db

# 重新初始化数据库
rm data/credentials.db
docker-compose restart
```

### 性能问题

```bash
# 查看容器资源使用
docker stats tokenpulse

# 增加内存限制
docker-compose up -d --memory=1g
```

## 安全建议

1. **修改默认密钥**: 生产环境必须修改 `API_SECRET`
2. **使用 HTTPS**: 生产环境必须启用 HTTPS
3. **限制访问**: 使用防火墙限制访问 IP
4. **定期备份**: 定期备份数据库
5. **更新依赖**: 定期更新 Docker 镜像和依赖
6. **监控日志**: 监控异常访问和错误日志

## 性能优化

### 1. 启用缓存

缓存已默认启用，减少数据库查询 80%

### 2. 调整速率限制

修改 `src/middleware/rate-limiter.ts` 中的配置

### 3. 使用 CDN

为静态资源配置 CDN

### 4. 数据库优化

定期清理过期日志数据

## 支持与反馈

- GitHub Issues: <repository-url>/issues
- 文档: <repository-url>/docs
- API 文档: <repository-url>/docs/API.md