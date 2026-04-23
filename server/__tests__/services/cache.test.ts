/**
 * 缓存服务测试
 * 覆盖 LRU 缓存的存取、淘汰、过期、统计逻辑
 */
// 必须在所有 Mock 之前导入 vi
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// 导入待测模块
import { LRUCache, wikiDataCache, pageContentCache } from '../../src/services/cache.js'

describe('LRUCache', () => {
  let cache: LRUCache<string>

  beforeEach(() => {
    cache = new LRUCache<string>(3, 1) // maxSize: 3, ttl: 1 分钟
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('set / get', () => {
    it('should cache value and return it within TTL', () => {
      cache.set('key1', 'value1')

      const result = cache.get('key1')

      expect(result).toBe('value1')
    })

    it('should return null for non-existent key', () => {
      const result = cache.get('nonexistent')

      expect(result).toBeNull()
    })

    it('should return null after TTL expires', () => {
      cache.set('key1', 'value1')

      // 将时间推进到超过 TTL（1 分钟 = 60000ms）
      vi.advanceTimersByTime(60001)

      const result = cache.get('key1')

      expect(result).toBeNull()
    })

    it('should return value just before TTL expires', () => {
      cache.set('key1', 'value1')

      // 将时间推进到 TTL 即将过期之前
      vi.advanceTimersByTime(59999)

      const result = cache.get('key1')

      expect(result).toBe('value1')
    })

    it('should remove expired entry when accessed', () => {
      cache.set('key1', 'value1')

      // 将时间推进到超过 TTL
      vi.advanceTimersByTime(60001)

      // 访问时应清理过期条目
      cache.get('key1')

      const stats = cache.stats()
      expect(stats.size).toBe(0)
    })

    it('should update cached value with same key', () => {
      cache.set('key1', 'value1')
      cache.set('key1', 'value2')

      const result = cache.get('key1')

      expect(result).toBe('value2')
    })

    it('should work with different data types', () => {
      const objectCache = new LRUCache<{ id: number; name: string }>(10, 5)

      objectCache.set('item', { id: 1, name: 'test' })

      const result = objectCache.get('item')
      expect(result).toEqual({ id: 1, name: 'test' })
    })
  })

  describe('invalidate', () => {
    it('should remove specific cached entry', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.invalidate('key1')

      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key2')).toBe('value2')
    })

    it('should do nothing when key does not exist', () => {
      cache.set('key1', 'value1')

      // 不应抛出异常
      cache.invalidate('nonexistent')

      expect(cache.get('key1')).toBe('value1')
    })

    it('should decrease cache size', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      expect(cache.stats().size).toBe(2)

      cache.invalidate('key1')

      expect(cache.stats().size).toBe(1)
    })
  })

  describe('invalidatePattern', () => {
    it('should delete all entries matching prefix pattern', () => {
      cache.set('project:1:data', 'data1')
      cache.set('project:1:meta', 'meta1')
      cache.set('project:2:data', 'data2')
      cache.set('other:key', 'other')

      cache.invalidatePattern('project:1:')

      expect(cache.get('project:1:data')).toBeNull()
      expect(cache.get('project:1:meta')).toBeNull()
      expect(cache.get('project:2:data')).toBe('data2')
      expect(cache.get('other:key')).toBe('other')
    })

    it('should handle pattern with no matches', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.invalidatePattern('nonexistent:')

      expect(cache.stats().size).toBe(2)
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBe('value2')
    })

    it('should delete all entries when all match pattern', () => {
      cache.set('cache:item1', 'value1')
      cache.set('cache:item2', 'value2')
      cache.set('cache:item3', 'value3')

      cache.invalidatePattern('cache:')

      expect(cache.stats().size).toBe(0)
    })

    it('应能匹配前缀失效多个缓存条目', () => {
      cache.set('/path/to/wiki:v1', 'wiki1')
      cache.set('/path/to/wiki:v1:page1.md', 'page1')
      cache.set('/path/to/wiki:v1:page2.md', 'page2')
      cache.set('/other/wiki:v2', 'wiki2')

      cache.invalidatePattern('/path/to/wiki:')

      expect(cache.get('/path/to/wiki:v1')).toBeNull()
      expect(cache.get('/path/to/wiki:v1:page1.md')).toBeNull()
      expect(cache.get('/path/to/wiki:v1:page2.md')).toBeNull()
      expect(cache.get('/other/wiki:v2')).toBe('wiki2')
    })

    it('不应影响其他前缀的缓存条目', () => {
      cache.set('/project-a/wiki:v1:page.md', 'a-page')
      cache.set('/project-b/wiki:v1:page.md', 'b-page')
      cache.set('/project-c/wiki:v1:page.md', 'c-page')

      cache.invalidatePattern('/project-a/wiki:')

      expect(cache.get('/project-a/wiki:v1:page.md')).toBeNull()
      expect(cache.get('/project-b/wiki:v1:page.md')).toBe('b-page')
      expect(cache.get('/project-c/wiki:v1:page.md')).toBe('c-page')
    })

    it('空 pattern 不清除任何缓存', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.invalidatePattern('')

      expect(cache.stats().size).toBe(2)
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBe('value2')
    })
  })

  describe('clear', () => {
    it('should remove all cached entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      cache.clear()

      expect(cache.stats().size).toBe(0)
      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key2')).toBeNull()
      expect(cache.get('key3')).toBeNull()
    })

    it('should work on empty cache', () => {
      // 不应抛出异常
      cache.clear()

      expect(cache.stats().size).toBe(0)
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when capacity exceeded', () => {
      cache.set('key1', 'value1')
      vi.advanceTimersByTime(10) // key1 拥有最老的访问时间

      cache.set('key2', 'value2')
      vi.advanceTimersByTime(10)

      cache.set('key3', 'value3')
      vi.advanceTimersByTime(10)

      // 缓存已满（maxSize: 3），下次 set 应驱逐 key1（最老）
      cache.set('key4', 'value4')

      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
      expect(cache.stats().size).toBe(3)
    })

    it('should update access time on get and affect eviction order', () => {
      cache.set('key1', 'value1')
      vi.advanceTimersByTime(10)

      cache.set('key2', 'value2')
      vi.advanceTimersByTime(10)

      cache.set('key3', 'value3')
      vi.advanceTimersByTime(10)

      // 访问 key1 更新其 lastAccess 时间
      cache.get('key1')
      vi.advanceTimersByTime(10)

      // 现在 key2 是最老的（key1 刚被访问过）
      // 添加新条目，key2 应被驱逐
      cache.set('key4', 'value4')

      expect(cache.get('key1')).toBe('value1') // 未被驱逐
      expect(cache.get('key2')).toBeNull() // 已被驱逐
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('should evict only one entry when adding to full cache', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      cache.set('key4', 'value4')

      expect(cache.stats().size).toBe(3)
    })

    it('should handle capacity of 1', () => {
      const smallCache = new LRUCache<string>(1, 1)

      smallCache.set('key1', 'value1')
      expect(smallCache.get('key1')).toBe('value1')

      smallCache.set('key2', 'value2')
      expect(smallCache.get('key1')).toBeNull()
      expect(smallCache.get('key2')).toBe('value2')
    })
  })

  describe('update access time', () => {
    it('should update lastAccess time when entry is accessed via get', () => {
      // 设置具有不同访问时间的条目
      cache.set('key1', 'value1')
      vi.advanceTimersByTime(1000)
      cache.set('key2', 'value2')
      vi.advanceTimersByTime(1000)
      cache.set('key3', 'value3')

      // key1 最老 (t=0)，key2 (t=1000)，key3 (t=2000)
      expect(cache.stats().size).toBe(3)

      // 获取 key1 更新其 lastAccess
      const result = cache.get('key1')
      expect(result).toBe('value1')

      // get 之后，key1 的 lastAccess 应为 t=2000（当前时间）
      // 现在 key2 是最老的 (t=1000)
      vi.advanceTimersByTime(1000)
      cache.set('key4', 'value4')

      // key2 应被驱逐，而非 key1
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBeNull()
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('should not update access time for expired entries', () => {
      cache.set('key1', 'value1')

      // 使条目过期
      vi.advanceTimersByTime(60001)

      const result = cache.get('key1')

      expect(result).toBeNull()
      expect(cache.stats().size).toBe(0)
    })
  })

  describe('stats', () => {
    it('should return correct statistics', () => {
      const ttlCache = new LRUCache<string>(100, 10)

      const stats = ttlCache.stats()

      expect(stats).toEqual({
        size: 0,
        maxSize: 100,
        ttlMinutes: 10,
      })
    })

    it('should track size correctly', () => {
      cache.set('key1', 'value1')
      expect(cache.stats().size).toBe(1)

      cache.set('key2', 'value2')
      expect(cache.stats().size).toBe(2)

      cache.invalidate('key1')
      expect(cache.stats().size).toBe(1)

      cache.clear()
      expect(cache.stats().size).toBe(0)
    })

    it('should not decrease size when overwriting existing key', () => {
      cache.set('key1', 'value1')
      expect(cache.stats().size).toBe(1)

      cache.set('key1', 'value2')
      expect(cache.stats().size).toBe(1)
    })

    it('should return correct maxSize', () => {
      const customCache = new LRUCache<number>(50, 5)

      expect(customCache.stats().maxSize).toBe(50)
    })

    it('should return correct ttlMinutes', () => {
      const customCache = new LRUCache<number>(100, 30)

      expect(customCache.stats().ttlMinutes).toBe(30)
    })
  })

  describe('default parameters', () => {
    it('should use default maxSize of 100 when not specified', () => {
      const defaultCache = new LRUCache<string>()

      expect(defaultCache.stats().maxSize).toBe(100)
    })

    it('should use default TTL of 5 minutes when not specified', () => {
      const defaultCache = new LRUCache<string>()

      expect(defaultCache.stats().ttlMinutes).toBe(5)
    })
  })

  describe('edge cases', () => {
    it('should handle null-like values correctly', () => {
      cache.set('null-string', 'null')

      expect(cache.get('null-string')).toBe('null')
    })

    it('should handle empty string as key', () => {
      cache.set('', 'empty-key-value')

      expect(cache.get('')).toBe('empty-key-value')
    })

    it('should handle empty string as value', () => {
      cache.set('key', '')

      expect(cache.get('key')).toBe('')
    })

    it('should handle special characters in key', () => {
      cache.set('key:with:special:chars!', 'value')

      expect(cache.get('key:with:special:chars!')).toBe('value')
    })
  })
})

describe('cache instances', () => {
  describe('wikiDataCache', () => {
    it('should be a LRUCache instance', () => {
      expect(wikiDataCache).toBeInstanceOf(LRUCache)
    })

    it('should have maxSize of 50', () => {
      expect(wikiDataCache.stats().maxSize).toBe(50)
    })

    it('should have TTL of 5 minutes', () => {
      expect(wikiDataCache.stats().ttlMinutes).toBe(5)
    })
  })

  describe('pageContentCache', () => {
    it('should be a LRUCache instance', () => {
      expect(pageContentCache).toBeInstanceOf(LRUCache)
    })

    it('should have maxSize of 200', () => {
      expect(pageContentCache.stats().maxSize).toBe(200)
    })

    it('should have TTL of 5 minutes', () => {
      expect(pageContentCache.stats().ttlMinutes).toBe(5)
    })
  })
})