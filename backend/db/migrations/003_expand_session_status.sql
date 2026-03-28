ALTER TABLE sessions
DROP CONSTRAINT IF EXISTS sessions_status_check;

UPDATE sessions
SET status = 'active'
WHERE status = 'open';

ALTER TABLE sessions
ADD CONSTRAINT sessions_status_check CHECK (status IN ('active', 'ended'));
