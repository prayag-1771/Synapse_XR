-- Session events table for recording all realtime events (hand:data, voice:transcript, etc.)
-- Enables session replay and analytics.

CREATE TABLE IF NOT EXISTS session_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  user_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events (session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_session_type ON session_events (session_id, event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_created_at ON session_events (session_id, created_at);
