import { z } from "zod";

/**
 * 支持的提供商列表
 */
export const SUPPORTED_PROVIDERS = [
  "kiro",
  "codex",
  "qwen",
  "iflow",
  "aistudio",
  "claude",
  "gemini",
  "antigravity",
] as const;

/**
 * 支持的提供商类型
 */
export type ProviderType = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * 基础验证模式
 */

// 提供商验证
export const providerSchema = z.enum(SUPPORTED_PROVIDERS);

// 凭据验证
export const credentialSchema = z.object({
  provider: providerSchema,
  token: z
    .string()
    .min(10, "Token must be at least 10 characters")
    .max(10000, "Token too long"),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// AI Studio Service Account JSON 验证
export const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1, "project_id is required"),
  private_key_id: z.string().min(1, "private_key_id is required"),
  private_key: z.string().min(1, "private_key is required"),
  client_email: z.string().email("Invalid client_email format"),
  client_id: z.string().min(1, "client_id is required"),
  auth_uri: z.string().url("Invalid auth_uri format"),
  token_uri: z.string().url("Invalid token_uri format"),
  auth_provider_x509_cert_url: z
    .string()
    .url("Invalid auth_provider_x509_cert_url format"),
  client_x509_cert_url: z.string().url("Invalid client_x509_cert_url format"),
});

// 设置验证
export const settingSchema = z.object({
  key: z
    .string()
    .min(1, "Setting key is required")
    .max(100, "Setting key too long"),
  value: z.string().max(10000, "Setting value too long"),
});

// 日志级别验证
export const logLevelSchema = z.enum(["DEBUG", "INFO", "WARN", "ERROR"]);

// 布尔值验证（接受字符串和布尔值）
export const booleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((val) => val === "true"),
]);

// 端口验证
export const portSchema = z.number().int().min(1).max(65535);

// URL 验证
export const urlSchema = z.string().url("Invalid URL format");

// 邮箱验证
export const emailSchema = z.string().email("Invalid email format");

// API 密钥验证
export const apiKeySchema = z
  .string()
  .min(16, "API key must be at least 16 characters");

// 设备代码验证（用于 OAuth 设备流）
export const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().url(),
  verification_uri_complete: z.string().url().optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().default(5),
});

// Kiro 客户端注册验证
export const kiroClientSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

// Qwen 设备流验证
export const qwenDeviceFlowSchema = z.object({
  device_code: z.string().min(1),
  code_verifier: z.string().min(1),
});

/**
 * API 请求验证模式
 */

// 创建/更新凭据请求
export const createCredentialRequestSchema = credentialSchema;

// 更新设置请求
export const updateSettingRequestSchema = settingSchema;

// AI Studio 保存请求
export const aistudioSaveRequestSchema = z.object({
  serviceAccountJson: z.union([
    z.string().min(1, "Service Account JSON is required"),
    serviceAccountSchema,
  ]),
});

// Qwen 设备流启动响应
export const qwenDeviceFlowResponseSchema = deviceCodeSchema;

// Kiro 设备流启动响应
export const kiroDeviceFlowResponseSchema = deviceCodeSchema.extend({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

// Qwen 轮询请求
export const qwenPollRequestSchema = qwenDeviceFlowSchema;

// Kiro 轮询请求
export const kiroPollRequestSchema = z.object({
  deviceCode: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

/**
 * 验证辅助函数
 */

/**
 * 验证提供商类型
 */
export function validateProvider(provider: unknown): ProviderType {
  return providerSchema.parse(provider);
}

/**
 * 验证凭据
 */
export function validateCredential(data: unknown) {
  return credentialSchema.parse(data);
}

/**
 * 验证 Service Account JSON
 */
export function validateServiceAccount(data: unknown) {
  return serviceAccountSchema.parse(data);
}

/**
 * 验证设置
 */
export function validateSetting(data: unknown) {
  return settingSchema.parse(data);
}

/**
 * 安全地验证数据（返回验证结果而不是抛出错误）
 */
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, errors: result.error };
  }
}

/**
 * 获取验证错误的格式化消息
 */
export function formatValidationErrors(
  error: unknown,
): { path: string; message: string }[] {
  if (!(error instanceof z.ZodError)) {
    return [{ path: "unknown", message: String(error) }];
  }
  return error.issues.map((err) => {
    return {
      path: err.path.join("."),
      message: err.message,
    };
  });
}

/**
 * 创建验证中间件
 */
export function createValidationMiddleware<T>(schema: z.ZodSchema<T>) {
  return async (data: unknown): Promise<T> => {
    const result = safeValidate(schema, data);

    if (!result.success) {
      const errors = formatValidationErrors(result.errors);
      throw new Error(`Validation failed: ${errors.join(", ")}`);
    }

    return result.data;
  };
}

/**
 * SQL 注入防护 - 验证输入不包含危险的 SQL 模式
 */
export function validateSqlSafe(input: string): boolean {
  const dangerousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|UNION)\b)/i,
    /(--|\/\*|\*\/|;)/,
    /(\bOR\b|\bAND\b).*=.*=/i,
    /(\bWHERE\b.*\bOR\b)/i,
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(input));
}

/**
 * XSS 防护 - 验证输入不包含危险的 HTML/JavaScript
 */
export function validateXssSafe(input: string): boolean {
  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
  ];

  return !dangerousPatterns.some((pattern) => pattern.test(input));
}

/**
 * 综合安全验证
 */
export function validateInputSafety(input: string): {
  safe: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (!validateSqlSafe(input)) {
    issues.push("Potential SQL injection detected");
  }

  if (!validateXssSafe(input)) {
    issues.push("Potential XSS attack detected");
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}
