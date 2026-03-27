import { io } from "socket.io-client";

const wsUrl = process.env.BACKEND_WS_URL ?? "http://localhost:5000";
const sessionId = process.argv[2] ?? "test-session";
const userId = process.argv[3] ?? "expert-test";
const hz = Number(process.argv[4] ?? "20");

const intervalMs = Math.max(10, Math.floor(1000 / Math.max(1, hz)));

const makeLandmarks = (frame: number) => {
  const t = frame / 10;
  return Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + 0.15 * Math.sin(t + i * 0.03),
    y: 0.5 + 0.15 * Math.cos(t + i * 0.02),
    z: 0.05 * Math.sin(t + i * 0.01)
  }));
};

const socket = io(wsUrl, {
  transports: ["websocket"]
});

let frame = 0;
let timer: NodeJS.Timeout | null = null;

socket.on("connect", () => {
  console.log(`[expert] connected: ${socket.id}`);
  socket.emit("session:join", { sessionId, userId });
  console.log(`[expert] joined session ${sessionId} as ${userId}`);

  timer = setInterval(() => {
    frame += 1;
    socket.emit("hand:data", {
      sessionId,
      frame,
      sentAt: Date.now(),
      source: "fake-glove",
      landmarks: makeLandmarks(frame)
    });

    if (frame % 20 === 0) {
      console.log(`[expert] tx=${frame}`);
    }
  }, intervalMs);
});

socket.on("error:event", (payload) => {
  console.error("[expert] server error:event", payload);
});

socket.on("disconnect", (reason) => {
  console.log(`[expert] disconnected: ${reason}`);
});

process.on("SIGINT", () => {
  console.log("\n[expert] shutting down...");
  if (timer) {
    clearInterval(timer);
  }
  socket.close();
  process.exit(0);
});
