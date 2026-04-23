/** 缓存条目 */
interface CacheEntry<T> {
  data: T;              // 缓存数据
  expireAt: number;     // 过期时间戳（毫秒）
  lastAccess: number;   // 最后访问时间，用于 LRU 淘汰
}

/**
 * LRU 缓存，支持 TTL 过期和最大容量淘汰
 */
export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttl: number;  // 毫秒

  /**
   * @param maxSize - 最大缓存条目数
   * @param ttlMinutes - 缓存过期时间（分钟）
   */
  constructor(maxSize: number = 100, ttlMinutes: number = 5) {
    this.maxSize = maxSize;
    this.ttl = ttlMinutes * 60 * 1000;
  }

  /**
   * 获取缓存值，过期或不存在时返回 null
   * @param key - 缓存键
   * @returns 缓存值，过期或不存在时返回 null
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查过期
    if (Date.now() > entry.expireAt) {
      this.cache.delete(key);
      return null;
    }

    // 更新最后访问时间（LRU）
    entry.lastAccess = Date.now();
    return entry.data;
  }

  /**
   * 设置缓存值，超过最大容量时淘汰最久未访问的条目
   * @param key - 缓存键
   * @param data - 缓存值
   */
  set(key: string, data: T): void {
    // LRU 淘汰：如果超过最大条目，删除最久未访问的
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestKey();
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      data,
      expireAt: Date.now() + this.ttl,
      lastAccess: Date.now(),
    });
  }

  /**
   * 使指定键的缓存失效
   * @param key - 缓存键
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 使匹配前缀模式的所有缓存失效（如 "projectId:*"）
   * @param pattern - 缓存键前缀模式，空字符串时不清除任何缓存
   */
  invalidatePattern(pattern: string): void {
    if (!pattern) return;
    // 删除匹配模式的所有缓存（如 projectId:*）
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /** 清空所有缓存 */
  clear(): void {
    this.cache.clear();
  }

  /** 查找最久未访问的缓存键，用于 LRU 淘汰 */
  private findOldestKey(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldest = key;
      }
    }

    return oldest;
  }

  /**
   * 获取缓存统计信息（用于调试）
   * @returns 包含当前大小、最大容量和 TTL 的统计对象
   */
  stats(): { size: number; maxSize: number; ttlMinutes: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMinutes: this.ttl / 60000,
    };
  }
}

// 实例化缓存
export const wikiDataCache = new LRUCache<any>(50);      // wiki.json 缓存
/** 页面内容缓存 */
export const pageContentCache = new LRUCache<string>(200);