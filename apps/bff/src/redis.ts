import { Redis } from 'ioredis';

export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  // BullMQ EXIGE maxRetriesPerRequest: null en la conexión — sin esto, los
  // comandos bloqueantes que usa internamente (BRPOPLPUSH, etc.) fallan.
  return new Redis(url, { maxRetriesPerRequest: null });
}
