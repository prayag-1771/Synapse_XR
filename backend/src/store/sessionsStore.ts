import { randomUUID } from "node:crypto";
import { Session } from "../types";

class SessionsStore {
  private sessionsById = new Map<string, Session>();

  create(createdBy: string): Session {
    const session: Session = {
      id: randomUUID(),
      createdBy,
      status: "active",
      participants: [createdBy],
      createdAt: new Date().toISOString(),
      endedAt: null
    };

    this.sessionsById.set(session.id, session);
    return session;
  }

  findById(id: string): Session | undefined {
    return this.sessionsById.get(id);
  }

  addParticipant(sessionId: string, userId: string): Session {
    const session = this.findById(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    if (session.status === "ended") {
      throw new Error("Session already ended");
    }
    if (!session.participants.includes(userId)) {
      session.participants.push(userId);
    }
    return session;
  }

  removeParticipant(sessionId: string, userId: string): Session {
    const session = this.findById(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    if (session.status === "ended") {
      throw new Error("Session already ended");
    }

    session.participants = session.participants.filter((participantId) => participantId !== userId);
    return session;
  }

  end(sessionId: string, requestedBy: string): Session {
    const session = this.findById(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    if (session.createdBy !== requestedBy) {
      throw new Error("Only session creator can end the session");
    }
    if (session.status === "ended") {
      return session;
    }

    session.status = "ended";
    session.endedAt = new Date().toISOString();
    return session;
  }
}

export const sessionsStore = new SessionsStore();
