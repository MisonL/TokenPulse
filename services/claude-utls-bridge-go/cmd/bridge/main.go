package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	utls "github.com/refraction-networking/utls"
)

const (
	defaultPort       = 9460
	defaultUpstream   = "https://api.anthropic.com/v1/messages?beta=true"
	defaultTimeoutMs  = 30000
	requestIDHeader   = "X-Request-Id"
	bridgeAuthHeader  = "x-tokenpulse-bridge-key"
	forwardedByHeader = "X-TokenPulse-Forwarded-By"
)

type bridgeConfig struct {
	Port            int
	UpstreamRaw     string
	UpstreamURL     *url.URL
	UpstreamHost    string
	SharedKey       string
	Timeout         time.Duration
	DisableHTTP2    bool
	ReadHeaderLimit time.Duration
}

type jsonError struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	client := buildHTTPClient(cfg)
	handler := buildHTTPHandler(cfg, client)

	addr := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           accessLogMiddleware(handler),
		ReadHeaderTimeout: cfg.ReadHeaderLimit,
	}

	log.Printf("[bridge-go] 启动完成: addr=%s upstream=%s timeout=%s", addr, cfg.UpstreamURL.String(), cfg.Timeout)
	if cfg.SharedKey != "" {
		log.Printf("[bridge-go] 已启用内部鉴权头: %s", bridgeAuthHeader)
	}

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("服务异常退出: %v", err)
	}
}

func loadConfig() (*bridgeConfig, error) {
	port := parseIntEnv("PORT", defaultPort)
	upstreamRaw := strings.TrimSpace(getEnv("CLAUDE_BRIDGE_UPSTREAM", defaultUpstream))
	u, err := url.Parse(upstreamRaw)
	if err != nil {
		return nil, fmt.Errorf("CLAUDE_BRIDGE_UPSTREAM 无效: %w", err)
	}
	if u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("CLAUDE_BRIDGE_UPSTREAM 缺少 scheme/host: %s", upstreamRaw)
	}

	host := u.Host
	if h, _, splitErr := net.SplitHostPort(u.Host); splitErr == nil {
		host = h
	}

	cfg := &bridgeConfig{
		Port:            port,
		UpstreamRaw:     upstreamRaw,
		UpstreamURL:     u,
		UpstreamHost:    host,
		SharedKey:       strings.TrimSpace(os.Getenv("CLAUDE_BRIDGE_SHARED_KEY")),
		Timeout:         time.Duration(parseIntEnv("CLAUDE_BRIDGE_TIMEOUT_MS", defaultTimeoutMs)) * time.Millisecond,
		DisableHTTP2:    parseBoolEnv("CLAUDE_BRIDGE_DISABLE_HTTP2", false),
		ReadHeaderLimit: 10 * time.Second,
	}
	if cfg.Timeout < 1000*time.Millisecond {
		cfg.Timeout = 1000 * time.Millisecond
	}
	return cfg, nil
}

func buildHTTPClient(cfg *bridgeConfig) *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}

	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		ForceAttemptHTTP2:     !cfg.DisableHTTP2,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: cfg.Timeout,
		ExpectContinueTimeout: 1 * time.Second,
		DialTLSContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			rawConn, err := dialer.DialContext(ctx, network, addr)
			if err != nil {
				return nil, err
			}

			host := cfg.UpstreamHost
			if h, _, splitErr := net.SplitHostPort(addr); splitErr == nil {
				host = h
			}

			tlsCfg := &utls.Config{
				ServerName: host,
				MinVersion: utls.VersionTLS12,
			}

			uconn := utls.UClient(rawConn, tlsCfg, utls.HelloChrome_Auto)
			if err := uconn.HandshakeContext(ctx); err != nil {
				_ = rawConn.Close()
				return nil, fmt.Errorf("utls 握手失败: %w", err)
			}
			return uconn, nil
		},
	}

	return &http.Client{Timeout: cfg.Timeout, Transport: transport}
}

func buildHTTPHandler(cfg *bridgeConfig, client *http.Client) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, jsonError{Error: "method_not_allowed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":    "ok",
			"service":   "claude-utls-bridge-go",
			"upstream":  cfg.UpstreamURL.String(),
			"timeoutMs": cfg.Timeout.Milliseconds(),
		})
	})

	mux.HandleFunc("/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, jsonError{Error: "method_not_allowed"})
			return
		}
		if cfg.SharedKey != "" {
			if r.Header.Get(bridgeAuthHeader) != cfg.SharedKey {
				writeJSON(w, http.StatusForbidden, jsonError{Error: "bridge 内部鉴权失败"})
				return
			}
		}

		targetURL := *cfg.UpstreamURL
		if rawQuery := strings.TrimSpace(r.URL.RawQuery); rawQuery != "" {
			if targetURL.RawQuery == "" {
				targetURL.RawQuery = rawQuery
			} else {
				targetURL.RawQuery = targetURL.RawQuery + "&" + rawQuery
			}
		}

		upstreamReq, err := http.NewRequestWithContext(
			r.Context(),
			http.MethodPost,
			targetURL.String(),
			r.Body,
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, jsonError{Error: "构建上游请求失败", Details: err.Error()})
			return
		}

		copyRequestHeaders(upstreamReq.Header, r.Header)
		upstreamReq.Header.Del(bridgeAuthHeader)
		upstreamReq.Header.Set(forwardedByHeader, "claude-utls-bridge-go")
		if reqID := strings.TrimSpace(r.Header.Get(requestIDHeader)); reqID != "" {
			upstreamReq.Header.Set(requestIDHeader, reqID)
		}

		resp, err := client.Do(upstreamReq)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, jsonError{Error: "请求上游失败", Details: err.Error()})
			return
		}
		defer resp.Body.Close()

		copyResponseHeaders(w.Header(), resp.Header)
		w.WriteHeader(resp.StatusCode)
		if _, err := io.Copy(w, resp.Body); err != nil {
			log.Printf("[bridge-go] 回写响应失败: %v", err)
		}
	})

	return mux
}

func copyRequestHeaders(dst http.Header, src http.Header) {
	for k, values := range src {
		if skipHopByHopHeader(k) || strings.EqualFold(k, "host") || strings.EqualFold(k, "content-length") {
			continue
		}
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func copyResponseHeaders(dst http.Header, src http.Header) {
	for k, values := range src {
		if skipHopByHopHeader(k) {
			continue
		}
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func skipHopByHopHeader(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "connection", "proxy-connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("[bridge-go] JSON 响应编码失败: %v", err)
	}
}

func accessLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(rw, r)
		log.Printf("[bridge-go] %s %s %d %s", r.Method, r.URL.Path, rw.statusCode, time.Since(start))
	})
}

type statusWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func getEnv(key, defaultValue string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return defaultValue
}

func parseIntEnv(key string, defaultValue int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return defaultValue
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return defaultValue
	}
	return value
}

func parseBoolEnv(key string, defaultValue bool) bool {
	raw := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if raw == "" {
		return defaultValue
	}
	switch raw {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultValue
	}
}
