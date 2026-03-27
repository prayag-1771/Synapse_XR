"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Socket } from "socket.io-client";

interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

interface HandPayload {
  type: string;
  source: string;
  hand: string;
  sessionId: string;
  landmarks: { x: number; y: number; z: number }[];
  timestamp: number;
}

interface HandTrackerProps {
  /** The session's authenticated Socket.IO instance */
  socket: Socket;
  /** The session ID to include in emitted payloads */
  sessionId: string;
  /** Called when hand data is emitted (for parent logging/display) */
  onHandData?: (payload: HandPayload) => void;
  /** Called when tracking status changes */
  onStatusChange?: (status: "loading" | "active" | "error" | "stopped") => void;
}

export default function HandTracker({ socket, sessionId, onHandData, onStatusChange }: HandTrackerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<"loading" | "active" | "error" | "stopped">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateStatus = useCallback(
    (next: "loading" | "active" | "error" | "stopped") => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  useEffect(() => {
    let isMounted = true;
    let lastEmitTime = 0;
    const EMIT_INTERVAL = 50; // 20fps max emission rate

    async function setup() {
      try {
        // Dynamically import MediaPipe (no SSR)
        const handsModule = await import("@mediapipe/hands");
        const cameraModule = await import("@mediapipe/camera_utils");

        if (!isMounted) return;

        const hands = new handsModule.Hands({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });

        hands.onResults((results: any) => {
          if (!isMounted) return;

          const canvas = canvasRef.current;
          if (canvas) {
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

              if (results.multiHandLandmarks) {
                for (const landmarks of results.multiHandLandmarks) {
                  drawLandmarks(ctx, landmarks);
                }
              }
            }
          }

          if (
            !results.multiHandLandmarks ||
            results.multiHandLandmarks.length === 0
          )
            return;

          // Throttle: only emit at ~20fps to avoid flooding the WebSocket
          const now = Date.now();
          if (now - lastEmitTime < EMIT_INTERVAL) return;
          lastEmitTime = now;

          // Emit a unique packet for each detected hand (Left and Right)
          for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness?.[i]?.label || "Right";

            const payload: HandPayload = {
              type: "hand_data",
              source: "mediapipe",
              hand: handedness.toLowerCase(),
              sessionId,
              landmarks: landmarks.map((lm: LandmarkPoint) => ({
                x: lm.x,
                y: lm.y,
                z: lm.z,
              })),
              timestamp: now,
            };

            socket.emit("hand:data", payload);
            onHandData?.(payload);
          }
        });

        if (videoRef.current) {
          const camera = new cameraModule.Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && isMounted) {
                await hands.send({ image: videoRef.current });
              }
            },
            width: 640,
            height: 480,
          });
          camera.start();

          cleanupRef.current = () => {
            camera.stop();
            hands.close();
          };

          if (isMounted) {
            updateStatus("active");
          }
        }
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : "Failed to initialize hand tracking";
          setErrorMessage(message);
          updateStatus("error");
        }
      }
    }

    setup();

    return () => {
      isMounted = false;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      updateStatus("stopped");
    };
  }, [socket, sessionId, onHandData, updateStatus]);

  return (
    <div>
      <div style={{ position: "relative", width: "100%", maxWidth: "640px" }}>
        <video
          ref={videoRef}
          style={{ display: "none" }}
          autoPlay
          playsInline
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          style={{ width: "100%", borderRadius: "12px", transform: "scaleX(-1)" }}
        />
      </div>
      {status === "loading" && (
        <p className="mt-2 text-sm text-black/70">Loading MediaPipe hand tracking model...</p>
      )}
      {status === "error" && errorMessage && (
        <p className="mt-2 text-sm text-red-700">{errorMessage}</p>
      )}
    </div>
  );
}

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  landmarks: LandmarkPoint[]
) {
  const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17],
  ];

  ctx.strokeStyle = "#00FF00";
  ctx.lineWidth = 2;
  for (const [i, j] of connections) {
    ctx.beginPath();
    ctx.moveTo(landmarks[i].x * 640, landmarks[i].y * 480);
    ctx.lineTo(landmarks[j].x * 640, landmarks[j].y * 480);
    ctx.stroke();
  }

  ctx.fillStyle = "#FF0000";
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * 640, lm.y * 480, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
}
