import { io } from "socket.io-client";

const wsUrl = process.env.BACKEND_WS_URL ?? "http://localhost:5000";
const token = process.env.BACKEND_TOKEN;
const sessionId = process.argv[2] ?? "test-session";

if (!token) {
  console.error("Set BACKEND_TOKEN before running this script.");
  process.exit(1);
}

const socket = io(wsUrl, {
  transports: ["websocket"],
  auth: { token }
});

let received = 0;
let lastFrame = -1;
let totalLatencyMs = 0;

socket.on("connect", () => {
  console.log(`[worker] connected: ${socket.id}`);
  socket.emit("session:join", { sessionId });
  console.log(`[worker] joined session ${sessionId}`);
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
