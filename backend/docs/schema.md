# Database Schema Documentation

## Overview

The Synapse XR backend uses PostgreSQL for persistent data storage. The schema is split into 4 core tables:

- **users**: User authentication and identity
- **sessions**: Telepresence session metadata
- **session_participants**: Session membership (many-to-many)
- **glove_samples**: Optional historical logging of glove position data

## Tables

### users

Stores user authentication credentials and identity.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Unique user identifier (generated on registration) |
| `email` | TEXT | UNIQUE, NOT NULL | Email address for login (enforced unique) |
| `password_hash` | TEXT | NOT NULL | Hashed password (use scrypt or bcrypt) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Registration timestamp (UTC) |

**Indexes:**

- Primary key index on `id` (automatic)
- Unique index on `email` (automatic)

**Example:**

```sql
INSERT INTO users (id, email, password_hash) 
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'alice@example.com', '$2b$10$...');

SELECT * FROM users WHERE email = 'alice@example.com';
```

---

### sessions

Stores telepresence session metadata and lifecycle state.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | UUID | PRIMARY KEY | Unique session identifier (generated on creation) |
| `created_by` | UUID | NOT NULL, FK→users(id) | Creator's user ID (required) |
| `status` | TEXT | NOT NULL, CHECK IN ('active', 'ended') | Session lifecycle state |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Flexible JSON data (room config, mode, etc.) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Session start time (UTC) |
| `ended_at` | TIMESTAMPTZ | NULLABLE | Session ended time (NULL if active) |

**Indexes:**

- Primary key index on `id` (automatic)
- Index on `created_by` (for querying user's sessions)
- Index on `status` (for finding active sessions)

**Constraints:**

- Foreign key on `created_by` → `users(id)` (creator must exist)
- Status must be either 'active' or 'ended'
- `ended_at` should be NULL while status='active', populated when status='ended'

**Example:**

```sql
-- Create active session
INSERT INTO sessions (id, created_by, status, metadata)
VALUES (
  '660e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440000',
  'active',
  '{"mode": "presenter", "room": "demo"}'::jsonb
);

-- Query user's active sessions
SELECT * FROM sessions 
WHERE created_by = '550e8400-e29b-41d4-a716-446655440000' 
  AND status = 'active';

-- End session
UPDATE sessions 
SET status = 'ended', ended_at = NOW() 
WHERE id = '660e8400-e29b-41d4-a716-446655440001';
```

---

### session_participants

Many-to-many junction table linking users to sessions. Tracks who is in each session and when they joined.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `session_id` | UUID | NOT NULL, FK→sessions(id), ON DELETE CASCADE | Session reference |
| `user_id` | UUID | NOT NULL, FK→users(id), ON DELETE CASCADE | Participant reference |
| `joined_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Join timestamp (UTC) |

**Indexes:**

- Composite PRIMARY KEY on (session_id, user_id) (automatic)
- Foreign key indexes on both columns (automatic)

**Constraints:**

- Composite PK prevents duplicate (session, user) pairs
- Cascading deletes: removing session removes all participants; removing user removes all participations
- Each (session_id, user_id) pair is unique

**Example:**

```sql
-- Add participant to session
INSERT INTO session_participants (session_id, user_id)
VALUES ('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001');

-- Query session participants
SELECT u.id, u.email, sp.joined_at
FROM session_participants sp
JOIN users u ON sp.user_id = u.id
WHERE sp.session_id = '660e8400-e29b-41d4-a716-446655440001'
ORDER BY sp.joined_at DESC;

-- Remove participant
DELETE FROM session_participants
WHERE session_id = '660e8400-e29b-41d4-a716-446655440001'
  AND user_id = '550e8400-e29b-41d4-a716-446655440001';
```

---

### glove_samples

Optional historical logging of glove position data. This table has high write volume during active sessions.

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `id` | BIGSERIAL | PRIMARY KEY | Auto-incrementing sample ID |
| `session_id` | UUID | NOT NULL, FK→sessions(id), ON DELETE CASCADE | Session reference |
| `recorded_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Sample timestamp (UTC) |
| `payload` | JSONB | NOT NULL | Hand landmark frame (25 landmarks per hand) |

**Indexes:**

- Primary key index on `id` (automatic)
- Index on `session_id` (for querying samples by session)

**Constraints:**

- Foreign key on `session_id` → `sessions(id)` (session must exist)
- Cascading deletes: removing session removes all samples
- No explicit TTL (retention is manual via DELETE queries on `recorded_at`)

**Example Payload Structure:**

```json
{
  "timestamp": 1234567890.123,
  "left_hand": [
    {"x": 0.5, "y": 0.3, "z": 0.1, "confidence": 0.98},
    {"x": 0.51, "y": 0.31, "z": 0.11, "confidence": 0.97},
    ...
  ],
  "right_hand": [
    {"x": 0.6, "y": 0.4, "z": 0.2, "confidence": 0.95},
    ...
  ]
}
```

**Example Usage:**

```sql
-- Log glove sample during session
INSERT INTO glove_samples (session_id, payload)
VALUES (
  '660e8400-e29b-41d4-a716-446655440001',
  '{"timestamp": 1234567890.123, "left_hand": [...], "right_hand": [...]}'::jsonb
);

-- Query samples from session (last 100)
SELECT recorded_at, payload
FROM glove_samples
WHERE session_id = '660e8400-e29b-41d4-a716-446655440001'
ORDER BY recorded_at DESC
LIMIT 100;

-- Cleanup old samples (older than 7 days)
DELETE FROM glove_samples
WHERE recorded_at < NOW() - INTERVAL '7 days';
```

---

## Relationships Diagram

```md
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  users                                                      │
│  ├─ id (PK)                                                 │
│  ├─ email (UNIQUE)                                          │
│  ├─ password_hash                                           │
│  └─ created_at                                              │
│                                                             │
└────────────────┬──────────────────────┬────────────────────┘
                 │                      │
         created_by (FK)          user_id (FK)
                 │                      │
                 │                      │
        ┌────────▼──────────┐      ┌────▼──────────────────┐
        │                   │      │                       │
        │    sessions       │      │  session_participants │
        │    ├─ id (PK)     │      │  ├─ session_id (FK)   │
        │    ├─ created_by  │      │  ├─ user_id (FK)      │
        │    ├─ status      │      │  └─ joined_at         │
        │    ├─ metadata    │      │                       │
        │    ├─ created_at  │      └───────────────────────┘
        │    └─ ended_at    │
        │                   │
        └────────┬──────────┘
                 │
          session_id (FK)
                 │
        ┌────────▼──────────────────┐
        │                           │
        │    glove_samples          │
        │    ├─ id (PK, BIGSERIAL)  │
        │    ├─ session_id (FK)     │
        │    ├─ recorded_at         │
        │    └─ payload (JSONB)     │
        │                           │
        └───────────────────────────┘
```

---

## Common Query Patterns

### 1. Get all active sessions with participant count

```sql
SELECT 
  s.id,
  s.created_by,
  s.created_at,
  COUNT(sp.user_id) as participant_count
FROM sessions s
LEFT JOIN session_participants sp ON s.id = sp.session_id
WHERE s.status = 'active'
GROUP BY s.id
ORDER BY s.created_at DESC;
```

### 2. Get session details with all participants

```sql
SELECT 
  s.id,
  s.status,
  s.created_at,
  json_agg(json_build_object('user_id', u.id, 'email', u.email, 'joined_at', sp.joined_at)) as participants
FROM sessions s
LEFT JOIN session_participants sp ON s.id = sp.session_id
LEFT JOIN users u ON sp.user_id = u.id
WHERE s.id = $1
GROUP BY s.id;
```

### 3. Check if user is participant in session

```sql
SELECT EXISTS (
  SELECT 1 FROM session_participants
  WHERE session_id = $1 AND user_id = $2
);
```

### 4. Get glove sample statistics for a session

```sql
SELECT 
  COUNT(*) as total_samples,
  MIN(recorded_at) as earliest,
  MAX(recorded_at) as latest,
  (MAX(recorded_at) - MIN(recorded_at)) as duration,
  COUNT(*) * 1.0 / EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) as avg_samples_per_second
FROM glove_samples
WHERE session_id = $1;
```

---

## Performance Considerations

### Write Optimization

- **glove_samples** receives high volumes (60+ samples/sec per active hand)
- Index on `session_id` enables efficient queries by session
- Use batch inserts when possible: `INSERT INTO glove_samples (session_id, payload) VALUES (...), (...), (...)`
- Consider archiving old samples to a separate table if running for months

### Query Optimization

- Always filter by `session_id` when querying glove_samples (indexed)
- Use `session_participants` composite PK for fast membership checks
- **Avoid N+1**: Use JOINs instead of loop-fetching users or sessions
- Connection pooling recommended (default 20 connections in pool)

### Retention

- **Users & Sessions**: Keep indefinitely (audit trail)
- **Glove Samples**: Optional to retain; manual cleanup recommended

  ```sql
  DELETE FROM glove_samples WHERE recorded_at < NOW() - INTERVAL '30 days';
  ```

### Backups

- PostgreSQL `pg_dump` recommended for full backups before migrations
- Point-in-time recovery requires WAL archiving

---

## Migration History

| Version | Date | Changes |
| --- | --- | --- |
| 001 | 2026-03-27 | Initial schema: users, sessions, session_participants, glove_samples with indexes |

To apply migrations:

```bash
psql $DATABASE_URL -f db/migrations/001_init.sql
```
