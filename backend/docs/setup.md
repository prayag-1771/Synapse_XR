# Backend Setup (Redis + PostgreSQL)

## Environment

Copy `.env.example` to `.env` and set values:

```bash
PORT=5000
CLIENT_ORIGIN=http://localhost:3000
JWT_SECRET=replace_me
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/synapse_xr
PG_POOL_MAX=20
REDIS_URL=redis://localhost:6379
REDIS_GLOVE_TTL_SECONDS=120
```

## Install and Run

```bash
cd backend
npm install
npm run dev
```

## Run Migration

Use your preferred SQL client and run:

- `db/migrations/001_init.sql`
- `db/migrations/002_add_user_role.sql`
- `db/migrations/003_expand_session_status.sql`

Example with psql:

```bash
psql postgresql://postgres:postgres@localhost:5432/synapse_xr -f db/migrations/001_init.sql
psql postgresql://postgres:postgres@localhost:5432/synapse_xr -f db/migrations/002_add_user_role.sql
psql postgresql://postgres:postgres@localhost:5432/synapse_xr -f db/migrations/003_expand_session_status.sql
```

`003_expand_session_status.sql` currently normalizes historical status values and enforces `active/ended`.

## Example: Redis latest glove state

Write:

```ts
await setLatestGloveState(sessionId, glovePayload);
```

Read:

```ts
const latest = await getLatestGloveState<Record<string, unknown>>(sessionId);
```

## Example: Store session in PostgreSQL

```ts
const session = await sessionRepository.create(userId);
const joined = await sessionRepository.addParticipant(session.id, workerId);
const ended = await sessionRepository.end(session.id, userId);
```

## Roles

- Supported roles: `worker`, `expert`, `admin`
- Public registration accepts `worker` and `expert`
- `admin` users should be provisioned by migration/SQL tooling or manual DB update

Example admin promotion:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';
```

## Example: Redis Pub/Sub + Socket.IO

- Local instance emits to room immediately.
- Same event is published to Redis channel.
- Other instances consume and emit to their own room clients.

This pattern is implemented in `src/services/socketService.ts`.

## Performance and Scalability Practices

- Keep glove packets in Redis only (short TTL) to reduce SQL pressure.
- Use Redis Pub/Sub for cross-instance socket fan-out.
- Keep SQL indexes on session ownership and status.
- Keep Postgres pool bounded (`PG_POOL_MAX`) and tune by CPU cores.
- Prefer compact event payloads and avoid deep nested JSON.
- Track event lag and dropped packet rates in logs/metrics.
- Use separate channels for high-volume vs control events if traffic grows.
