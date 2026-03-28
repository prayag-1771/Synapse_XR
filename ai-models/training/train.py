"""
YOLOv8 Training Script
Trains a yolov8n model on the industrial component dataset.
"""
from ultralytics import YOLO
from pathlib import Path

BASE     = Path(r"D:\Projects\ai-models")
DATA     = BASE / "data.yaml"
EPOCHS   = 50
IMGSZ    = 640
BATCH    = 8
NAME     = "industrial_v1"
PROJECT  = str(BASE / "runs" / "detect")

print("=" * 60)
print("  YOLOv8 Industrial Component Trainer")
print("=" * 60)
print(f"  Data   : {DATA}")
print(f"  Epochs : {EPOCHS}")
print(f"  ImgSz  : {IMGSZ}")
print(f"  Batch  : {BATCH}")
print(f"  Device : CPU")
print("=" * 60)

model  = YOLO("yolov8n.pt")
results = model.train(
    data      = str(DATA),
    epochs    = EPOCHS,
    imgsz     = IMGSZ,
    batch     = BATCH,
    name      = NAME,
    project   = PROJECT,
    device    = "cpu",
    patience  = 10,
    workers   = 0,            # Windows: avoid multiprocessing issues
    cache     = False,
    verbose   = True,
)

print("\n✅ Training complete!")
print(f"   Best weights : {PROJECT}/{NAME}/weights/best.pt")
print(f"   Results plot : {PROJECT}/{NAME}/results.png")
