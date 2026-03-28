# Safety Check Rules

Safety alerts generated from YOLO detection context during industrial repair guidance.

## Alert Triggers

| Condition | Alert Message | Severity |
|-----------|---------------|----------|
| Wire detected near motor without PLC powered | "Ensure PLC is powered before wiring motor" | Warning |
| Unknown objects in detection frame | "Unidentified component detected — verify before proceeding" | Caution |
| No components detected for >5s | "Lost visual contact — reposition camera" | Info |
| Wire count > expected for step | "Extra wires detected — verify connections match diagram" | Warning |

## Socket Event: ai:detection alerts

The `ai:detection` event includes an `alerts` array for any safety flags:

```json
{
  "sessionId": "uuid",
  "objects": [
    { "label": "wire", "confidence": 0.87, "bbox": [0.1, 0.2, 0.4, 0.6] }
  ],
  "alerts": ["Ensure PLC is powered before wiring motor"]
}
```
