import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

const TTL_SECONDS = 60;
// Much longer than the replica normally lags behind the primary (milliseconds).
const RECENT_WRITE_SECONDS = 5;

@Injectable()
export class CacheService implements OnModuleDestroy {
  // Fail fast: if Redis is down a call rejects at once instead of waiting,
  // and the request is answered from the database.
  private readonly redis = new Redis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    { maxRetriesPerRequest: 1, enableOfflineQueue: false },
  ).on('error', () => {});

  /**
   * Returns the cached value, or loads it, keeps it for 60 seconds and returns it.
   * Every key carries the version number of its group, see invalidate().
   */
  async wrap<T>(group: string, key: string, load: () => Promise<T>) {
    let fullKey: string;
    try {
      const version = (await this.redis.get(`version:${group}`)) ?? '0';
      fullKey = `${group}:${version}:${key}`;
      const cached = await this.redis.get(fullKey);
      if (cached) return JSON.parse(cached) as T;
    } catch {
      return load();
    }
    const value = await load();
    await this.redis
      .set(fullKey, JSON.stringify(value), 'EX', TTL_SECONDS)
      .catch(() => {});
    return value;
  }

  /** New version number: old keys of the group are never read again and expire on their own. */
  async invalidate(group: string) {
    await this.redis.incr(`version:${group}`).catch(() => {});
  }

  /** Remembers for a few seconds that `who` changed data, so their next reads use the primary. */
  async markWrite(who: string) {
    await this.redis
      .set(`wrote:${who}`, 1, 'EX', RECENT_WRITE_SECONDS)
      .catch(() => {});
  }

  /** Also true when Redis is down: the primary is always the safe choice. */
  async wroteRecently(who: string) {
    try {
      return (await this.redis.exists(`wrote:${who}`)) === 1;
    } catch {
      return true;
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
