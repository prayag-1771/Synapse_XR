# Route Structure

## Active App Routes

- `/`
  - Redirect route.
  - Sends authenticated users to `/dashboard`, otherwise `/auth`.

- `/auth`
  - Login and registration form.
  - Registration supports role selection (`worker` or `expert`).
  - Persists token/user to local storage.

- `/dashboard`
  - Session launcher and operator hub.
  - Worker: create guidance request session.
  - Expert/Admin: create/open sessions and view open worker request queue.
  - Opening a session auto-attempts `join` when access is forbidden for non-participants.

- `/session/[id]`
  - Session-scoped control screen.
  - Actions: refresh, join, leave, end, fetch latest glove state.
  - Live Socket.IO monitor for connection status, hand packet throughput, and recent event log.
  - Diagnostics panel for reconnect count, health latency estimate, throughput history, and error buckets.

## Route Ownership

- App route files are under `src/app/**`.
- Route client logic is in `src/components/*-route-client.tsx`.
- Shared visual shell lives in `src/components/console-shell.tsx`.

## Conventions

When adding routes:
1. Add route page in `src/app/.../page.tsx`.
2. Implement route-specific client component under `src/components/`.
3. Update this file and root README route map.
