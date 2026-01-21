import type { Context, Next } from "hono";
import { config } from "../config";
import crypto from "node:crypto";

/**
 * 认证中间件选项
 */
export interface AuthMiddlewareOptions {
  /**
   * 是否要求认证
   */
  requireAuth?: boolean;
  /**
   * 允许的 HTTP 方法
   */
  methods?: string[];
  /**
   * 自定义认证函数
   */
  customAuth?: (c: Context) => boolean | Promise<boolean>;
}

/**
 * 认证结果
 */
export interface AuthResult {
  authenticated: boolean;
  error?: string;
  statusCode?: number;
}

/**
 * 验证 Bearer Token
 */
export function verifyBearerToken(token: string): boolean {
  if (!token) return false;

  // 移除 "Bearer " 前缀
  const actualToken = token.replace(/^Bearer\s+/i, "");

  // 验证 token 是否匹配配置的 API Secret
  return actualToken === config.apiSecret;
}

/**
 * 验证请求签名（可选的高级认证）
 */
export function verifyRequestSignature(c: Context): boolean {
  // 获取请求签名头
  const signature = c.req.header("X-Signature");
  const timestamp = c.req.header("X-Timestamp");

  if (!signature || !timestamp) {
    // 如果没有签名头，回退到 Bearer Token 认证
    return verifyBearerToken(c.req.header("Authorization") || "");
  }

  // 验证时间戳（防止重放攻击）
  const now = Date.now();
  const requestTime = parseInt(timestamp, 10);
  const timeDiff = Math.abs(now - requestTime);

  // 允许 5 分钟的时间差
  if (timeDiff > 5 * 60 * 1000) {
    return false;
  }

  // SECURITY: Support HMAC-SHA256 verification
  // 签名 = HMAC-SHA256(method + path + timestamp, secret)
  try {
    const method = c.req.method;
    const path = c.req.path;
    const expectedSignature = crypto
      .createHmac("sha256", config.apiSecret)
      .update(`${method}${path}${timestamp}`)
      .digest("hex");
    
    return signature === expectedSignature;
  } catch (e) {
    // If crypto fails, fall back to Bearer token
    return verifyBearerToken(c.req.header("Authorization") || "");
  }
}

/**
 * 创建认证中间件
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  const {
    requireAuth = true,
    methods = ["POST", "PUT", "DELETE", "PATCH"],
    customAuth,
  } = options;

  return async (c: Context, next: Next) => {
    // 如果不需要认证，直接通过
    if (!requireAuth) {
      await next();
      return;
    }

    // 如果当前方法不在需要认证的列表中，直接通过
    if (!methods.includes(c.req.method)) {
      await next();
      return;
    }

    // 如果有自定义认证函数，使用它
    if (customAuth) {
      const customResult = await customAuth(c);
      if (customResult) {
        await next();
        return;
      }
      return c.json({ error: "Unauthorized" }, 401);
    }

    // 尝试验证请求签名
    if (verifyRequestSignature(c)) {
      await next();
      return;
    }

    // 尝试验证 Bearer Token
    const authHeader = c.req.header("Authorization");
    if (verifyBearerToken(authHeader || "")) {
      await next();
      return;
    }

    // 认证失败
    return c.json(
      { error: "Unauthorized: Missing or invalid authentication" },
      401,
    );
  };
}

/**
 * 预定义的认证中间件实例
 */
export const authMiddleware = createAuthMiddleware({
  requireAuth: true,
  methods: ["POST", "PUT", "DELETE", "PATCH"],
});

/**
 * 仅对 POST/DELETE 需要认证的中间件
 */
export const writeAuthMiddleware = createAuthMiddleware({
  requireAuth: true,
  methods: ["POST", "DELETE"],
});

/**
 * 严格的认证中间件（所有方法都需要认证）
 */
export const strictAuthMiddleware = createAuthMiddleware({
  requireAuth: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
});

/**
 * 可选认证中间件（如果提供了认证则验证，否则通过）
 */
export const optionalAuthMiddleware = createAuthMiddleware({
  requireAuth: false,
});

/**
 * 从上下文中提取认证信息
 */
export function getAuthInfo(c: Context): {
  authenticated: boolean;
  method?: string;
} {
  const authHeader = c.req.header("Authorization");
  const signature = c.req.header("X-Signature");
  const timestamp = c.req.header("X-Timestamp");

  // 检查请求签名
  if (signature && timestamp) {
    return { authenticated: verifyRequestSignature(c), method: "signature" };
  }

  // 检查 Bearer Token
  if (authHeader) {
    return { authenticated: verifyBearerToken(authHeader), method: "bearer" };
  }

  return { authenticated: false };
}
