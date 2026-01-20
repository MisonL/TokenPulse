/**
 * 错误码定义
 */
export enum ErrorCode {
  // 通用错误 (1000-1999)
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",

  // 认证错误 (2000-2999)
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_INVALID = "TOKEN_INVALID",
  AUTH_FAILED = "AUTH_FAILED",

  // 凭据错误 (3000-3999)
  CREDENTIAL_NOT_FOUND = "CREDENTIAL_NOT_FOUND",
  CREDENTIAL_ALREADY_EXISTS = "CREDENTIAL_ALREADY_EXISTS",
  INVALID_PROVIDER = "INVALID_PROVIDER",
  CREDENTIAL_SAVE_FAILED = "CREDENTIAL_SAVE_FAILED",
  CREDENTIAL_DELETE_FAILED = "CREDENTIAL_DELETE_FAILED",

  // OAuth 错误 (4000-4999)
  OAUTH_FLOW_FAILED = "OAUTH_FLOW_FAILED",
  OAUTH_POLL_FAILED = "OAUTH_POLL_FAILED",
  OAUTH_STATE_MISMATCH = "OAUTH_STATE_MISMATCH",
  OAUTH_TOKEN_REFRESH_FAILED = "OAUTH_TOKEN_REFRESH_FAILED",

  // 提供商错误 (5000-5999)
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
  PROVIDER_RATE_LIMITED = "PROVIDER_RATE_LIMITED",
  PROVIDER_ERROR = "PROVIDER_ERROR",

  // 设置错误 (6000-6999)
  SETTING_NOT_FOUND = "SETTING_NOT_FOUND",
  SETTING_INVALID = "SETTING_INVALID",
  SETTING_SAVE_FAILED = "SETTING_SAVE_FAILED",

  // 数据库错误 (7000-7999)
  DATABASE_ERROR = "DATABASE_ERROR",
  DATABASE_CONNECTION_ERROR = "DATABASE_CONNECTION_ERROR",
  DATABASE_QUERY_ERROR = "DATABASE_QUERY_ERROR",
}

/**
 * HTTP 状态码映射
 */
export const ERROR_CODE_TO_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.UNKNOWN_ERROR]: 500,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,

  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.AUTH_FAILED]: 401,

  [ErrorCode.CREDENTIAL_NOT_FOUND]: 404,
  [ErrorCode.CREDENTIAL_ALREADY_EXISTS]: 409,
  [ErrorCode.INVALID_PROVIDER]: 400,
  [ErrorCode.CREDENTIAL_SAVE_FAILED]: 500,
  [ErrorCode.CREDENTIAL_DELETE_FAILED]: 500,

  [ErrorCode.OAUTH_FLOW_FAILED]: 500,
  [ErrorCode.OAUTH_POLL_FAILED]: 500,
  [ErrorCode.OAUTH_STATE_MISMATCH]: 400,
  [ErrorCode.OAUTH_TOKEN_REFRESH_FAILED]: 500,

  [ErrorCode.PROVIDER_UNAVAILABLE]: 503,
  [ErrorCode.PROVIDER_RATE_LIMITED]: 429,
  [ErrorCode.PROVIDER_ERROR]: 500,

  [ErrorCode.SETTING_NOT_FOUND]: 404,
  [ErrorCode.SETTING_INVALID]: 400,
  [ErrorCode.SETTING_SAVE_FAILED]: 500,

  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.DATABASE_CONNECTION_ERROR]: 503,
  [ErrorCode.DATABASE_QUERY_ERROR]: 500,
};

/**
 * 用户友好的错误消息
 */
export const ERROR_CODE_TO_MESSAGE: Record<ErrorCode, string> = {
  [ErrorCode.UNKNOWN_ERROR]: "An unknown error occurred",
  [ErrorCode.VALIDATION_ERROR]: "Invalid input data",
  [ErrorCode.UNAUTHORIZED]: "Authentication required",
  [ErrorCode.FORBIDDEN]: "Access denied",
  [ErrorCode.NOT_FOUND]: "Resource not found",
  [ErrorCode.INTERNAL_SERVER_ERROR]: "Internal server error",

  [ErrorCode.INVALID_CREDENTIALS]: "Invalid credentials",
  [ErrorCode.TOKEN_EXPIRED]: "Token has expired",
  [ErrorCode.TOKEN_INVALID]: "Invalid token",
  [ErrorCode.AUTH_FAILED]: "Authentication failed",

  [ErrorCode.CREDENTIAL_NOT_FOUND]: "Credential not found",
  [ErrorCode.CREDENTIAL_ALREADY_EXISTS]: "Credential already exists",
  [ErrorCode.INVALID_PROVIDER]: "Invalid provider",
  [ErrorCode.CREDENTIAL_SAVE_FAILED]: "Failed to save credential",
  [ErrorCode.CREDENTIAL_DELETE_FAILED]: "Failed to delete credential",

  [ErrorCode.OAUTH_FLOW_FAILED]: "OAuth flow failed",
  [ErrorCode.OAUTH_POLL_FAILED]: "OAuth polling failed",
  [ErrorCode.OAUTH_STATE_MISMATCH]: "OAuth state mismatch",
  [ErrorCode.OAUTH_TOKEN_REFRESH_FAILED]: "Failed to refresh token",

  [ErrorCode.PROVIDER_UNAVAILABLE]: "Provider is unavailable",
  [ErrorCode.PROVIDER_RATE_LIMITED]: "Provider rate limit exceeded",
  [ErrorCode.PROVIDER_ERROR]: "Provider error",

  [ErrorCode.SETTING_NOT_FOUND]: "Setting not found",
  [ErrorCode.SETTING_INVALID]: "Invalid setting",
  [ErrorCode.SETTING_SAVE_FAILED]: "Failed to save setting",

  [ErrorCode.DATABASE_ERROR]: "Database error",
  [ErrorCode.DATABASE_CONNECTION_ERROR]: "Database connection error",
  [ErrorCode.DATABASE_QUERY_ERROR]: "Database query error",
};

/**
 * 基础应用错误类
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    isOperational: boolean = true,
  ) {
    super(message || ERROR_CODE_TO_MESSAGE[code]);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = ERROR_CODE_TO_STATUS[code];
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      details: this.details,
      ...(process.env.NODE_ENV === "development" && { stack: this.stack }),
    };
  }
}

/**
 * 验证错误
 */
export class ValidationError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, message, details);
  }
}

/**
 * 认证错误
 */
export class AuthenticationError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.UNAUTHORIZED, message, details);
  }
}

/**
 * 授权错误
 */
export class AuthorizationError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.FORBIDDEN, message, details);
  }
}

/**
 * 未找到错误
 */
export class NotFoundError extends AppError {
  constructor(message?: string, details?: Record<string, unknown>) {
    super(ErrorCode.NOT_FOUND, message, details);
  }
}

/**
 * 凭据错误
 */
export class CredentialError extends AppError {
  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
  }
}

/**
 * OAuth 错误
 */
export class OAuthError extends AppError {
  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
  }
}

/**
 * 提供商错误
 */
export class ProviderError extends AppError {
  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
  }
}

/**
 * 数据库错误
 */
export class DatabaseError extends AppError {
  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details);
  }
}

/**
 * 错误处理工具函数
 */

/**
 * 判断是否为应用错误
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * 判断是否为操作错误（可预期的错误）
 */
export function isOperationalError(error: unknown): boolean {
  if (isAppError(error)) {
    return error.isOperational;
  }
  return false;
}

/**
 * 将任意错误转换为应用错误
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, error.message, {
      originalError: error.name,
      stack: error.stack,
    });
  }

  return new AppError(ErrorCode.INTERNAL_SERVER_ERROR, String(error));
}

/**
 * 记录错误
 */
export function logError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const appError = toAppError(error);

  const logEntry = {
    error: appError.toJSON(),
    context,
    timestamp: new Date().toISOString(),
  };

  // TODO: 集成到日志系统
  console.error("[ERROR]", JSON.stringify(logEntry, null, 2));
}

/**
 * 创建错误响应
 */
export function createErrorResponse(error: unknown): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  const appError = toAppError(error);

  return {
    statusCode: appError.statusCode,
    body: appError.toJSON(),
  };
}

/**
 * 异步错误处理包装器
 */
export function asyncHandler<T extends (...args: any[]) => Promise<any>>(
  fn: T,
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      logError(error, { function: fn.name, args });
      throw error;
    }
  }) as (...args: Parameters<T>) => Promise<ReturnType<T>>;
}

/**
 * 错误类型守卫
 */
export const ErrorTypes = {
  isValidationError: (error: unknown): error is ValidationError => {
    return error instanceof ValidationError;
  },
  isAuthenticationError: (error: unknown): error is AuthenticationError => {
    return error instanceof AuthenticationError;
  },
  isAuthorizationError: (error: unknown): error is AuthorizationError => {
    return error instanceof AuthorizationError;
  },
  isNotFoundError: (error: unknown): error is NotFoundError => {
    return error instanceof NotFoundError;
  },
  isCredentialError: (error: unknown): error is CredentialError => {
    return error instanceof CredentialError;
  },
  isOAuthError: (error: unknown): error is OAuthError => {
    return error instanceof OAuthError;
  },
  isProviderError: (error: unknown): error is ProviderError => {
    return error instanceof ProviderError;
  },
  isDatabaseError: (error: unknown): error is DatabaseError => {
    return error instanceof DatabaseError;
  },
} as const;
