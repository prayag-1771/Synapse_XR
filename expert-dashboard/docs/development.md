# Development Workflow

## Local Setup

1. Ensure backend is running.
2. Configure `.env.local`:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

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
