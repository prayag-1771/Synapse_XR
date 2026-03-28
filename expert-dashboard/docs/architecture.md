# Expert Dashboard Architecture

## Role in System

The expert dashboard is a secondary but required interface used alongside Unity clients.

- It is not the primary expert UX (Unity VR/AR is primary).
- It provides operational control and fallback when immersive clients are unavailable.
- It supports debugging and live session visibility.

## Interfaces

### Primary Expert Interface
- Unity VR/AR app connected to backend realtime services.

### Secondary Expert Interface
- Next.js dashboard for:
  - authentication
  - session lifecycle control
  - glove-state inspection

### Worker Interface
- Unity AR app with real-world overlay guidance.

## Current Data Touchpoints

- Auth: `/auth/register`, `/auth/login`, `/auth/me`
- Sessions: `/sessions`, `/sessions/:id`, `/sessions/:id/join`, `/sessions/:id/leave`, `/sessions/:id/end`
- Realtime snapshot: `/sessions/:id/glove/latest`

## Evolution Path

Near-term additions expected here:
- live Socket.IO data panel
- session diagnostics timeline
- structured error and reconnect visibility
