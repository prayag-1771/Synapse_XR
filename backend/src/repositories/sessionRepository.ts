import { randomUUID } from "node:crypto";
import { pgQuery, withPgTransaction } from "../db/postgres";
import { Session, UserRole } from "../types";

interface SessionRow {
  id: string;
  created_by: string;
  status: "active" | "ended";
  created_at: string;
  ended_at: string | null;
  participants: string[];
}

const mapSessionRow = (row: SessionRow): Session => {
  return {
    id: row.id,
    createdBy: row.created_by,
    status: row.status,
    participants: row.participants ?? [],
    createdAt: row.created_at,
    endedAt: row.ended_at
  };
};

const findById = async (sessionId: string): Promise<Session | null> => {
  const { rows } = await pgQuery<SessionRow>(
    `
    SELECT
      s.id,
      s.created_by,
      s.status,
      s.created_at,
      s.ended_at,
      COALESCE(
        ARRAY_AGG(sp.user_id) FILTER (WHERE sp.user_id IS NOT NULL),
        ARRAY[]::uuid[]
      )::text[] AS participants
    FROM sessions s
    LEFT JOIN session_participants sp ON sp.session_id = s.id
    WHERE s.id = $1
    GROUP BY s.id
    `,
    [sessionId]
  );

  if (rows.length === 0) {
    return null;
  }

  return mapSessionRow(rows[0]);
};

const create = async (createdBy: string, creatorRole: UserRole): Promise<Session> => {
  const sessionId = randomUUID();

  await withPgTransaction(async (client) => {
    await client.query(
      `
      INSERT INTO sessions (id, created_by, status)
      VALUES ($1, $2, 'active')
      `,
      [sessionId, createdBy]
    );

    await client.query(
      `
      INSERT INTO session_participants (session_id, user_id)
      VALUES ($1, $2)
      `,
      [sessionId, createdBy]
    );
  });

  const session = await findById(sessionId);
  if (!session) {
    throw new Error("Session creation failed");
  }

  return session;
};

const listOpenSessions = async (): Promise<Session[]> => {
  const { rows } = await pgQuery<SessionRow>(
    `
    SELECT
      s.id,
      s.created_by,
      s.status,
      s.created_at,
      s.ended_at,
      COALESCE(
        ARRAY_AGG(sp.user_id) FILTER (WHERE sp.user_id IS NOT NULL),
        ARRAY[]::uuid[]
      )::text[] AS participants
    FROM sessions s
    INNER JOIN users creator ON creator.id = s.created_by
    LEFT JOIN session_participants sp ON sp.session_id = s.id
    LEFT JOIN users participant_users ON participant_users.id = sp.user_id
    WHERE s.status = 'active'
      AND creator.role = 'worker'
    GROUP BY s.id
    HAVING COUNT(*) FILTER (WHERE participant_users.role IN ('expert', 'admin')) = 0
    ORDER BY s.created_at ASC
    `
  );

  return rows.map(mapSessionRow);
};

const addParticipant = async (sessionId: string, userId: string): Promise<Session> => {
  const session = await findById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.status === "ended") {
    throw new Error("Session already ended");
  }

  await pgQuery(
    `
    INSERT INTO session_participants (session_id, user_id)
    VALUES ($1, $2)
    ON CONFLICT (session_id, user_id) DO NOTHING
    `,
    [sessionId, userId]
  );

  const updatedSession = await findById(sessionId);
  if (!updatedSession) {
    throw new Error("Session not found");
  }

  return updatedSession;
};

const removeParticipant = async (sessionId: string, userId: string): Promise<Session> => {
  const session = await findById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.status === "ended") {
    throw new Error("Session already ended");
  }

  await pgQuery(
    `
    DELETE FROM session_participants
    WHERE session_id = $1 AND user_id = $2
    `,
    [sessionId, userId]
  );

  const updatedSession = await findById(sessionId);
  if (!updatedSession) {
    throw new Error("Session not found");
  }

  return updatedSession;
};

const end = async (sessionId: string, requestedBy: string): Promise<Session> => {
  const session = await findById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }
  if (session.createdBy !== requestedBy) {
    throw new Error("Only session creator can end the session");
  }

  await pgQuery(
    `
    UPDATE sessions
    SET status = 'ended', ended_at = NOW()
    WHERE id = $1
    `,
    [sessionId]
  );

  const updatedSession = await findById(sessionId);
  if (!updatedSession) {
    throw new Error("Session not found");
  }

  return updatedSession;
};

const forceEnd = async (sessionId: string): Promise<Session> => {
  const session = await findById(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  await pgQuery(
    `
    UPDATE sessions
    SET status = 'ended', ended_at = NOW()
    WHERE id = $1
    `,
    [sessionId]
  );

  const updatedSession = await findById(sessionId);
  if (!updatedSession) {
    throw new Error("Session not found");
  }

  return updatedSession;
};

export const sessionRepository = {
  create,
  findById,
  listOpenSessions,
  addParticipant,
  removeParticipant,
  end,
  forceEnd
};
