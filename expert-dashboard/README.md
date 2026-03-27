# Synapse XR Expert Dashboard

Expert operator UI for authentication, session control, and live glove-state inspection.

## Architecture Context

- Worker interface is AR-first (Unity mobile/headset), receiving guidance overlays.
- Expert interface is VR/AR-first (Unity headset + ESP32 glove).
- This dashboard is a required secondary interface for session control, debugging, and fallback operations.

## Current Scope

- Login and registration against backend auth endpoints
- Persistent local auth (token in localStorage)
- Route-based pages: `/auth`, `/dashboard`, `/session/[id]`
- Session actions: create/open from dashboard, then join/leave/end from session route
- Latest glove payload fetch by session id

## Prerequisites

- Backend running at `http://localhost:3001` (or any reachable URL)
- Node.js 20+

## Setup

1. Copy `.env.local.example` to `.env.local`
2. Configure backend URL

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

3. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Route Map

- `/` redirects to `/auth` or `/dashboard` depending on stored auth state.
- `/auth` handles register/login.
- `/dashboard` is the session launcher/control hub.
- `/session/[id]` is the per-session control and glove inspection screen.

## Dashboard Docs

- Detailed dashboard docs are maintained in `docs/`.
- Start at `docs/README.md` for architecture, routes, and development workflow notes.

## Notes

- This phase focuses on backend integration and operator controls.
- Real-time socket streaming UI, monitoring views, and ESP32-specific flows will be added in later phases.
