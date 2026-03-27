# Synapse XR

AI-Powered AR Telepresence System for Remote Guidance

## Project Structure

```
Synapse_XR/
├── backend/                 # Ishaan — Node.js + Express + Socket.IO
│   ├── routes/              # REST API routes (auth, sessions, gemini)
│   ├── services/            # Business logic (signaling, gemini calls)
│   ├── db/                  # PostgreSQL schema & migrations
│   ├── middleware/           # Auth middleware
│   └── server.js
│
├── expert-dashboard/        # Ishaan — Next.js expert web app
│   ├── src/app/             # Next.js pages
│   ├── src/components/      # React components (HandTracker, VideoViewer, etc.)
│   └── src/lib/             # Utilities (socket, webrtc)
│
├── unity-ar-app/            # Prayag — Unity AR app for worker
│   ├── Assets/Scripts/      # C# scripts (HandRenderer, WebSocket, YOLO, etc.)
│   ├── Assets/Models/       # 3D hand model
│   ├── Assets/ML/           # TFLite models
│   ├── Assets/Prefabs/      # Unity prefabs
│   ├── Assets/Scenes/       # Unity scenes
│   └── Assets/UI/           # UI elements
│
├── ai-models/               # Sudarsan — ML training & optimization
│   ├── datasets/            # Training data (gitignored)
│   ├── training/            # Training scripts
│   ├── exported/            # Exported models (gitignored)
│   └── gemini-prompts/      # Gemini prompt templates
│
├── esp32-glove/             # Pushkar — ESP32 glove firmware
│   ├── firmware/            # Arduino/PlatformIO code
│   └── docs/                # Wiring diagrams
│
└── shared/                  # Prayag (lead) — Shared schemas & contracts
    └── schemas/             # JSON schemas everyone follows
```

## Team

| Member | Role | Folder |
|---|---|---|
| Prayag | AI/ML + Unity AR App | `unity-ar-app/`, `shared/` |
| Sudarsan | AI Model Training | `ai-models/` |
| Ishaan | Backend + Expert Dashboard | `backend/`, `expert-dashboard/` |
| Pushkar | ESP32 Glove Hardware | `esp32-glove/` |

## Git Rules (Minimize Merge Conflicts)
- Each person commits ONLY to their own folder(s)
- `shared/` is modified only by Prayag (team lead)
- Always `git pull` before starting work
- Use feature branches: `feat/prayag-hand-rendering`, `feat/ishaan-auth`, etc.
