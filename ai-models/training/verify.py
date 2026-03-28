"""
YOLOv8 Inference & Verification Script
- Runs best.pt on all val images  
- Prints detections per class
- Saves annotated results to runs/detect/verify/
"""
from ultralytics import YOLO
from pathlib import Path

BASE    = Path(r"D:\Projects\ai-models")
WEIGHTS = BASE / "runs" / "detect" / "industrial_v1" / "weights" / "best.pt"
VAL_DIR = BASE / "images" / "val"
CLASSES = ["plc", "relay", "motor", "push_button", "wire"]

print("=" * 60)
print("  YOLOv8 Verification — Industrial Components")
print("=" * 60)

if not WEIGHTS.exists():
    print(f"  ❌ Weights not found: {WEIGHTS}")
    print("     Make sure training has completed first.")
    exit(1)

model  = YOLO(str(WEIGHTS))
images = list(VAL_DIR.glob("*.[jp][pn]*[g]")) + list(VAL_DIR.glob("*.webp"))

print(f"  Weights : {WEIGHTS}")
print(f"  Val imgs: {len(images)}")

counts = {c: 0 for c in CLASSES}
total_det = 0

results_all = model(
    source=str(VAL_DIR),
    conf=0.25,
    save=True,
    project=str(BASE / "runs" / "detect"),
    name="verify",
    exist_ok=True,
    verbose=False,
)

for r in results_all:
    for box in r.boxes:
        cls_id = int(box.cls)
        cls_name = CLASSES[cls_id] if cls_id < len(CLASSES) else str(cls_id)
        counts[cls_name] += 1
        total_det += 1

print("\n  Detection Summary (val set, conf≥0.25)")
print("  " + "-" * 35)
for cls, n in counts.items():
    bar = "█" * min(n, 30)
    print(f"  {cls:<15} {n:>3}  {bar}")
print("  " + "-" * 35)
print(f"  {'TOTAL':<15} {total_det}")

print(f"\n  📁 Annotated images saved to:")
print(f"     {BASE / 'runs' / 'detect' / 'verify'}")
print("\n✅ Verification done!")
