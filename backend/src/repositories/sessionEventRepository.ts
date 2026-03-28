import { pgQuery } from "../db/postgres";
import { logger } from "../services/logger";

interface SessionEventRow {
  id: string;
  session_id: string;
  event_type: string;
  user_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  eventType: string;
  userId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface SessionAnalytics {
  sessionId: string;
  totalEvents: number;
  durationSeconds: number | null;
  eventCounts: Record<string, number>;
  handPacketsTotal: number;
  aiDetectionFrames: number;
  voiceTranscripts: number;
  annotations: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
}

const mapRow = (row: SessionEventRow): SessionEvent => ({
  id: row.id,
  sessionId: row.session_id,
  eventType: row.event_type,
  userId: row.user_id,
  payload: row.payload,
  createdAt: row.created_at,
});

/**
 * Insert a session event. Used by the socket relay to persist events for recording.
 * Non-blocking — errors are logged but do not propagate.
 */
const insert = async (
  sessionId: string,
  eventType: string,
  userId: string | null,
  payload: unknown
): Promise<void> => {
  try {
    await pgQuery(
      `INSERT INTO session_events (session_id, event_type, user_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, eventType, userId, JSON.stringify(payload)]
    );
  } catch (error) {
    logger.error("session_event_insert_failed", {
      sessionId,
      eventType,
      error: error instanceof Error ? error.message : "Unknown insert error",
    });
  }
};

/**
 * Batch insert multiple events in a single query. Useful for high-throughput events.
 */
const insertBatch = async (
  events: { sessionId: string; eventType: string; userId: string | null; payload: unknown }[]
): Promise<void> => {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const offset = i * 4;
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
    values.push(events[i].sessionId, events[i].eventType, events[i].userId, JSON.stringify(events[i].payload));
  }

  try {
    await pgQuery(
      `INSERT INTO session_events (session_id, event_type, user_id, payload)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  } catch (error) {
    logger.error("session_event_batch_insert_failed", {
      count: events.length,
      error: error instanceof Error ? error.message : "Unknown batch insert error",
    });
  }
};

/**
 * Get all events for a session, optionally filtered by type.
 */
const listBySession = async (
  sessionId: string,
  eventType?: string,
  limit = 500,
  offset = 0
): Promise<SessionEvent[]> => {
  const params: unknown[] = [sessionId];
  let typeFilter = "";

  if (eventType) {
    params.push(eventType);
    typeFilter = `AND event_type = $2`;
  }

  params.push(limit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const { rows } = await pgQuery<SessionEventRow>(
    `SELECT id, session_id, event_type, user_id, payload, created_at
     FROM session_events
     WHERE session_id = $1 ${typeFilter}
     ORDER BY created_at ASC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  return rows.map(mapRow);
};

/**
 * Get voice transcript history for a session.
 */
const getVoiceHistory = async (sessionId: string): Promise<SessionEvent[]> => {
  const { rows } = await pgQuery<SessionEventRow>(
    `SELECT id, session_id, event_type, user_id, payload, created_at
     FROM session_events
     WHERE session_id = $1 AND event_type = 'voice:transcript'
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return rows.map(mapRow);
};

/**
 * Get annotations for a session.
 */
const getAnnotations = async (sessionId: string): Promise<SessionEvent[]> => {
  const { rows } = await pgQuery<SessionEventRow>(
    `SELECT id, session_id, event_type, user_id, payload, created_at
     FROM session_events
     WHERE session_id = $1 AND event_type = 'annotation:update'
     ORDER BY created_at ASC`,
    [sessionId]
  );

  return rows.map(mapRow);
};

/**
 * Get analytics for a session — event counts, duration, totals.
 */
const getAnalytics = async (sessionId: string): Promise<SessionAnalytics> => {
  const { rows: countRows } = await pgQuery<{ event_type: string; cnt: string }>(
    `SELECT event_type, COUNT(*)::text AS cnt
     FROM session_events
     WHERE session_id = $1
     GROUP BY event_type`,
    [sessionId]
  );

  const eventCounts: Record<string, number> = {};
  let totalEvents = 0;
  for (const row of countRows) {
    const count = parseInt(row.cnt, 10);
    eventCounts[row.event_type] = count;
    totalEvents += count;
  }

  const { rows: timeRows } = await pgQuery<{
    first_event: string | null;
    last_event: string | null;
    duration_secs: string | null;
  }>(
    `SELECT
       MIN(created_at)::text AS first_event,
       MAX(created_at)::text AS last_event,
       EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))::text AS duration_secs
     FROM session_events
     WHERE session_id = $1`,
    [sessionId]
  );

  const timeRow = timeRows[0] ?? { first_event: null, last_event: null, duration_secs: null };

  return {
    sessionId,
    totalEvents,
    durationSeconds: timeRow.duration_secs ? parseFloat(timeRow.duration_secs) : null,
    eventCounts,
    handPacketsTotal: eventCounts["hand:data"] ?? 0,
    aiDetectionFrames: eventCounts["ai:detection"] ?? 0,
    voiceTranscripts: eventCounts["voice:transcript"] ?? 0,
    annotations: eventCounts["annotation:update"] ?? 0,
    firstEventAt: timeRow.first_event,
    lastEventAt: timeRow.last_event,
  };
};

export const sessionEventRepository = {
  insert,
  insertBatch,
  listBySession,
  getVoiceHistory,
  getAnnotations,
  getAnalytics,
};
