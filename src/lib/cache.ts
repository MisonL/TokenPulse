/**
 * 缓存项
 */
interface CacheItem<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
}

/**
 * 缓存接口
 */
export interface SimpleCache {
  /**
   * 获取缓存值
   */
  get<T>(key: string): T | undefined;
  /**
   * 设置缓存值
   */
  set(key: string, value: unknown, ttl?: number): void;
  /**
   * 删除缓存值
   */
  delete(key: string): boolean;
  /**
   * 清空所有缓存
   */
  clear(): void;
  /**
   * 检查缓存是否存在
   */
  has(key: string): boolean;
}

/**
 * 缓存配置
 */
export interface CacheOptions {
  /**
   * 默认过期时间（毫秒）
   */
  ttl?: number;
  /**
   * 最大缓存项数量
   */
  maxSize?: number;
  /**
   * 是否启用统计
   */
  enableStats?: boolean;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

/**
 * 内存缓存实现
 */
export class MemoryCache<T = unknown> implements SimpleCache {
  private cache: Map<string, CacheItem<T>>;
  private defaultTtl: number;
  private maxSize: number;
  private enableStats: boolean;
  private stats: { hits: number; misses: number };
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(options: CacheOptions = {}) {
    this.cache = new Map();
    this.defaultTtl = options.ttl || 5 * 60 * 1000; // 默认 5 分钟
    this.maxSize = options.maxSize || 1000; // 默认最多 1000 项
    this.enableStats = options.enableStats ?? true;
    this.stats = { hits: 0, misses: 0 };
    this.cleanupInterval = null;

    // 定期清理过期缓存
    this.startCleanup();
  }

  /**
   * 设置缓存
   */
  set(key: string, value: T, ttl?: number): void {
    const expiresAt = Date.now() + (ttl ?? this.defaultTtl);

    // 如果缓存已满，删除最旧的项
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
      hits: 0,
    });
  }

  /**
   * 获取缓存
   */
  get<U = T>(key: string): U | undefined {
    const item = this.cache.get(key) as unknown as CacheItem<U>;

    if (!item) {
      if (this.enableStats) {
        this.stats.misses++;
      }
      return undefined;
    }

    // 检查是否过期
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      if (this.enableStats) {
        this.stats.misses++;
      }
      return undefined;
    }

    // 更新命中统计
    if (this.enableStats) {
      this.stats.hits++;
    }
    item.hits++;

    return item.value;
  }

  /**
   * 检查缓存是否存在
   */
  has(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) return false;

    // 检查是否过期
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    if (this.enableStats) {
      this.stats = { hits: 0, misses: 0 };
    }
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      hitRate,
    };
  }

  /**
   * 清理过期缓存
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[Cache] Cleaned up ${cleaned} expired items`);
    }
  }

  /**
   * 驱逐最旧的缓存项
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.createdAt < oldestTime) {
        oldestTime = item.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 启动定期清理
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // 每分钟清理一次
  }

  /**
   * 停止定期清理
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 销毁缓存
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
  }
}

/**
 * 全局缓存实例
 */
let globalCache: MemoryCache | null = null;

/**
 * 获取全局缓存实例
 */
export function getGlobalCache<T = unknown>(
  options?: CacheOptions,
): MemoryCache<T> {
  if (!globalCache) {
    globalCache = new MemoryCache<T>(options);
  }
  return globalCache as MemoryCache<T>;
}

/**
 * 缓存装饰器 - 用于缓存函数结果
 */
export function cached<T extends (...args: unknown[]) => Promise<unknown>>(
  ttl: number = 5 * 60 * 1000,
  keyGenerator?: (...args: Parameters<T>) => string,
): (
  target: unknown,
  propertyKey: string,
  descriptor: PropertyDescriptor,
) => void {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const cache = getGlobalCache();

    descriptor.value = async function (
      ...args: Parameters<T>
    ): Promise<ReturnType<T>> {
      // 生成缓存键
      const cacheKey = keyGenerator
        ? keyGenerator(...args)
        : `${propertyKey}:${JSON.stringify(args)}`;

      // 尝试从缓存获取
      const cachedValue = cache.get(cacheKey);
      if (cachedValue !== undefined) {
        return cachedValue as ReturnType<T>;
      }

      // 执行原方法
      const result = await originalMethod.apply(this, args);

      // 缓存结果
      cache.set(cacheKey, result, ttl);

      return result;
    };
  };
}

/**
 * 缓存键生成器
 */
export const CacheKeys = {
  credentials: {
    status: () => "credentials:status",
    all: () => "credentials:all",
    byProvider: (provider: string) => `credentials:${provider}`,
  },
  settings: {
    all: () => "settings:all",
    byKey: (key: string) => `settings:${key}`,
  },
  stats: {
    current: () => "stats:current",
    history: (minutes: number) => `stats:history:${minutes}`,
  },
  logs: {
    recent: (limit: number) => `logs:recent:${limit}`,
    page: (page: number, pageSize: number) => `logs:page:${page}:${pageSize}`,
  },
  providers: {
    token: (provider: string) => `providers:${provider}:token`,
    status: (provider: string) => `providers:${provider}:status`,
  },
} as const;

/**
 * 缓存失效策略
 */
export class CacheInvalidator {
  private cache: MemoryCache;

  constructor(cache: MemoryCache) {
    this.cache = cache;
  }

  /**
   * 使凭据相关缓存失效
   */
  invalidateCredentials(): void {
    this.cache.delete(CacheKeys.credentials.status());
    this.cache.delete(CacheKeys.credentials.all());
  }

  /**
   * 使特定提供商的缓存失效
   */
  invalidateProvider(provider: string): void {
    this.cache.delete(CacheKeys.credentials.byProvider(provider));
    this.cache.delete(CacheKeys.providers.token(provider));
    this.cache.delete(CacheKeys.providers.status(provider));
  }

  /**
   * 使设置缓存失效
   */
  invalidateSettings(): void {
    this.cache.delete(CacheKeys.settings.all());
  }

  /**
   * 使统计缓存失效
   */
  invalidateStats(): void {
    this.cache.delete(CacheKeys.stats.current());
  }

  /**
   * 使日志缓存失效
   */
  invalidateLogs(): void {
    // 清除所有日志缓存
    const allKeys = Array.from(
      (this.cache as unknown as any).cache.keys(),
    ) as string[];
    allKeys.forEach((key) => {
      if (key.startsWith("logs:")) {
        this.cache.delete(key);
      }
    });
  }

  /**
   * 使所有缓存失效
   */
  invalidateAll(): void {
    this.cache.clear();
  }
}

/**
 * 获取缓存失效器实例
 */
export function getCacheInvalidator(): CacheInvalidator {
  const cache = getGlobalCache();
  return new CacheInvalidator(cache);
}

/**
 * 获取全局缓存实例
 */
export function getCache(): SimpleCache {
  return getGlobalCache();
}
