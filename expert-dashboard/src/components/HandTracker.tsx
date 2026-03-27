"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

interface HandPayload {
  type: string;
  source: string;
  hand: string;
  landmarks: { x: number; y: number; z: number }[];
  timestamp: number;
}

export default function HandTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io("http://localhost:5000");
    socketRef.current = socket;

    async function setup() {
      // Dynamically import MediaPipe (no SSR)
      const handsModule = await import("@mediapipe/hands");
      const cameraModule = await import("@mediapipe/camera_utils");

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

        const landmarks = results.multiHandLandmarks[0];
        const handedness =
          results.multiHandedness?.[0]?.label || "Right";

        const payload: HandPayload = {
          type: "hand_data",
          source: "mediapipe",
          hand: handedness.toLowerCase(),
          landmarks: landmarks.map((lm: LandmarkPoint) => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
          })),
          timestamp: Date.now(),
        };

        socket.emit("hand:data", payload);
      });

      if (videoRef.current) {
        const camera = new cameraModule.Camera(videoRef.current, {
          onFrame: async () => {
            if (videoRef.current) {
              await hands.send({ image: videoRef.current });
            }
          },
          width: 640,
          height: 480,
        });
        camera.start();
      }
    }

    setup();

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "640px" }}>
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
        style={{ width: "100%", transform: "scaleX(-1)" }}
      />
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
