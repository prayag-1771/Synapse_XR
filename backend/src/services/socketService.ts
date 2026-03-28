import { Server as HttpServer } from "http";
import { randomUUID } from "node:crypto";
import { Server, Socket } from "socket.io";
import { env } from "../config/env";
import {
  publishToRealtimeChannel,
  setLatestGloveState,
  subscribeToRealtimeChannel
} from "../db/redis";
import { sessionRepository } from "../repositories/sessionRepository";
import { authService } from "./authService";
import { logger } from "./logger";

const getAllowedOrigins = (): string[] =>
  Array.from(
    new Set(
      [
        "http://localhost:3000",
        `http://localhost:${env.port}`,
        env.clientOrigin
      ].filter(Boolean)
    )
  );

interface SessionJoinPayload {
  sessionId?: string;
}

interface RedisRelayEnvelope {
  originServerId: string;
  eventName: string;
  sessionId: string;
  payload: unknown;
}

interface SocketIdentity {
  userId: string;
  email: string;
  role: "worker" | "expert" | "admin";
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

const getSocketIdentity = (socket: Socket): SocketIdentity | null => {
  const userId = socket.data.userId as string | undefined;
  const email = socket.data.email as string | undefined;
  const role = socket.data.role as SocketIdentity["role"] | undefined;

  if (!userId || !email || !role) {
    return null;
  }

  return { userId, email, role };
};

const getTokenFromSocket = (socket: Socket): string | null => {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken.trim();
  }

  const authorization = socket.handshake.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return null;
};

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
  socket.on("session:join", async ({ sessionId }: SessionJoinPayload) => {
    if (!sessionId) {
      logger.warn("socket_session_join_failed", {
        socketId: socket.id,
        reason: "sessionId is required"
      });
      socket.emit("error:event", { event: "session:join", message: "sessionId is required" });
      return;
    }

    const identity = getSocketIdentity(socket);
    if (!identity) {
      logger.warn("socket_session_join_failed", {
        socketId: socket.id,
        sessionId,
        reason: "unauthenticated socket"
      });
      socket.emit("error:event", { event: "session:join", message: "Unauthorized socket connection" });
      return;
    }

    const session = await sessionRepository.findById(sessionId);
    if (!session || session.status !== "active") {
      logger.warn("socket_session_join_failed", {
        socketId: socket.id,
        sessionId,
        userId: identity.userId,
        reason: "session not found or inactive"
      });
      socket.emit("error:event", { event: "session:join", message: "Session not found or inactive" });
      return;
    }

    const isGuestUser = identity.email.endsWith("@demo");
    const isAllowedParticipant =
      isGuestUser ||
      identity.role === "admin" || session.createdBy === identity.userId || session.participants.includes(identity.userId);
    if (!isAllowedParticipant) {
      logger.warn("socket_session_join_failed", {
        socketId: socket.id,
        sessionId,
        userId: identity.userId,
        reason: "user is not authorized for session"
      });
      socket.emit("error:event", {
        event: "session:join",
        message: "User is not an authorized participant for this session"
      });
      return;
    }

    socket.data.sessionId = sessionId;
    socket.join(getSessionRoom(sessionId));
    logger.info("socket_session_joined", {
      socketId: socket.id,
      sessionId,
      userId: identity.userId
    });

    socket.to(getSessionRoom(sessionId)).emit("session:participant-joined", {
      userId: identity.userId,
      socketId: socket.id,
      sessionId
    });
  });
};

const registerSessionEnd = (socket: Socket): void => {
  socket.on("session:end", ({ sessionId }: { sessionId?: string }) => {
    const identity = getSocketIdentity(socket);
    if (!identity) {
      socket.emit("error:event", { event: "session:end", message: "Unauthorized socket connection" });
      return;
    }

    const targetSession = sessionId ?? socket.data.sessionId;
    if (!targetSession) {
      logger.warn("socket_session_end_failed", {
        socketId: socket.id,
        reason: "sessionId is required"
      });
      socket.emit("error:event", { event: "session:end", message: "sessionId is required" });
      return;
    }

    if (socket.data.sessionId && socket.data.sessionId !== targetSession) {
      logger.warn("socket_session_end_failed", {
        socketId: socket.id,
        sessionId: targetSession,
        userId: identity.userId,
        reason: "session mismatch"
      });
      socket.emit("error:event", {
        event: "session:end",
        message: "sessionId must match joined session"
      });
      return;
    }

    logger.info("socket_session_deleted", {
      socketId: socket.id,
      sessionId: targetSession,
      endedBy: identity.userId
    });

    const payload = {
      sessionId: targetSession,
      endedBy: identity.userId
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
      const identity = getSocketIdentity(socket);
      if (!identity) {
        socket.emit("error:event", { event: eventName, message: "Unauthorized socket connection" });
        return;
      }

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

      if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
        logger.warn("socket_relay_failed", {
          socketId: socket.id,
          eventName,
          sessionId,
          userId: identity.userId,
          reason: "session mismatch"
        });
        socket.emit("error:event", {
          event: eventName,
          message: "sessionId must match joined session"
        });
        return;
      }

      if (eventName !== "webrtc:ice") {
        logger.info("socket_event_relayed", {
          socketId: socket.id,
          eventName,
          sessionId,
          userId: identity.userId
        });
      }

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
      origin: getAllowedOrigins(),
      credentials: true
    }
  });

  io.use((socket, next) => {
    // Guest / demo mode: allow unauthenticated connections for development
    const isGuestMode = socket.handshake.auth?.mode === "demo" || socket.handshake.query?.mode === "demo";

    if (isGuestMode && env.allowGuestMode) {
      const guestId = randomUUID();
      socket.data.userId = guestId;
      socket.data.email = `guest-${guestId.slice(0, 8)}@demo`;
      socket.data.role = "worker";
      logger.info("socket_guest_connected", {
        socketId: socket.id,
        guestId
      });
      next();
      return;
    }

    const token = getTokenFromSocket(socket);
    if (!token) {
      logger.warn("socket_auth_failed", {
        socketId: socket.id,
        reason: "missing token"
      });
      next(new Error("Unauthorized socket connection"));
      return;
    }

    try {
      const payload = authService.verifyToken(token);
      socket.data.userId = payload.userId;
      socket.data.email = payload.email;
      socket.data.role = payload.role;
      next();
    } catch {
      logger.warn("socket_auth_failed", {
        socketId: socket.id,
        reason: "invalid token"
      });
      next(new Error("Unauthorized socket connection"));
    }
  });

  io.on("connection", (socket) => {
    socket.data.serverId = serverId;
    logger.info("socket_connected", {
      socketId: socket.id,
      userId: socket.data.userId
    });

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
