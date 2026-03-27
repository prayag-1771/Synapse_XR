import { io } from "socket.io-client";

const wsUrl = process.env.BACKEND_WS_URL ?? "http://localhost:5000";
const sessionId = process.argv[2] ?? "test-session";
const userId = process.argv[3] ?? "worker-test";

const socket = io(wsUrl, {
  transports: ["websocket"]
});

let received = 0;
let lastFrame = -1;
let totalLatencyMs = 0;

socket.on("connect", () => {
  console.log(`[worker] connected: ${socket.id}`);
  socket.emit("session:join", { sessionId, userId });
  console.log(`[worker] joined session ${sessionId} as ${userId}`);
});

socket.on("session:participant-joined", (payload) => {
  console.log(`[worker] participant joined`, payload);
});

socket.on("hand:data", (payload: { frame?: number; sentAt?: number; sessionId?: string }) => {
  received += 1;
  const frame = payload.frame ?? -1;
  const missing = lastFrame >= 0 && frame > lastFrame + 1 ? frame - lastFrame - 1 : 0;
  lastFrame = frame;

  const latencyMs = typeof payload.sentAt === "number" ? Date.now() - payload.sentAt : 0;
  totalLatencyMs += latencyMs;

  if (received % 20 === 0 || missing > 0) {
    const avgLatency = totalLatencyMs / received;
    console.log(
      `[worker] rx=${received} frame=${frame} missing=${missing} latency=${latencyMs}ms avgLatency=${avgLatency.toFixed(1)}ms`
    );
  }
});

socket.on("error:event", (payload) => {
  console.error("[worker] server error:event", payload);
});

socket.on("disconnect", (reason) => {
  console.log(`[worker] disconnected: ${reason}`);
});

process.on("SIGINT", () => {
  console.log("\n[worker] shutting down...");
  socket.close();
  process.exit(0);
});
