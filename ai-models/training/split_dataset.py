import shutil, random
from pathlib import Path

BASE  = Path(r"D:\Projects\ai-models")
CATS  = ["plc", "relay", "motor", "push_button", "wire"]
VAL_RATIO = 0.15

for split in ("train", "val"):
    (BASE / "images" / split).mkdir(parents=True, exist_ok=True)
    (BASE / "labels"  / split).mkdir(parents=True, exist_ok=True)

total_train = total_val = 0

for cat in CATS:
    folder = BASE / cat
    imgs   = [p for p in folder.iterdir()
              if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    random.seed(42)
    random.shuffle(imgs)

    n_val = max(1, int(len(imgs) * VAL_RATIO))

    for i, img in enumerate(imgs):
        split = "val" if i < n_val else "train"
        txt   = img.with_suffix(".txt")

        shutil.copy2(img, BASE / "images" / split / img.name)
        if txt.exists():
            shutil.copy2(txt, BASE / "labels" / split / txt.name)

    train_n = len(imgs) - n_val
    print(f"  {cat:<15} → train={train_n}, val={n_val}")
    total_train += train_n
    total_val   += n_val

print(f"\n  TOTAL → train={total_train}, val={total_val}")
print("✅ Dataset split complete.")
