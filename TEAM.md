# Team pipSqueaks

## Members

### Prayag Sharma — Team Lead
- **Role:** AI/ML + Unity AR App
- **Email:** prayag.sharma2024@vitstudent.ac.in
- **Phone:** 9872041778
- **Owns:** `unity-ar-app/`, `shared/`, `expert-dashboard/src/components/HandTracker.tsx`
- **Responsibilities:**
  - MediaPipe Hands integration (browser webcam tracking)
  - LSTM smoothing model integration (before that kalma filtere or exponential filter)
  - Unity AR app (AR Foundation + ARCore)
  - 3D hand rendering from landmark data
  - Gesture detection (thumbs up, fist, pointing)
  - Haptic feedback (phone vibration)
  - YOLOv8 TFLite integration into Unity
  - Camera fallback mode
  - Hand smoothing pipeline:
    - **Phase 1 (Day 1):** Kalman Filter — instant, no training needed, removes basic jitter
    - **Phase 2 (Day 2+):** LSTM model — swap in once Sudarsan finishes training, learns natural hand motion patterns, handles occlusion & dropped frames
  - Define shared JSON schemas

### Pushkar Kumar Mishra
- **Role:** ESP32 Glove Hardware
- **Email:** pushkar.kumarmishra2024@vitstudent.ac.in
- **Phone:** 9229714162
- **Owns:** `esp32-glove/`
- **Responsibilities:**
  - ESP32 firmware (flex sensors + IMU reading)
  - Sensor calibration routines
  - Map sensor values → 21-landmark hand format
  - WiFi/WebSocket transmission to backend
  - Glove wiring & PCB design
  - Latency optimization

### R Sudarsan
- **Role:** AI Model Training + AR Overlays
- **Email:** sudarsan.r2024@vitstudent.ac.in
- **Phone:** 7416811107
- **Owns:** `ai-models/`, `unity-ar-app/Assets/Scripts/AROverlayManager.cs`
- **Responsibilities:**
  - YOLOv8 Nano dataset collection, labeling, training
  - LSTM smoothing model training
  - TFLite export & INT8 quantization
  - Model benchmarking on Android (<100ms target)
  - Gemini prompt engineering (step validation, safety)
  - Safety alert rules & step sequence definitions
  - AR overlay UI in Unity (bounding boxes, alerts, subtitles)

### Ishaan Jindal
- **Role:** Backend + Expert Web Dashboard
- **Email:** ishaan.jindal2024@vitstudent.ac.in
- **Phone:** 9041856973
- **Owns:** `backend/`, `expert-dashboard/`
- **Responsibilities:**
  - Node.js + Express + Socket.IO server
  - WebRTC signaling server
  - Hand data & event relay via WebSocket
  - REST APIs (auth, sessions)
  - PostgreSQL schema & setup
  - Gemini API proxy endpoint
  - Next.js expert dashboard (video viewer, voice capture, annotations)
  - Session recording/replay

## Collaboration Points

| Integration | People | How |
|---|---|---|
| Hand landmark JSON schema | Prayag defines → All follow | `shared/schemas/hand_landmark.json` |
| WebSocket events | Ishaan defines → All follow | `shared/schemas/events.json` |
| YOLO TFLite model | Sudarsan trains → Prayag loads in Unity | Share via Google Drive |
| LSTM TFLite model | Sudarsan trains → Prayag loads in Unity | Share via Google Drive |
| Gemini prompts | Sudarsan writes → Ishaan calls API | `ai-models/gemini-prompts/` |
| Glove data format | Pushkar outputs → Ishaan relays | Must match `hand_landmark.json` |
| MediaPipe component | Prayag writes core → Ishaan integrates UI | `HandTracker.tsx` |
| AR overlays | Sudarsan builds UI → Prayag integrates | `AROverlayManager.cs` |

## Timeline

### Day 1: Foundations
| Person | Task |
|---|---|
| Prayag | Unity setup, hand schema, MediaPipe Hands, WebSocket client |
| Sudarsan | Dataset collection, start YOLO + LSTM training |
| Ishaan | Backend scaffold, Socket.IO, WebRTC signaling, REST APIs |
| Pushkar | Sensor wiring, reading flex + IMU, calibration |

### Day 1-2: Core Features
| Person | Task |
|---|---|
| Prayag | 3D hand rendering, gesture detection, LSTM integration in Unity |
| Sudarsan | TFLite export, Gemini prompts, AR overlay UI |
| Ishaan | Next.js dashboard, video viewer, hand data relay |
| Pushkar | Sensor → landmark mapping, WebSocket transmission |

### Day 2: Integration
| Person | Task |
|---|---|
| All | Connect: dashboard ↔ backend ↔ Unity ↔ ESP32 |
| Prayag + Sudarsan | YOLO + LSTM into Unity, end-to-end AI test |
| Ishaan | Gemini endpoint, voice relay, annotation relay |
| Pushkar | Glove → server → Unity pipeline test |

### Day 2-3: Polish
| Person | Task |
|---|---|
| Prayag | Haptic feedback, camera fallback, gesture effects |
| Sudarsan | AR overlay polish, safety alerts, step indicators |
| Ishaan | Voice subtitles, annotations, session recording |
| Pushkar | Calibration refinement, reliability, LED indicators |
