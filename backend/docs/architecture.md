# Backend Data Architecture

## Goals

- Keep real-time path low-latency for glove and signaling events.
- Keep auth/session lifecycle durable and queryable.
- Scale Socket.IO horizontally with Redis Pub/Sub fan-out.

## Layer Split

- Real-time layer (Redis):
  - Stores latest glove state per session key.
  - Distributes socket events across backend instances through Pub/Sub.
- Persistent layer (PostgreSQL):
  - Stores users, sessions, participants, and optional glove samples.

## Suggested Folder Structure

```text
backend/
  docs/
    architecture.md
    setup.md
  db/
    migrations/
      001_init.sql
  src/
    config/
      env.ts
    db/
      postgres.ts
      redis.ts
    repositories/
      userRepository.ts
      sessionRepository.ts
    routes/
      auth.ts
      sessions.ts
    services/
      logger.ts
      socketService.ts
    app.ts
    server.ts
```

## Event Flow

1. ESP32/dashboard emits `hand:data` with `sessionId`.
2. Socket server emits to local room immediately.
3. Latest glove packet is written to Redis key `glove:latest:{sessionId}`.
4. Event is published to Redis channel `synapse:socket:events`.
5. Other backend instances consume and emit to their local room clients.

## Why this scales

- Socket fan-out is O(instances) over Redis Pub/Sub.
- Reads for "latest glove state" avoid SQL and hit Redis directly.
- SQL is reserved for write-heavy but lower-frequency business state.
