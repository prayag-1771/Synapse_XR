#!/usr/bin/env bash
# ─────────────────────────────────────────────────
# Synapse XR Full Pipeline Demo
# Starts backend + expert dashboard, opens demo
# ─────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
DASHBOARD_DIR="$ROOT/expert-dashboard"

cleanup() {
  echo ""
  echo "[demo] Shutting down..."
  kill $BACKEND_PID $DASHBOARD_PID 2>/dev/null
  wait $BACKEND_PID $DASHBOARD_PID 2>/dev/null
  echo "[demo] Done."
}
trap cleanup EXIT INT TERM

# 1. Install deps if needed
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "[demo] Installing backend dependencies..."
  (cd "$BACKEND_DIR" && npm install)
fi

if [ ! -d "$DASHBOARD_DIR/node_modules" ]; then
  echo "[demo] Installing dashboard dependencies..."
  (cd "$DASHBOARD_DIR" && npm install)
fi

# 2. Start backend relay server (dev mode with tsx watch)
echo "[demo] Starting backend on :5000..."
(cd "$BACKEND_DIR" && npm run dev) &
BACKEND_PID=$!
sleep 3

# 3. Start expert dashboard (Next.js dev server)
echo "[demo] Starting expert dashboard on :3000..."
(cd "$DASHBOARD_DIR" && npm run dev) &
DASHBOARD_PID=$!
sleep 4

echo ""
echo "================================================"
echo "  Synapse XR Demo Ready"
echo ""
echo "  Expert Dashboard: http://localhost:3000"
echo "    → Register/login → Create session → Start hand tracking"
echo ""
echo "  Worker 3D Demo:   http://localhost:5000/demo"
echo "    → Enter session ID from dashboard → See expert's hands in 3D"
echo ""
echo "  Server Health:    http://localhost:5000/health"
echo "================================================"
echo ""
echo "WORKFLOW:"
echo "  1. Open Expert Dashboard → register as 'expert' → create session"
echo "  2. Copy the session ID"
echo "  3. Open Worker Demo → paste session ID → click Connect"
echo "  4. In Expert Dashboard → click 'Start Hand Tracking' → wave your hand!"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Try to open browser
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:3000" 2>/dev/null &
  sleep 1
  xdg-open "http://localhost:5000/demo" 2>/dev/null &
fi

wait
