import cors from "cors";
import express from "express";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import sessionRoutes from "./routes/sessions";
import { logger } from "./services/logger";

export const app = express();

app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true
  })
);
app.use(express.json());

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("http_request", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "synapse-xr-backend" });
});

app.use("/auth", authRoutes);
app.use("/sessions", sessionRoutes);
