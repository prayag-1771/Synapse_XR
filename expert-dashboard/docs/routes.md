# Route Structure

## Active App Routes

- `/`
  - Redirect route.
  - Sends authenticated users to `/dashboard`, otherwise `/auth`.

- `/auth`
  - Login and registration form.
  - Persists token/user to local storage.

- `/dashboard`
  - Session launcher and operator hub.
  - Create new session or open an existing session ID.

- `/session/[id]`
  - Session-scoped control screen.
  - Actions: refresh, join, leave, end, fetch latest glove state.

## Route Ownership

- App route files are under `src/app/**`.
- Route client logic is in `src/components/*-route-client.tsx`.
- Shared visual shell lives in `src/components/console-shell.tsx`.

## Conventions

When adding routes:
1. Add route page in `src/app/.../page.tsx`.
2. Implement route-specific client component under `src/components/`.
3. Update this file and root README route map.
