import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { env } from "../config/env";
import { logger } from "./logger";

interface SessionJoinPayload {
  sessionId?: string;
  userId?: string;
}

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

    socket.to(getSessionRoom(targetSession)).emit("session:end", {
      sessionId: targetSession,
      endedBy: socket.data.userId ?? "unknown"
    });
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
    });
  }
};

export const setupSocket = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      credentials: true
    }
  });

  io.on("connection", (socket) => {
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
