import cors from "cors";
import express from "express";
import path from "path";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import adminRoutes from "./routes/admin";
import sessionRoutes from "./routes/sessions";
import { logger } from "./services/logger";

export const app = express();

const allowedOrigins = Array.from(
  new Set(
    [
      "http://localhost:3000",
      `http://localhost:${env.port}`,
      env.clientOrigin
    ].filter(Boolean)
  )
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
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
app.use("/admin", adminRoutes);

// Serve the demo page at /demo
app.use("/demo", express.static(path.resolve(__dirname, "../../demo")));

