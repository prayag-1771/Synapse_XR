# Step Validation Prompt

Used by the repair system to validate each step of the industrial repair process.
The YOLO model detects components and the step validation logic evaluates progress.

## Detection Classes

| Class ID | Label        | Color    |
|----------|-------------|----------|
| 0        | plc         | #ffa500  |
| 1        | relay       | #ff4081  |
| 2        | motor       | #0064ff  |
| 3        | push_button | #76ff03  |
| 4        | wire        | #00ffff  |

## Step Logic

### STATE 0 — PLC Detection
- **Condition**: At least 1 PLC detected
- **Pass message**: "PLC Detected! Moving to Motor Check"
- **Fail message**: "No PLC. Scan the panel."

### STATE 1 — Motor Check
- **Condition**: At least 1 Motor detected
- **Pass message**: "Motor Detected! Moving to Wiring"
- **Fail message**: "Motor missing. Check mount."

### STATE 2 — Wiring Verification
- **Condition**: At least 2 wires detected, AND the leftmost wire center-x is in the left half of the frame
- **Pass message**: "Wiring correct! Circuit complete."
- **Fail messages**:
  - "Missing wires. Connect at least 2." (if < 2 wires)
  - "Incorrect connection. Move leftmost wire to slot 1 (left)." (if position check fails)

### STATE 3 — System Nominal
- **Message**: "System Nominal — REPAIR COMPLETE!"

## Hold Count Logic

- A step transitions only after passing **10 consecutive frames** of detection
- If a step fails, the hold count decreases by 1 (floor 0)
- This prevents flickering from transient detections

## Socket Event Format

```json
{
  "sessionId": "uuid",
  "currentStep": 0,
  "passed": false,
  "message": "No PLC. Scan the panel.",
  "detectedCounts": {
    "plc": 0,
    "relay": 0,
    "motor": 0,
    "push_button": 0,
    "wire": 0
  }
}
```
