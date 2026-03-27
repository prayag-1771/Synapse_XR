"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { Socket } from "socket.io-client";

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

interface HandPayload {
  type: string;
  source: string;
  hand: string;
  sessionId: string;
  landmarks: LandmarkPoint[];
  timestamp: number;
}

interface HandTrackerProps {
  socket: Socket;
  sessionId: string;
  onHandData?: (payload: HandPayload) => void;
  /** Called every frame with raw landmarks for immediate overlay rendering */
  onLandmarks?: (landmarks: LandmarkPoint[], hand: string) => void;
  onStatusChange?: (status: "loading" | "active" | "error" | "stopped") => void;
  /** If false, hides the webcam preview canvas (default true) */
  showPreview?: boolean;
}

export default function HandTracker({
  socket,
  sessionId,
  onHandData,
  onLandmarks,
  onStatusChange,
  showPreview = true,
}: HandTrackerProps) {
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
    const EMIT_INTERVAL = 33; // ~30fps emission rate (reduced from 50ms/20fps)

    async function setup() {
      try {
        const handsModule = await import("@mediapipe/hands");
        const cameraModule = await import("@mediapipe/camera_utils");
        if (!isMounted) return;

        const hands = new handsModule.Hands({
          locateFile: (file: string) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 0,        // 0 = lite (fastest), was 1
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5, // lowered for speed
        });

        hands.onResults((results: any) => {
          if (!isMounted) return;

          // Draw preview if enabled
          if (showPreview && canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");
            if (ctx) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              ctx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);
              if (results.multiHandLandmarks) {
                for (const lms of results.multiHandLandmarks) {
                  drawMiniLandmarks(ctx, lms, canvasRef.current.width, canvasRef.current.height);
                }
              }
            }
          }

          if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

          const now = Date.now();

          // Always fire onLandmarks immediately (no throttle) for smooth local overlay
          for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness?.[i]?.label || "Right";
            const hand = handedness.toLowerCase();
            const mapped: LandmarkPoint[] = landmarks.map((lm: LandmarkPoint) => ({
              x: lm.x, y: lm.y, z: lm.z,
            }));
            onLandmarks?.(mapped, hand);
          }

          // Throttle socket emission
          if (now - lastEmitTime < EMIT_INTERVAL) return;
          lastEmitTime = now;

          for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i];
            const handedness = results.multiHandedness?.[i]?.label || "Right";
            const payload: HandPayload = {
              type: "hand_data",
              source: "mediapipe",
              hand: handedness.toLowerCase(),
              sessionId,
              landmarks: landmarks.map((lm: LandmarkPoint) => ({ x: lm.x, y: lm.y, z: lm.z })),
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
            width: 480,   // reduced from 640 for speed
            height: 360,  // reduced from 480 for speed
          });
          camera.start();
          cleanupRef.current = () => { camera.stop(); hands.close(); };
          if (isMounted) updateStatus("active");
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(err instanceof Error ? err.message : "Failed to init hand tracking");
          updateStatus("error");
        }
      }
    }

    setup();
    return () => {
      isMounted = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [socket, sessionId, onHandData, onLandmarks, updateStatus, showPreview]);

  return (
    <div>
      <video ref={videoRef} style={{ display: "none" }} autoPlay playsInline />
      {showPreview && (
        <canvas
          ref={canvasRef}
          width={480}
          height={360}
          style={{ width: "100%", borderRadius: "8px", transform: "scaleX(-1)" }}
        />
      )}
      {status === "loading" && (
        <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "11px", marginTop: 4 }}>Loading model...</p>
      )}
      {status === "error" && errorMessage && (
        <p style={{ color: "#ff5252", fontSize: "11px", marginTop: 4 }}>{errorMessage}</p>
      )}
    </div>
  );
}

function drawMiniLandmarks(ctx: CanvasRenderingContext2D, landmarks: LandmarkPoint[], w: number, h: number) {
  ctx.strokeStyle = "#00e5ff";
  ctx.lineWidth = 1.5;
  const conns = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]];
  for (const [i, j] of conns) {
    ctx.beginPath();
    ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
    ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(lm.x * w, lm.y * h, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}
