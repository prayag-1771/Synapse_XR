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
          let isProcessing = false;
          const camera = new cameraModule.Camera(videoRef.current, {
            onFrame: async () => {
              if (videoRef.current && isMounted && !isProcessing) {
                isProcessing = true;
                try {
                  await hands.send({ image: videoRef.current });
                } finally {
                  isProcessing = false;
                }
              }
            },
            facingMode: "user", // Expert dashboard uses webcam / front camera
            width: 320,   // Low resolution for maximum ML performance
            height: 240,
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
          style={{ width: "100%", borderRadius: "8px" }}
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

  // --- Length Detection Feature (Thumb to Index Point) ---
  if (landmarks[4] && landmarks[8]) {
    const thumbX = landmarks[4].x * w;
    const thumbY = landmarks[4].y * h;
    const indexX = landmarks[8].x * w;
    const indexY = landmarks[8].y * h;

    // Calculate distance in pixels
    const dx = indexX - thumbX;
    const dy = indexY - thumbY;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);

    // Hardcode a scale: ~0.15 cm per pixel in this specific view/resolution
    // This is an arbitrary hardcoded value as requested
    const measuredLengthCm = (pixelDistance * 0.15).toFixed(1);

    // Calculate angle in degrees
    // We adjust by putting index relative to thumb and calculating atan2
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Normalize to 0-360 for display, or just show absolute depending on need. 
    // Absolute angle from horizontal is fine:
    angleDeg = Math.abs(angleDeg);

    // Draw a prominent dashed measurement line
    ctx.strokeStyle = "#ffeb3b"; // Bright yellow
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(thumbX, thumbY);
    ctx.lineTo(indexX, indexY);
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash

    // Draw the measurement text label
    const labelText = `${measuredLengthCm} cm, ${angleDeg.toFixed(1)}°`;
    ctx.font = "bold 14px monospace";
    const textMetrics = ctx.measureText(labelText);
    const textW = textMetrics.width;
    const midX = (thumbX + indexX) / 2;
    const midY = (thumbY + indexY) / 2;

    ctx.fillStyle = "#222";
    ctx.fillRect(midX + 5, midY - 15, textW + 10, 20);
    ctx.fillStyle = "#ffeb3b";
    ctx.fillText(labelText, midX + 10, midY);
  }
}
