import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { env } from "../config/env";
import {
  publishToRealtimeChannel,
  setLatestGloveState,
  subscribeToRealtimeChannel
} from "../db/redis";
import { logger } from "./logger";

interface SessionJoinPayload {
  sessionId?: string;
  userId?: string;
}

interface RedisRelayEnvelope {
  originServerId: string;
  eventName: string;
  sessionId: string;
  payload: unknown;
}

const REDIS_SOCKET_CHANNEL = "synapse:socket:events";

const relayedEvents = [
  "hand:data",
  "gesture:detected",
  "voice:transcript",
  "annotation:update",
  "ai:detection",
  "webrtc:offer",
  "webrtc:answer",
  "webrtc:ice"
] as const;

const getSessionRoom = (sessionId: string): string => `session:${sessionId}`;

const publishRelayEvent = async (
  originServerId: string,
  eventName: string,
  sessionId: string,
  payload: unknown
): Promise<void> => {
  const envelope: RedisRelayEnvelope = {
    originServerId,
    eventName,
    sessionId,
    payload
  };

  await publishToRealtimeChannel(REDIS_SOCKET_CHANNEL, JSON.stringify(envelope));
};

const registerSessionJoin = (socket: Socket): void => {
  socket.on("session:join", ({ sessionId, userId }: SessionJoinPayload) => {
    if (!sessionId) {
      logger.warn("socket_session_join_failed", {
        socketId: socket.id,
        reason: "sessionId is required"
      });
      socket.emit("error:event", { event: "session:join", message: "sessionId is required" });
      return;
    }

    socket.data.sessionId = sessionId;
    socket.data.userId = userId ?? "unknown";
    socket.join(getSessionRoom(sessionId));
    logger.info("socket_session_joined", {
      socketId: socket.id,
      sessionId,
      userId: socket.data.userId
    });

    socket.to(getSessionRoom(sessionId)).emit("session:participant-joined", {
      userId: socket.data.userId,
      socketId: socket.id,
      sessionId
    });
  });
};

const registerSessionEnd = (socket: Socket): void => {
  socket.on("session:end", ({ sessionId }: { sessionId?: string }) => {
    const targetSession = sessionId ?? socket.data.sessionId;
    if (!targetSession) {
      logger.warn("socket_session_end_failed", {
        socketId: socket.id,
        reason: "sessionId is required"
      });
      socket.emit("error:event", { event: "session:end", message: "sessionId is required" });
      return;
    }

    logger.info("socket_session_deleted", {
      socketId: socket.id,
      sessionId: targetSession,
      endedBy: socket.data.userId ?? "unknown"
    });

    const payload = {
      sessionId: targetSession,
      endedBy: socket.data.userId ?? "unknown"
    };

    socket.to(getSessionRoom(targetSession)).emit("session:end", payload);
    void publishRelayEvent(socket.data.serverId as string, "session:end", targetSession, payload).catch(
      (error) => {
        logger.error("socket_relay_publish_failed", {
          eventName: "session:end",
          sessionId: targetSession,
          error: error instanceof Error ? error.message : "Unknown publish error"
        });
      }
    );
  });
};

const registerRelayEvents = (socket: Socket): void => {
  for (const eventName of relayedEvents) {
    socket.on(eventName, (payload: unknown) => {
      const sessionId = (payload as { sessionId?: string })?.sessionId ?? socket.data.sessionId;
      if (!sessionId) {
        logger.warn("socket_relay_failed", {
          socketId: socket.id,
          eventName,
          reason: "sessionId is required"
        });
        socket.emit("error:event", { event: eventName, message: "sessionId is required" });
        return;
      }

      logger.info("socket_event_relayed", {
        socketId: socket.id,
        eventName,
        sessionId
      });

      socket.to(getSessionRoom(sessionId)).emit(eventName, payload);

      if (eventName === "hand:data") {
        void setLatestGloveState(sessionId, payload).catch((error) => {
          logger.error("redis_glove_state_write_failed", {
            sessionId,
            error: error instanceof Error ? error.message : "Unknown Redis write error"
          });
        });
      }

      void publishRelayEvent(socket.data.serverId as string, eventName, sessionId, payload).catch((error) => {
        logger.error("socket_relay_publish_failed", {
          eventName,
          sessionId,
          error: error instanceof Error ? error.message : "Unknown publish error"
        });
      });
    });
  }
};

export const setupSocket = (httpServer: HttpServer, serverId: string): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
    socket.data.serverId = serverId;
    logger.info("socket_connected", { socketId: socket.id });

    registerSessionJoin(socket);
    registerSessionEnd(socket);
    registerRelayEvents(socket);

    socket.on("disconnect", () => {
      const sessionId = socket.data.sessionId as string | undefined;
      if (!sessionId) {
        logger.info("socket_disconnected", {
          socketId: socket.id,
          userId: socket.data.userId ?? "unknown"
        });
        return;
      }

      logger.info("socket_session_left", {
        socketId: socket.id,
        sessionId,
        userId: socket.data.userId ?? "unknown"
      });

      socket.to(getSessionRoom(sessionId)).emit("session:participant-left", {
        userId: socket.data.userId ?? "unknown",
        socketId: socket.id,
        sessionId
      });
    });
  });

  return io;
};

export const attachSocketRedisBridge = async (io: Server, serverId: string): Promise<void> => {
  await subscribeToRealtimeChannel(REDIS_SOCKET_CHANNEL, (message) => {
    try {
      const event = JSON.parse(message) as RedisRelayEnvelope;

      if (event.originServerId === serverId) {
        return;
      }

      io.to(getSessionRoom(event.sessionId)).emit(event.eventName, event.payload);
    } catch (error) {
      logger.error("socket_relay_consume_failed", {
        error: error instanceof Error ? error.message : "Unknown consume error"
      });
    }
  });

  logger.info("socket_redis_bridge_ready", {
    channel: REDIS_SOCKET_CHANNEL,
    serverId
  });
};
