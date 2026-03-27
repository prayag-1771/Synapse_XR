# Development Workflow

## Local Setup

1. Ensure backend is running.
2. Configure `.env.local`:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_BACKEND_WS_URL=http://localhost:3001
```

`NEXT_PUBLIC_BACKEND_WS_URL` is optional and defaults to `NEXT_PUBLIC_BACKEND_URL` when not set.

3. Start dashboard:

```bash
npm install
npm run dev
```

## Validation

Use these checks before merging:

```bash
npm run lint
npm run build
```

## Documentation Maintenance Rule

When making meaningful dashboard changes, update docs in this folder in the same change set:
- route changes -> update `routes.md`
- architecture/flow changes -> update `architecture.md`
- setup or scripts changes -> update this file

## Near-term Backlog

- Add live Socket.IO session stream panel
- Add typed runtime status indicators for backend connectivity
- Add richer session diagnostics and event traces

## Session Diagnostics

The session route now includes runtime diagnostics:
- socket connection state and reconnect counter
- hand packet throughput (current and short rolling history)
- backend health latency probe and rolling average
- error buckets (action/socket/server/health)

Use these indicators first when validating Unity + glove relay behavior.

## Role and Access Notes

- Registration supports `worker` and `expert` roles from the dashboard.
- Backend supports `admin` role for privileged operations.
- Worker-created sessions are treated as open requests while status is `active` and no expert/admin has joined yet.
- Expert/admin can list open requests and claim by joining.
- Opening a session from dashboard auto-attempts join when current user is not yet a participant.
