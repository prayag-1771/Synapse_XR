"""
Minimal Industrial Repair System
Usage: 
  python repair_system.py                 # Webcam
  python repair_system.py --image img.jpg # Static image
"""

import sys
import argparse
import cv2
from pathlib import Path
from ultralytics import YOLO

WEIGHTS = Path(r"D:\Projects\ai-models\runs\detect\industrial_v1\weights\best.pt")
CONF = 0.35

# Color config (BGR)
COLORS = {"plc": (0,165,255), "motor": (255,100,0), "wire": (0,255,255)}

def load_model():
    if not WEIGHTS.exists(): sys.exit("Weights missing!")
    return YOLO(str(WEIGHTS))


def detect(model, frame):
    """Run YOLO detection. Returns boxes and count dict."""
    res = model(frame, conf=CONF, verbose=False)[0]
    boxes = []
    counts = {"plc": [], "motor": [], "wire": [], "relay": [], "push_button": []}
    
    for b in res.boxes:
        label = res.names[int(b.cls)]
        if label not in counts: continue
        x1, y1, x2, y2 = map(int, b.xyxy[0])
        cx = (x1 + x2) // 2
        d = {"label": label, "conf": float(b.conf), "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": cx}
        boxes.append(d)
        counts[label].append(d)
    return boxes, counts


def evaluate_state(state, counts, frame_width):
    """
    3 simple logic rules:
    STATE 0: Detect PLC (Presence)
    STATE 1: Detect Motor (Presence)
    STATE 2: Detect 2 wires, left wire must be in left half (Count + Position)
    """
    passed = False
    msg = ""

    if state == 0:
        passed = len(counts["plc"]) > 0
        msg = "PLC Detected! Moving to Motor Check" if passed else "No PLC. Scan the panel."
    
    elif state == 1:
        passed = len(counts["motor"]) > 0
        msg = "Motor Detected! Moving to Wiring" if passed else "Motor missing. Check mount."
        
    elif state == 2:
        wires = counts["wire"]
        if len(wires) < 2:
            msg = "Missing wires. Connect at least 2."
        else:
            leftmost_x = min([w["cx"] for w in wires])
            if leftmost_x > (frame_width // 2):
                msg = "Incorrect connection. Move leftmost wire to slot 1 (left)."
            else:
                passed = True
                msg = "Wiring correct! Circuit complete."
                
    elif state >= 3:
        passed = True
        msg = "System Nominal - REPAIR COMPLETE!"
        
    return passed, msg


def render(frame, boxes, state, msg, passed):
    """Draw bounding boxes and HUD overlay."""
    # Draw Boxes
    for b in boxes:
        color = COLORS.get(b["label"], (200,200,200))
        cv2.rectangle(frame, (b["x1"], b["y1"]), (b["x2"], b["y2"]), color, 2)
        cv2.putText(frame, f"{b['label']} {b['conf']:.2f}", (b["x1"], max(15, b["y1"]-10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)
    
    # Draw HUD
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, h-80), (w, h), (30,30,30), -1)
    
    state_txt = f"STATE {state} - " + ("DONE" if state >= 3 else "CHECK")
    state_color = (0,255,0) if passed else (0,165,255)
    
    cv2.putText(frame, state_txt, (15, h-45), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255,255,255), 2)
    cv2.putText(frame, msg, (15, h-15), cv2.FONT_HERSHEY_SIMPLEX, 0.6, state_color, 2)
    
    cv2.putText(frame, "Press 'Q' to quit | 'R' to reset", (w-300, 25), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200,200,200), 1)
    return frame


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", default=None, help="Path to static image")
    parser.add_argument("--cam", type=int, default=0, help="Camera index")
    args = parser.parse_args()

    model = load_model()
    state: int = 0
    hold_count: int = 0

    print(f"\n[STARTING] Repair System — STATE {state}")

    if args.image:
        # ── IMAGE MODE ──────────────────────────────────────────
        orig_img = cv2.imread(args.image)
        if orig_img is None:
            sys.exit(f"[ERROR] Cannot read image: {args.image}")

        while True:
            frame = orig_img.copy()
            height, width = frame.shape[:2]
            boxes, counts = detect(model, frame)
            passed, msg   = evaluate_state(state, counts, width)

            if passed and state < 3:
                hold_count += 1
                if hold_count >= 10:
                    state += 1
                    hold_count = 0
                    print(f"[TRANSITION] STATE → {state}")
            elif not passed:
                hold_count = max(0, hold_count - 1)

            frame = render(frame, boxes, state, msg, passed)
            cv2.imshow("Industrial Repair System", frame)
            key = cv2.waitKey(0) & 0xFF      # block until keypress in image mode
            if key in (ord('q'), 27): break
            elif key == ord('r'): state, hold_count = 0, 0

    else:
        # ── WEBCAM MODE ─────────────────────────────────────────
        cap = cv2.VideoCapture(args.cam)
        if not cap.isOpened():
            sys.exit(f"[ERROR] Cannot open camera index {args.cam}")

        while True:
            success, frame = cap.read()
            if not success:
                print("[WARN] Frame grab failed — retrying...")
                continue

            height, width = frame.shape[:2]
            boxes, counts = detect(model, frame)
            passed, msg   = evaluate_state(state, counts, width)

            if passed and state < 3:
                hold_count += 1
                if hold_count >= 10:
                    state += 1
                    hold_count = 0
                    print(f"[TRANSITION] STATE → {state}")
            elif not passed:
                hold_count = max(0, hold_count - 1)

            frame = render(frame, boxes, state, msg, passed)
            cv2.imshow("Industrial Repair System", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord('q'), 27): break
            elif key == ord('r'): state, hold_count = 0, 0

        cap.release()

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
