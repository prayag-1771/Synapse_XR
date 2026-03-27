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
  port: Number(process.env.PORT ?? 3001),
  clientOrigin: requireEnv("CLIENT_ORIGIN", "http://localhost:3000"),
  jwtSecret: requireEnv("JWT_SECRET", "replace_me_for_local_dev"),
  geminiApiKey: process.env.GEMINI_API_KEY ?? ""
};
