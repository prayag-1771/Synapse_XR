import { io } from "socket.io-client";

const wsUrl = process.env.BACKEND_WS_URL ?? "http://localhost:5000";
const workerToken = process.env.BACKEND_TOKEN_WORKER;
const expertToken = process.env.BACKEND_TOKEN_EXPERT;
const sessionId = process.argv[2] ?? `test-${Date.now()}`;
const durationSeconds = Number(process.argv[3] ?? "10");
const hz = Number(process.argv[4] ?? "20");

if (!workerToken || !expertToken) {
  console.error("Set BACKEND_TOKEN_WORKER and BACKEND_TOKEN_EXPERT before running this script.");
  process.exit(1);
}

const intervalMs = Math.max(10, Math.floor(1000 / Math.max(1, hz)));
const runMs = Math.max(1000, durationSeconds * 1000);

const makeLandmarks = (frame: number) => {
  const t = frame / 10;
  return Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + 0.15 * Math.sin(t + i * 0.03),
    y: 0.5 + 0.15 * Math.cos(t + i * 0.02),
    z: 0.05 * Math.sin(t + i * 0.01)
  }));
};

const expert = io(wsUrl, {
  transports: ["websocket"],
  auth: { token: expertToken }
});
const worker = io(wsUrl, {
  transports: ["websocket"],
  auth: { token: workerToken }
});

let tx = 0;
let rx = 0;
let lastFrame = 0;
let totalLatency = 0;
let maxLatency = 0;
let timer: NodeJS.Timeout | null = null;

const cleanup = (code: number) => {
  if (timer) {
    clearInterval(timer);
  }
  expert.close();
  worker.close();
  process.exit(code);
};

worker.on("connect", () => {
  worker.emit("session:join", { sessionId });
});

expert.on("connect", () => {
  expert.emit("session:join", { sessionId });

  timer = setInterval(() => {
    tx += 1;
    expert.emit("hand:data", {
      sessionId,
      frame: tx,
      sentAt: Date.now(),
      source: "fake-glove",
      landmarks: makeLandmarks(tx)
    });
  }, intervalMs);
});

worker.on("hand:data", (payload: { frame?: number; sentAt?: number }) => {
  const frame = payload.frame ?? 0;
  const sentAt = payload.sentAt ?? Date.now();
  const latency = Date.now() - sentAt;

  rx += 1;
  lastFrame = Math.max(lastFrame, frame);
  totalLatency += latency;
  maxLatency = Math.max(maxLatency, latency);
});

const finish = () => {
  const drops = Math.max(0, tx - rx);
  const dropRate = tx > 0 ? (drops / tx) * 100 : 0;
  const avgLatency = rx > 0 ? totalLatency / rx : 0;

  console.log("\n=== fake-pair summary ===");
  console.log(`wsUrl: ${wsUrl}`);
  console.log(`sessionId: ${sessionId}`);
  console.log(`durationSec: ${durationSeconds}`);
  console.log(`hz: ${hz}`);
  console.log(`tx: ${tx}`);
  console.log(`rx: ${rx}`);
  console.log(`drops: ${drops} (${dropRate.toFixed(2)}%)`);
  console.log(`lastFrame: ${lastFrame}`);
  console.log(`avgLatencyMs: ${avgLatency.toFixed(2)}`);
  console.log(`maxLatencyMs: ${maxLatency}`);

  cleanup(0);
};

setTimeout(finish, runMs);

for (const socket of [expert, worker]) {
  socket.on("connect_error", (error) => {
    console.error("connect_error:", error.message);
    cleanup(1);
  });

  socket.on("error:event", (payload) => {
    console.error("error:event:", payload);
  });
}

process.on("SIGINT", () => {
  console.log("\nInterrupted.");
  cleanup(0);
});
