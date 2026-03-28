# Synapse XR

**AI-Powered AR Telepresence System for Remote Guidance**

Team pipSqueaks | DevsHouse Hackathon | GDG on Campus, VIT Chennai | Domain: IoT + AR/VR

## What is Synapse XR?

A system where a remote expert can guide an on-site worker using **virtual 3D hands in Augmented Reality**. The expert's real hand movements are captured and rendered as holographic hands inside the worker's AR view — as if the expert is physically present.

Both the expert and worker see the **same view**: the worker's real-world camera feed with AR hands overlaid on top.

### How It Works

```md
┌──────────────┐          ┌─────────────────────┐          ┌──────────────┐
│  EXPERT SIDE │          │       BACKEND        │          │  WORKER SIDE │
│              │          │                      │          │              │
│  Webcam OR   │──hand──→ │  Node.js + Socket.IO │──hand──→ │  Unity AR    │
│  ESP32 Glove │  data    │  WebRTC Signaling    │  data    │  App         │
│              │          │  Gemini API Proxy     │          │              │
│  MediaPipe   │          │                      │          │  3D Hand     │
│  Hands (JS)  │←─video── │                      │←─video── │  Rendering   │
│              │  feed    │                      │  feed    │  + AI Overlay│
│  Next.js     │          │                      │          │  + YOLO      │
│  Dashboard   │          │                      │          │  + LSTM      │
└──────────────┘          └─────────────────────┘          └──────────────┘
```

### Input Modes for Expert Hand Tracking

1. **Camera Mode (Fallback):** Expert's webcam → MediaPipe Hands → 21 landmarks
2. **Glove Mode:** ESP32 + flex sensors + IMU → 21 landmarks

### AI Features

- **YOLOv8 Nano** (TFLite) — real-time object detection on worker's phone
- **LSTM Smoothing** — removes jitter from hand landmarks for natural motion
- **Gemini 2.0 Flash** — step validation, safety alerts, scene analysis
- **Gesture Recognition** — thumbs up, fist, pointing → trigger AR commands
- **Voice → AR Subtitles** — expert speech shown as floating text in AR
- **AR Annotations** — expert draws arrows/circles visible in worker's AR
- **Haptic Feedback** — phone vibrates near danger zones

## Tech Stack

| Layer | Technology | Cost |
| --- | --- | --- |
| Expert Frontend | Next.js, MediaPipe Hands JS, Web Speech API, WebRTC | Free |
| Backend | Node.js, Express, Socket.IO, PostgreSQL | Free |
| Worker App | Unity (C#), AR Foundation, ARCore XR Plugin | Free |
| Glove Hardware | ESP32, Flex Resistors, IMU (MPU6050/BNO055) | Owned |
| Object Detection | YOLOv8 Nano → TFLite (on-device) | Free |
| Hand Smoothing | LSTM → TFLite / TensorFlow.js | Free |
| Scene Analysis | Gemini 2.0 Flash API (free tier) | Free |
| Hand Tracking | MediaPipe Hands | Free |
| Voice | Web Speech API (browser built-in) | Free |

**Total API cost: $0**

## Project Structure

```md
Synapse_XR/
├── backend/                 # Ishaan — Node.js + Express + Socket.IO
│   ├── routes/              # REST APIs (auth, sessions, gemini)
│   ├── services/            # Signaling, Gemini API calls
│   ├── db/                  # PostgreSQL schema
│   ├── middleware/          # JWT auth middleware
│   └── server.js
│
├── expert-dashboard/        # Ishaan — Next.js expert web app
│   ├── src/app/             # Pages (login, dashboard, session)
│   ├── src/components/      # HandTracker, VideoViewer, VoiceCapture, etc.
│   └── src/lib/             # Socket.IO client, WebRTC helpers
│
├── unity-ar-app/            # Prayag — Unity AR app (worker side)
│   ├── Assets/Scripts/      # HandRenderer, LSTM, YOLO, Gestures, Haptics
│   ├── Assets/Models/       # 3D hand model
│   ├── Assets/ML/           # TFLite models (YOLO, LSTM)
│   ├── Assets/Prefabs/      # Unity prefabs
│   ├── Assets/Scenes/       # Unity scenes
│   └── Assets/UI/           # AR overlay UI
│
├── ai-models/               # Sudarsan — ML training & optimization
│   ├── datasets/            # Training data (gitignored)
│   ├── training/            # YOLO + LSTM training scripts
│   ├── exported/            # Exported TFLite models (gitignored)
│   └── gemini-prompts/      # Gemini prompt templates
│
├── esp32-glove/             # Pushkar — ESP32 glove firmware
│   ├── firmware/            # Arduino code
│   └── docs/                # Wiring diagrams
│
└── shared/                  # Prayag (lead) — Shared data contracts
    └── schemas/             # JSON schemas (hand landmarks, events)
```

## Git Rules

- Each person commits ONLY to their own folder(s)
- `shared/` is modified only by Prayag (team lead)
- Always `git pull` before starting work
- Use feature branches: `feat/prayag-hand-rendering`, `feat/ishaan-auth`, etc.

## Quick Start

### Backend

```bash
cd backend && npm install && npm start
```

### Expert Dashboard

```bash
cd expert-dashboard && npm install && npm run dev
```

### AI Models

```bash
cd ai-models && pip install ultralytics torch mediapipe tensorflow
```

### ESP32 Glove

Open `esp32-glove/firmware/main.ino` in Arduino IDE, set WiFi credentials in `config.h`, upload to ESP32.

### Unity AR App

Open `unity-ar-app/` in Unity Hub. Install AR Foundation + ARCore XR Plugin via Package Manager. Build for Android.
