import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Shared Upstash Redis client, or null without credentials (local dev without
 * `docker compose up redis redis-http`). Callers fall back to process memory.
 */
function createRedis(): Redis | null {
  // Supports both the Upstash and the Vercel KV / Marketplace variable names.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

export const redis = createRedis();
