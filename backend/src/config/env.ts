import dotenv from "dotenv";

dotenv.config();

const requireEnv = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const env = {
  port: Number(process.env.PORT ?? 5000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  clientOrigin: requireEnv("CLIENT_ORIGIN", "http://localhost:3000"),
  jwtSecret: requireEnv("JWT_SECRET", "replace_me_for_local_dev"),
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  databaseUrl: requireEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/synapse_xr"),
  pgPoolMax: Number(process.env.PG_POOL_MAX ?? 20),
  redisUrl: requireEnv("REDIS_URL", "redis://localhost:6379"),
  redisGloveTtlSeconds: Number(process.env.REDIS_GLOVE_TTL_SECONDS ?? 120),
  allowGuestMode: (process.env.ALLOW_GUEST_MODE ?? "true").toLowerCase() === "true"
};
