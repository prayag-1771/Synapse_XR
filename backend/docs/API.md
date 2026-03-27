# Backend API Reference

This document is the canonical API contract for the backend service.

## Base URL

- Local: `http://localhost:5000`
- Default port is controlled by `PORT` in `.env`.

## Authentication

Protected endpoints require:

- Header: `Authorization: Bearer <jwt>`

JWT claims include:

- `userId`
- `email`
- `role` (`worker`, `expert`, `admin`)

Common auth errors:

- `401 Missing or invalid Authorization header`
- `401 Invalid or expired token`

## Health

### GET /health

Returns service liveness.

Response `200`:

```json
{
  "status": "ok",
  "service": "synapse-xr-backend"
}
```

## Auth Routes

Base path: `/auth`

### POST /auth/register

Register a new user.

Request body:

```json
{
  "email": "user@example.com",
  "password": "secret123",
  "role": "worker"
}
```

Notes:

- `email` and `password` are required.
- `password` must be at least 6 characters.
- Publicly registerable roles are only `worker` and `expert`.
- If `role` is omitted, it defaults to `worker`.

Success response `201`:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "worker",
    "createdAt": "2026-03-27T00:00:00.000Z"
  }
}
```

Error responses:

- `400 email and password are required`
- `400 role must be one of: worker, expert`
- `400 password must be at least 6 characters`
- `409` for duplicate/invalid registration attempts

### POST /auth/login

Authenticate and receive JWT.

Request body:

```json
{
  "email": "user@example.com",
  "password": "secret123"
}
```

Success response `200`:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "expert",
    "createdAt": "2026-03-27T00:00:00.000Z"
  }
}
```

Error responses:

- `400 email and password are required`
- `401 Invalid credentials`

### GET /auth/me

Returns authenticated user profile.

Auth: required.

Success response `200`:

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "admin",
    "createdAt": "2026-03-27T00:00:00.000Z"
  }
}
```

Error responses:

- `401 Unauthorized`
- `404 User not found`

## Session Routes

Base path: `/sessions`

Session shape:

```json
{
  "id": "uuid",
  "createdBy": "user-uuid",
  "status": "active",
  "participants": ["user-uuid"],
  "createdAt": "2026-03-27T00:00:00.000Z",
  "endedAt": null
}
```

### POST /sessions

Create a session.

Auth: required (`worker`, `expert`, `admin`).

Success response `201`:

```json
{
  "session": {
    "id": "uuid",
    "createdBy": "user-uuid",
    "status": "active",
    "participants": ["user-uuid"],
    "createdAt": "2026-03-27T00:00:00.000Z",
    "endedAt": null
  }
}
```

Error responses:

- `401 Unauthorized`

### GET /sessions/open

Lists open worker requests (derived): active sessions created by workers that do not yet have expert/admin participation.

Auth: required (`expert` or `admin`).

Success response `200`:

```json
{
  "sessions": [
    {
      "id": "uuid",
      "createdBy": "worker-uuid",
      "status": "active",
      "participants": ["worker-uuid"],
      "createdAt": "2026-03-27T00:00:00.000Z",
      "endedAt": null
    }
  ]
}
```

Error responses:

- `401 Unauthorized`
- `403 Only expert or admin can list open sessions`

### GET /sessions/:id

Get session details.

Auth: required and one of:

- session creator
- session participant
- admin

Success response `200`:

```json
{
  "session": {
    "id": "uuid",
    "createdBy": "user-uuid",
    "status": "active",
    "participants": ["user-uuid", "expert-uuid"],
    "createdAt": "2026-03-27T00:00:00.000Z",
    "endedAt": null
  }
}
```

Error responses:

- `401 Unauthorized`
- `403 Forbidden`
- `404 Session not found`

### GET /sessions/:id/glove/latest

Get latest glove payload cached in Redis for the session.

Auth: same access policy as `GET /sessions/:id`.

Success response `200`:

```json
{
  "latest": {
    "sessionId": "uuid",
    "handLandmarks": []
  }
}
```

Response notes:

- `latest` may be `null` if no glove data has been cached.

Error responses:

- `401 Unauthorized`
- `403 Forbidden`
- `404 Session not found`

### POST /sessions/:id/join

Join a session as participant.

Auth: required.

Success response `200`:

```json
{
  "session": {
    "id": "uuid",
    "createdBy": "user-uuid",
    "status": "active",
    "participants": ["user-uuid", "expert-uuid"],
    "createdAt": "2026-03-27T00:00:00.000Z",
    "endedAt": null
  }
}
```

Error responses:

- `401 Unauthorized`
- `400` invalid operation (example: already ended)
- `404` when session is not found

### POST /sessions/:id/leave

Leave a session participant list.

Auth: required.

Success response `200`:

```json
{
  "session": {
    "id": "uuid",
    "createdBy": "user-uuid",
    "status": "active",
    "participants": ["worker-uuid"],
    "createdAt": "2026-03-27T00:00:00.000Z",
    "endedAt": null
  }
}
```

Error responses:

- `401 Unauthorized`
- `400` invalid operation
- `404` when session is not found

### POST /sessions/:id/end

End a session.

Auth:

- `admin`: can force-end any session
- non-admin: must satisfy repository ownership/authorization checks

Success response `200`:

```json
{
  "session": {
    "id": "uuid",
    "createdBy": "user-uuid",
    "status": "ended",
    "participants": ["worker-uuid", "expert-uuid"],
    "createdAt": "2026-03-27T00:00:00.000Z",
    "endedAt": "2026-03-27T01:00:00.000Z"
  }
}
```

Error responses:

- `401 Unauthorized`
- `403` forbidden end attempt
- `404` when session is not found

## Admin Routes

Base path: `/admin`

All admin routes require authenticated `admin` role.

Common error response:

- `403 Admin access required`

### GET /admin/users

List all users.

Success response `200`:

```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "role": "worker",
      "createdAt": "2026-03-27T00:00:00.000Z"
    }
  ]
}
```

### PATCH /admin/users/:id/role

Update a user role.

Request body:

```json
{
  "role": "expert"
}
```

Allowed values: `worker`, `expert`, `admin`.

Rules:

- Admin cannot demote itself via this endpoint.

Success response `200`:

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "expert",
    "createdAt": "2026-03-27T00:00:00.000Z"
  }
}
```

Error responses:

- `400 role must be one of: worker, expert, admin`
- `400 Admin cannot demote itself via this endpoint`
- `404 User not found`

### GET /admin/sessions?status=active|ended

List sessions, optionally filtered by status.

Query params:

- `status` optional, one of `active` or `ended`

Success response `200`:

```json
{
  "sessions": [
    {
      "id": "uuid",
      "createdBy": "user-uuid",
      "status": "active",
      "participants": ["worker-uuid"],
      "createdAt": "2026-03-27T00:00:00.000Z",
      "endedAt": null
    }
  ]
}
```

Error responses:

- `400 status must be one of: active, ended`

### POST /admin/sessions/:id/end

Force-end any session.

Success response `200`:

```json
{
  "session": {
    "id": "uuid",
    "createdBy": "user-uuid",
    "status": "ended",
    "participants": ["worker-uuid", "expert-uuid"],
    "createdAt": "2026-03-27T00:00:00.000Z",
    "endedAt": "2026-03-27T01:00:00.000Z"
  }
}
```

Error responses:

- `400` invalid end operation
- `404` session not found

## Realtime (Socket.IO)

Socket endpoint:

- Same host/port as backend server.
- CORS origin is `CLIENT_ORIGIN`.

### Client -> Server Events

- `session:join`
  - payload: `{ sessionId: string, userId?: string }`
- `session:end`
  - payload: `{ sessionId?: string }`
- Relayed events (all require `sessionId` in payload or prior session join):
  - `hand:data`
  - `gesture:detected`
  - `voice:transcript`
  - `annotation:update`
  - `ai:detection`
  - `webrtc:offer`
  - `webrtc:answer`
  - `webrtc:ice`

### Server -> Client Events

- `session:participant-joined`
- `session:participant-left`
- `session:end`
- `error:event`
- Relays for all realtime events above

Notes:

- `hand:data` also updates Redis latest glove state per session.
- Realtime events are bridged across backend instances via Redis Pub/Sub.
