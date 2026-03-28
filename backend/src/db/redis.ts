import { createClient } from "redis";
import { env } from "../config/env";

const publisher = createClient({ url: env.redisUrl });
const subscriber = publisher.duplicate();
let redisInitialized = false;

export const initRedis = async (): Promise<void> => {
  if (redisInitialized) {
    return;
  }

  await publisher.connect();
  await subscriber.connect();
  redisInitialized = true;
};

export const shutdownRedis = async (): Promise<void> => {
  if (!redisInitialized) {
    return;
  }

  await Promise.allSettled([publisher.quit(), subscriber.quit()]);
  redisInitialized = false;
};

export const publishToRealtimeChannel = async (channel: string, message: string): Promise<void> => {
  await publisher.publish(channel, message);
};

export const subscribeToRealtimeChannel = async (
  channel: string,
  handler: (message: string) => void
): Promise<void> => {
  await subscriber.subscribe(channel, handler);
};

export const setLatestGloveState = async (sessionId: string, payload: unknown): Promise<void> => {
  const key = `glove:latest:${sessionId}`;
  await publisher.set(key, JSON.stringify(payload), {
    EX: env.redisGloveTtlSeconds
  });
};

export const getLatestGloveState = async <T>(sessionId: string): Promise<T | null> => {
  const key = `glove:latest:${sessionId}`;
  const value = await publisher.get(key);
  if (!value) {
    return null;
  }

  return JSON.parse(value) as T;
};
