import { createServer } from "http";
import { randomUUID } from "node:crypto";
import { app } from "./app";
import { pingPostgres, shutdownPostgres } from "./db/postgres";
import { initRedis, shutdownRedis } from "./db/redis";
import { env } from "./config/env";
import { logger } from "./services/logger";
import { attachSocketRedisBridge, setupSocket } from "./services/socketService";

const httpServer = createServer(app);
const serverId = randomUUID();
const io = setupSocket(httpServer, serverId);
let isShuttingDown = false;
const MAX_PORT_BIND_RETRIES = 5;
let portBindRetryCount = 0;

const startListening = (): void => {
  httpServer.listen(env.port, () => {
    portBindRetryCount = 0;
    logger.info("server_started", {
      port: env.port,
      clientOrigin: env.clientOrigin
    });
  });
};

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info("server_shutdown_started", { signal });

  try {
    await new Promise<void>((resolve, reject) => {
      io.close((ioCloseError?: Error) => {
        if (ioCloseError) {
          reject(ioCloseError);
          return;
        }
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      if (!httpServer.listening) {
        resolve();
        return;
      }

      httpServer.close((httpCloseError?: Error) => {
        if (httpCloseError) {
          reject(httpCloseError);
          return;
        }
        resolve();
      });
    });

    await Promise.allSettled([shutdownRedis(), shutdownPostgres()]);

    logger.info("server_shutdown_completed", { signal });
    process.exit(0);
  } catch (error) {
    logger.error("server_shutdown_failed", {
      signal,
      error: error instanceof Error ? error.message : "Unknown shutdown error"
    });
    process.exit(1);
  }
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", { error: error.message });
  void shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", {
    reason: reason instanceof Error ? reason.message : String(reason)
  });
  void shutdown("unhandledRejection");
});

httpServer.on("error", (error: NodeJS.ErrnoException) => {
  if (isShuttingDown) {
    return;
  }

  if (error.code === "EADDRINUSE") {
    portBindRetryCount += 1;

    if (portBindRetryCount <= MAX_PORT_BIND_RETRIES) {
      const retryDelayMs = 250 * portBindRetryCount;
      logger.warn("server_port_in_use_retry", {
        port: env.port,
        attempt: portBindRetryCount,
        maxAttempts: MAX_PORT_BIND_RETRIES,
        retryInMs: retryDelayMs
      });

      setTimeout(() => {
        if (!isShuttingDown) {
          startListening();
        }
      }, retryDelayMs);
      return;
    }

    logger.error("server_port_in_use", {
      port: env.port,
      message: "Port already in use. Stop existing process or use a different PORT."
    });
    process.exit(1);
    return;
  }

  logger.error("server_http_error", {
    code: error.code,
    message: error.message
  });
  process.exit(1);
});

const bootstrap = async (): Promise<void> => {
  try {
    await pingPostgres();
    logger.info("postgres_connected");

    await initRedis();
    logger.info("redis_connected", {
      redisUrl: env.redisUrl
    });

    await attachSocketRedisBridge(io, serverId);
    startListening();
  } catch (error) {
    const message =
      error instanceof AggregateError
        ? error.errors.map((entry) => (entry instanceof Error ? entry.message : String(entry))).join("; ")
        : error instanceof Error
          ? error.message || error.name
          : String(error);

    logger.error("server_bootstrap_failed", {
      error: message || "Unknown bootstrap error"
    });
    process.exit(1);
  }
};

void bootstrap();
