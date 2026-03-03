# Claude uTLS Bridge (Go)

该服务用于为 Claude 请求提供可选的 Go uTLS 传输层（模拟更接近浏览器的 TLS 指纹），供 TokenPulse 在 `CLAUDE_TLS_MODE=strict` 失败后降级调用。

## 启动

```bash
cd services/claude-utls-bridge-go
go run ./cmd/bridge
```

或在仓库根目录：

```bash
go run ./services/claude-utls-bridge-go/cmd/bridge
```

## 环境变量

- `PORT`：监听端口，默认 `9460`。
- `CLAUDE_BRIDGE_UPSTREAM`：上游地址，默认 `https://api.anthropic.com/v1/messages?beta=true`。
- `CLAUDE_BRIDGE_TIMEOUT_MS`：请求超时，默认 `30000`。
- `CLAUDE_BRIDGE_SHARED_KEY`：可选内部鉴权密钥；设置后必须携带 `x-tokenpulse-bridge-key`。
- `CLAUDE_BRIDGE_DISABLE_HTTP2`：可选，设为 `true` 时禁用 HTTP/2。

## 健康检查

```bash
curl http://127.0.0.1:9460/health
```

## Docker

```bash
docker build -t tokenpulse-claude-bridge-go ./services/claude-utls-bridge-go
docker run --rm -p 9460:9460 \
  -e CLAUDE_BRIDGE_SHARED_KEY=your-key \
  tokenpulse-claude-bridge-go
```
