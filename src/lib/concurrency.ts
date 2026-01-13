import { logError } from './errors';

/**
 * 限流器配置
 */
export interface RateLimiterOptions {
  /**
   * 时间窗口（毫秒）
   */
  windowMs: number;
  /**
   * 最大请求数
   */
  maxRequests: number;
  /**
   * 是否启用跳过成功的请求
   */
  skipSuccessfulRequests?: boolean;
  /**
   * 是否启用跳过失败的请求
   */
  skipFailedRequests?: boolean;
}

/**
 * 限流器状态
 */
interface RateLimiterState {
  count: number;
  resetTime: number;
}

/**
 * 令牌桶配置
 */
export interface TokenBucketOptions {
  /**
   * 桶容量
   */
  capacity: number;
  /**
   * 令牌生成速率（每毫秒）
   */
  refillRate: number;
}

/**
 * 熔断器状态
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED', // 正常状态
  OPEN = 'OPEN', // 熔断状态
  HALF_OPEN = 'HALF_OPEN', // 半开状态
}

/**
 * 熔断器配置
 */
export interface CircuitBreakerOptions {
  /**
   * 失败阈值
   */
  failureThreshold: number;
  /**
   * 成功阈值（用于从半开状态恢复）
   */
  successThreshold: number;
  /**
   * 超时时间（毫秒）
   */
  timeout: number;
  /**
   * 熔断器打开后的恢复时间（毫秒）
   */
  resetTimeout: number;
}

/**
 * 熔断器统计
 */
interface CircuitBreakerStats {
  failures: number;
  successes: number;
  lastFailureTime: number;
  state: CircuitBreakerState;
}

/**
 * 限流器实现
 */
export class RateLimiter {
  private state: Map<string, RateLimiterState>;
  private options: RateLimiterOptions;

  constructor(options: RateLimiterOptions) {
    this.state = new Map();
    this.options = options;
  }

  /**
   * 检查是否允许请求
   */
  async check(key: string = 'default'): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    let currentState = this.state.get(key);

    // 如果没有状态或已过期，创建新状态
    if (!currentState || now > currentState.resetTime) {
      currentState = {
        count: 0,
        resetTime: now + this.options.windowMs,
      };
      this.state.set(key, currentState);
    }

    const allowed = currentState.count < this.options.maxRequests;

    if (allowed) {
      currentState.count++;
    }

    return {
      allowed,
      remaining: Math.max(0, this.options.maxRequests - currentState.count),
      resetTime: currentState.resetTime,
    };
  }

  /**
   * 重置限流器
   */
  reset(key: string = 'default'): void {
    this.state.delete(key);
  }

  /**
   * 清理所有限流器
   */
  clear(): void {
    this.state.clear();
  }
}

/**
 * 令牌桶实现
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private options: TokenBucketOptions;

  constructor(options: TokenBucketOptions) {
    this.tokens = options.capacity;
    this.lastRefill = Date.now();
    this.options = options;
  }

  /**
   * 尝试获取令牌
   */
  async tryConsume(tokens: number = 1): Promise<boolean> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * 等待并获取令牌
   */
  async consume(tokens: number = 1): Promise<void> {
    while (!(await this.tryConsume(tokens))) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * 补充令牌
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.options.refillRate;

    this.tokens = Math.min(this.options.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * 获取当前令牌数
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * 熔断器实现
 */
export class CircuitBreaker {
  private stats: CircuitBreakerStats;
  private options: CircuitBreakerOptions;
  private nextAttemptTime: number;

  constructor(options: CircuitBreakerOptions) {
    this.stats = {
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      state: CircuitBreakerState.CLOSED,
    };
    this.options = options;
    this.nextAttemptTime = 0;
  }

  /**
   * 执行函数（带熔断保护）
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // 检查是否应该尝试恢复
    if (this.stats.state === CircuitBreakerState.OPEN && now >= this.nextAttemptTime) {
      this.stats.state = CircuitBreakerState.HALF_OPEN;
    }

    // 如果熔断器打开，拒绝请求
    if (this.stats.state === CircuitBreakerState.OPEN) {
      throw new Error('Circuit breaker is OPEN');
    }

    try {
      // 执行函数
      const result = await fn();

      // 成功，更新统计
      this.onSuccess();

      return result;
    } catch (error) {
      // 失败，更新统计
      this.onFailure();
      throw error;
    }
  }

  /**
   * 处理成功
   */
  private onSuccess(): void {
    if (this.stats.state === CircuitBreakerState.HALF_OPEN) {
      this.stats.successes++;

      // 如果达到成功阈值，关闭熔断器
      if (this.stats.successes >= this.options.successThreshold) {
        this.reset();
      }
    } else {
      this.stats.successes++;
    }
  }

  /**
   * 处理失败
   */
  private onFailure(): void {
    this.stats.failures++;
    this.stats.lastFailureTime = Date.now();

    // 如果达到失败阈值，打开熔断器
    if (this.stats.failures >= this.options.failureThreshold) {
      this.open();
    }
  }

  /**
   * 打开熔断器
   */
  private open(): void {
    this.stats.state = CircuitBreakerState.OPEN;
    this.nextAttemptTime = Date.now() + this.options.resetTimeout;
  }

  /**
   * 重置熔断器
   */
  private reset(): void {
    this.stats = {
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      state: CircuitBreakerState.CLOSED,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): CircuitBreakerState {
    return this.stats.state;
  }

  /**
   * 获取统计信息
   */
  getStats(): CircuitBreakerStats {
    return { ...this.stats };
  }
}

/**
 * 请求队列实现
 */
export class RequestQueue<T = unknown> {
  private queue: Array<{ task: () => Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }>;
  private running: number;
  private concurrency: number;

  constructor(concurrency: number = 10) {
    this.queue = [];
    this.running = 0;
    this.concurrency = concurrency;
  }

  /**
   * 添加任务到队列
   */
  async add(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  /**
   * 处理队列
   */
  private async process(): Promise<void> {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.running++;

    const { task, resolve, reject } = this.queue.shift()!;

    try {
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process();
    }
  }

  /**
   * 获取队列大小
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * 获取正在运行的任务数
   */
  getRunning(): number {
    return this.running;
  }
}

/**
 * 并发管理器
 */
export class ConcurrencyManager {
  private rateLimiters: Map<string, RateLimiter>;
  private circuitBreakers: Map<string, CircuitBreaker>;
  private tokenBuckets: Map<string, TokenBucket>;
  private requestQueues: Map<string, RequestQueue>;

  constructor() {
    this.rateLimiters = new Map();
    this.circuitBreakers = new Map();
    this.tokenBuckets = new Map();
    this.requestQueues = new Map();
  }

  /**
   * 获取或创建限流器
   */
  getRateLimiter(key: string, options: RateLimiterOptions): RateLimiter {
    if (!this.rateLimiters.has(key)) {
      this.rateLimiters.set(key, new RateLimiter(options));
    }
    return this.rateLimiters.get(key)!;
  }

  /**
   * 获取或创建熔断器
   */
  getCircuitBreaker(key: string, options: CircuitBreakerOptions): CircuitBreaker {
    if (!this.circuitBreakers.has(key)) {
      this.circuitBreakers.set(key, new CircuitBreaker(options));
    }
    return this.circuitBreakers.get(key)!;
  }

  /**
   * 获取或创建令牌桶
   */
  getTokenBucket(key: string, options: TokenBucketOptions): TokenBucket {
    if (!this.tokenBuckets.has(key)) {
      this.tokenBuckets.set(key, new TokenBucket(options));
    }
    return this.tokenBuckets.get(key)!;
  }

  /**
   * 获取或创建请求队列
   */
  getRequestQueue<T>(key: string, concurrency: number = 10): RequestQueue<T> {
    if (!this.requestQueues.has(key)) {
      this.requestQueues.set(key, new RequestQueue<any>(concurrency));
    }
    return this.requestQueues.get(key)! as RequestQueue<T>;
  }

  /**
   * 清理所有资源
   */
  cleanup(): void {
    this.rateLimiters.forEach((limiter) => limiter.clear());
    this.rateLimiters.clear();
    this.circuitBreakers.clear();
    this.tokenBuckets.clear();
    this.requestQueues.clear();
  }
}

/**
 * 全局并发管理器实例
 */
let globalConcurrencyManager: ConcurrencyManager | null = null;

/**
 * 获取全局并发管理器
 */
export function getConcurrencyManager(): ConcurrencyManager {
  if (!globalConcurrencyManager) {
    globalConcurrencyManager = new ConcurrencyManager();
  }
  return globalConcurrencyManager;
}

/**
 * 并发控制装饰器
 */
export function withConcurrencyControl<T extends (...args: unknown[]) => Promise<unknown>>(
  options: {
    rateLimiter?: { key: string; options: RateLimiterOptions };
    circuitBreaker?: { key: string; options: CircuitBreakerOptions };
    tokenBucket?: { key: string; options: TokenBucketOptions };
    requestQueue?: { key: string; concurrency: number };
  },
): (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) => void {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const manager = getConcurrencyManager();

    descriptor.value = async function (...args: Parameters<T>): Promise<ReturnType<T>> {
      // 限流检查
      if (options.rateLimiter) {
        const limiter = manager.getRateLimiter(
          options.rateLimiter.key,
          options.rateLimiter.options,
        );
        const { allowed } = await limiter.check();
        if (!allowed) {
          throw new Error('Rate limit exceeded');
        }
      }

      // 令牌桶检查
      if (options.tokenBucket) {
        const bucket = manager.getTokenBucket(
          options.tokenBucket.key,
          options.tokenBucket.options,
        );
        const acquired = await bucket.tryConsume();
        if (!acquired) {
          throw new Error('No tokens available');
        }
      }

      // 熔断器保护
      if (options.circuitBreaker) {
        const breaker = manager.getCircuitBreaker(
          options.circuitBreaker.key,
          options.circuitBreaker.options,
        );
        return breaker.execute(() => originalMethod.apply(this, args)) as Promise<ReturnType<T>>;
      }

      // 请求队列
      if (options.requestQueue) {
        const queue = manager.getRequestQueue(
          options.requestQueue.key,
          options.requestQueue.concurrency,
        );
        return queue.add(() => originalMethod.apply(this, args)) as Promise<ReturnType<T>>;
      }

      // 默认执行
      return originalMethod.apply(this, args);
    };
  };
}

/**
 * 预定义的并发控制配置
 */
export const ConcurrencyPresets = {
  api: {
    rateLimiter: {
      key: 'api',
      options: {
        windowMs: 60 * 1000, // 1 分钟
        maxRequests: 1000, // 每分钟最多 1000 个请求
      },
    },
    circuitBreaker: {
      key: 'api',
      options: {
        failureThreshold: 10,
        successThreshold: 5,
        timeout: 5000,
        resetTimeout: 60 * 1000,
      },
    },
  },
  credentials: {
    rateLimiter: {
      key: 'credentials',
      options: {
        windowMs: 60 * 1000,
        maxRequests: 100,
      },
    },
    circuitBreaker: {
      key: 'credentials',
      options: {
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 10000,
        resetTimeout: 30 * 1000,
      },
    },
  },
  oauth: {
    tokenBucket: {
      key: 'oauth',
      options: {
        capacity: 10,
        refillRate: 0.1, // 每秒 1 个令牌
      },
    },
  },
} as const;