"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import ConsoleShell from "@/components/console-shell";
import { api, backendWsBaseUrl, Session, User } from "@/lib/api";
import { clearAuth, readAuth, writeAuth } from "@/lib/authStorage";
import type { LandmarkPoint } from "@/components/HandTracker";

const HandTracker = dynamic(() => import("@/components/HandTracker"), { ssr: false });

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17]
];
const FINGERTIPS = [4, 8, 12, 16, 20];

// YOLO detection class colors (BGR->RGB mapped)
const DETECTION_COLORS: Record<string, string> = {
  plc: "#ffa500",
  motor: "#0064ff",
  wire: "#00ffff",
  relay: "#ff4081",
  push_button: "#76ff03",
};

interface DetectedObject {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // x1, y1, x2, y2 normalised 0-1
}

interface AiDetectionPayload {
  sessionId?: string;
  objects: DetectedObject[];
  alerts: string[];
}

interface StepValidationPayload {
  sessionId?: string;
  currentStep: number;
  passed: boolean;
  message: string;
  detectedCounts?: Record<string, number>;
}

const STEP_LABELS = [
  { step: 0, name: "PLC Detection", icon: "🔲" },
  { step: 1, name: "Motor Check", icon: "⚙️" },
  { step: 2, name: "Wiring Verification", icon: "🔌" },
  { step: 3, name: "System Nominal", icon: "✅" },
];

function renderAROverlay(
  ctx: CanvasRenderingContext2D,
  hands: Map<string, LandmarkPoint[]>,
  detections: DetectedObject[],
  w: number,
  h: number
) {
  ctx.clearRect(0, 0, w, h);

  // Draw hand landmarks
  for (const [hand, landmarks] of hands.entries()) {
    if (!landmarks || landmarks.length < 21) continue;
    const color = hand === "left" ? "#00e5ff" : "#00ff88";
    const bgFill = hand === "left" ? "rgba(0,229,255,0.15)" : "rgba(0,255,136,0.15)";
    
    ctx.save();
    
    // Draw translucent holographic palm base
    const palmIndices = [0, 1, 5, 9, 13, 17];
    ctx.beginPath();
    ctx.moveTo(landmarks[palmIndices[0]].x * w, landmarks[palmIndices[0]].y * h);
    for (let i = 1; i < palmIndices.length; i++) {
      ctx.lineTo(landmarks[palmIndices[i]].x * w, landmarks[palmIndices[i]].y * h);
    }
    ctx.closePath();
    ctx.fillStyle = bgFill;
    ctx.fill();

    // Setup lines
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Draw thick colored outer glow lines
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    for (const [i, j] of HAND_CONNECTIONS) {
      ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
      ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
    }
    ctx.stroke();

    // Draw thin bright white inner core line (neon effect)
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 4;
    ctx.stroke();

    // Draw nodes
    ctx.shadowBlur = 8;
    for (let i = 0; i < landmarks.length; i++) {
      const isTip = FINGERTIPS.includes(i);
      const isKnuckle = [0, 5, 9, 13, 17].includes(i);
      const x = landmarks[i].x * w;
      const y = landmarks[i].y * h;

      if (isTip) {
        // Highlighting fingertip outer rings
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.beginPath();
      const radius = isTip ? 5 : (isKnuckle ? 4 : 2.5);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? "#ffffff" : color;
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw YOLO detection bounding boxes
  for (const det of detections) {
    const boxColor = DETECTION_COLORS[det.label] ?? "#ffffff";
    const x1 = det.bbox[0] * w;
    const y1 = det.bbox[1] * h;
    const x2 = det.bbox[2] * w;
    const y2 = det.bbox[3] * h;
    const bw = x2 - x1;
    const bh = y2 - y1;

    ctx.save();
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = boxColor;
    ctx.shadowBlur = 8;
    ctx.strokeRect(x1, y1, bw, bh);

    // Label background
    const labelText = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 13px monospace";
    const textMetrics = ctx.measureText(labelText);
    const labelPadX = 6;
    const labelPadY = 4;
    const labelH = 18;
    ctx.fillStyle = boxColor;
    ctx.shadowBlur = 0;
    ctx.fillRect(x1, y1 - labelH - labelPadY, textMetrics.width + labelPadX * 2, labelH + labelPadY);
    ctx.fillStyle = "#000";
    ctx.fillText(labelText, x1 + labelPadX, y1 - labelPadY - 2);
    ctx.restore();
  }
}

const formatTimestamp = (value: string | null): string => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

interface SessionRouteClientProps {
  sessionId: string;
}

interface SessionEventLogItem {
  id: string;
  eventName: string;
  timestamp: string;
}

interface ErrorBuckets {
  action: number;
  socket: number;
  server: number;
  health: number;
}

interface SessionParticipantPayload {
  userId?: string;
}

interface WebRtcSignalPayload {
  sessionId?: string;
  fromUserId?: string;
  toUserId?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

const MAX_EVENT_LOG_ITEMS = 24;
const MAX_PPS_HISTORY = 20;
const MAX_DETECTIONS_LOG = 12;
const WEBRTC_ICE_SERVERS: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

const getMediaErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Camera/microphone permission was denied. Allow access in your browser settings.";
    }

    if (error.name === "NotFoundError") {
      return "No camera or microphone was found on this device.";
    }

    if (error.name === "NotReadableError") {
      return "Camera is busy or unavailable. Close other apps using the camera and try again.";
    }

    if (error.name === "OverconstrainedError") {
      return "Current camera constraints are not supported on this device.";
    }

    if (error.name === "AbortError") {
      return "Camera initialization was interrupted. Try again.";
    }

    return error.message || "Unable to initialize camera/microphone.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to access camera or microphone.";
};

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export default function SessionRouteClient({ sessionId }: SessionRouteClientProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [latestGlove, setLatestGlove] = useState<Record<string, unknown> | null>(null);
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [socketId, setSocketId] = useState<string | null>(null);
  const [connectCount, setConnectCount] = useState(0);
  const [lastRealtimeAt, setLastRealtimeAt] = useState<string | null>(null);
  const [handPacketsPerSecond, setHandPacketsPerSecond] = useState(0);
  const [ppsHistory, setPpsHistory] = useState<number[]>([]);
  const [healthLatencyMs, setHealthLatencyMs] = useState<number | null>(null);
  const [avgHealthLatencyMs, setAvgHealthLatencyMs] = useState<number | null>(null);
  const [lastHealthProbeAt, setLastHealthProbeAt] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<string | null>(null);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [errorBuckets, setErrorBuckets] = useState<ErrorBuckets>({
    action: 0,
    socket: 0,
    server: 0,
    health: 0
  });
  const [eventLog, setEventLog] = useState<SessionEventLogItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [remotePeerUserId, setRemotePeerUserId] = useState<string | null>(null);
  const [webrtcStatus, setWebrtcStatus] = useState<"idle" | "ready" | "connecting" | "connected" | "error">("idle");
  const [webrtcError, setWebrtcError] = useState<string | null>(null);
  const [isHandTrackingActive, setIsHandTrackingActive] = useState(false);
  const [handTrackingStatus, setHandTrackingStatus] = useState<"loading" | "active" | "error" | "stopped">("stopped");
  const [handEmitCount, setHandEmitCount] = useState(0);

  // AI detection state
  const [detections, setDetections] = useState<DetectedObject[]>([]);
  const [detectionAlerts, setDetectionAlerts] = useState<string[]>([]);
  const [detectionCount, setDetectionCount] = useState(0);
  const [stepState, setStepState] = useState<StepValidationPayload>({
    currentStep: 0,
    passed: false,
    message: "Waiting for detection feed…",
  });

  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // AR View refs
  const arVideoRef = useRef<HTMLVideoElement | null>(null);
  const arCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const arVideoRefRight = useRef<HTMLVideoElement | null>(null);
  const arCanvasRefRight = useRef<HTMLCanvasElement | null>(null);
  const handLandmarksRef = useRef<Map<string, LandmarkPoint[]>>(new Map());
  const handTimestampsRef = useRef<Map<string, number>>(new Map());
  const detectionsRef = useRef<DetectedObject[]>([]);
  const [hasARVideo, setHasARVideo] = useState(false);
  const [isVrMode, setIsVrMode] = useState(false);
  const arContainerRef = useRef<HTMLElement | null>(null);

  const isExpert = user?.role === "expert";
  const isWorker = user?.role === "worker";

  const reconnectCount = Math.max(0, connectCount - 1);

  const captureError = useCallback((bucket: keyof ErrorBuckets, nextErrorMessage: string) => {
    const nowIso = new Date().toISOString();
    setError(nextErrorMessage);
    setLastErrorMessage(nextErrorMessage);
    setLastErrorAt(nowIso);
    setErrorBuckets((current) => ({
      ...current,
      [bucket]: current[bucket] + 1
    }));
  }, []);

  const pushEventLog = useCallback((eventName: string) => {
    const nowIso = new Date().toISOString();

    setLastRealtimeAt(nowIso);
    setEventLog((current) => {
      const next: SessionEventLogItem = {
        id: `${nowIso}-${eventName}`,
        eventName,
        timestamp: nowIso
      };
      return [next, ...current].slice(0, MAX_EVENT_LOG_ITEMS);
    });
  }, []);

  const getOtherParticipantId = useCallback(
    (currentSession: Session | null, currentUser: User | null): string | null => {
      if (!currentSession || !currentUser) {
        return null;
      }

      const nextPeer = currentSession.participants.find((participantId) => participantId !== currentUser.id);
      return nextPeer ?? null;
    },
    []
  );

  const shouldInitiateOffer = useCallback((currentUserId: string, targetUserId: string): boolean => {
    return currentUserId.localeCompare(targetUserId) < 0;
  }, []);

  const stopPeerConnection = useCallback(() => {
    const peer = peerConnectionRef.current;
    if (peer) {
      peer.close();
      peerConnectionRef.current = null;
    }

    pendingIceCandidatesRef.current = [];

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  const stopLocalMedia = useCallback(() => {
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setWebrtcStatus("idle");
  }, []);

  const sendIceCandidate = useCallback(
    (candidate: RTCIceCandidateInit) => {
      const socket = socketRef.current;
      const currentUser = user;
      if (!socket || !currentUser) {
        return;
      }

      socket.emit("webrtc:ice", {
        sessionId,
        fromUserId: currentUser.id,
        toUserId: remotePeerUserId ?? undefined,
        candidate
      } satisfies WebRtcSignalPayload);
    },
    [remotePeerUserId, sessionId, user]
  );

  const ensureLocalMedia = useCallback(async (): Promise<MediaStream> => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const message = "This browser does not support media capture APIs.";
      setWebrtcError(message);
      setWebrtcStatus("error");
      throw new Error(message);
    }

    setWebrtcError(null);
    setWebrtcStatus("connecting");

    const attempts: MediaStreamConstraints[] = [
      {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: { ideal: "environment" }
        },
        audio: true
      },
      {
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: true
      },
      {
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      }
    ];

    let lastMediaError: unknown = null;

    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        setWebrtcStatus("ready");
        return stream;
      } catch (mediaError) {
        lastMediaError = mediaError;
      }
    }

    const message = getMediaErrorMessage(lastMediaError);
    setWebrtcError(message);
    setWebrtcStatus("error");
    throw new Error(message);
  }, []);

  const ensurePeerConnection = useCallback(async (): Promise<RTCPeerConnection> => {
    const existing = peerConnectionRef.current;
    if (existing) {
      return existing;
    }

    const peer = new RTCPeerConnection({ iceServers: WEBRTC_ICE_SERVERS });

    // Experts are receive-only (they don't share their camera via WebRTC)
    // Workers share their camera feed
    let stream = localStreamRef.current;
    if (!stream && user?.role !== "expert") {
      try {
        stream = await ensureLocalMedia();
      } catch {
        stream = null;
      }
    }

    if (stream) {
      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
      }
    } else {
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      if (user?.role !== "expert") {
        setWebrtcError((current) => current ?? "Local camera failed to start. Continuing in receive-only mode.");
      }
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate(event.candidate.toJSON());
      }
    };

    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        // Set the AR view for expert (remote = worker's camera)
        if (arVideoRef.current && user?.role === "expert") {
          arVideoRef.current.srcObject = remoteStream;
          setHasARVideo(true);
        }
      }
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === "connected") {
        setWebrtcStatus("connected");
        setWebrtcError(null);
        return;
      }

      if (state === "connecting") {
        setWebrtcStatus("connecting");
        return;
      }

      if (state === "failed" || state === "disconnected") {
        setWebrtcStatus("error");
        setWebrtcError(`Peer connection ${state}.`);
      }
    };

    peerConnectionRef.current = peer;
    return peer;
  }, [ensureLocalMedia, sendIceCandidate, user?.role]);

  const maybeStartOffer = useCallback(async () => {
    if (!user || !remotePeerUserId) {
      return;
    }

    if (!shouldInitiateOffer(user.id, remotePeerUserId)) {
      return;
    }

    try {
      const peer = await ensurePeerConnection();
      if (peer.signalingState !== "stable") {
        return;
      }

      setWebrtcStatus("connecting");
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const socket = socketRef.current;
      if (!socket) {
        return;
      }

      socket.emit("webrtc:offer", {
        sessionId,
        fromUserId: user.id,
        toUserId: remotePeerUserId ?? undefined,
        sdp: offer
      } satisfies WebRtcSignalPayload);

      pushEventLog("webrtc:offer");
    } catch (offerError) {
      const message = offerError instanceof Error ? offerError.message : "Failed to create WebRTC offer.";
      setWebrtcStatus("error");
      setWebrtcError(message);
      captureError("socket", message);
    }
  }, [captureError, ensurePeerConnection, pushEventLog, remotePeerUserId, sessionId, shouldInitiateOffer, user]);

  const withAction = useCallback(async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await action();
    } catch (actionError) {
      captureError("action", actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setIsBusy(false);
    }
  }, [captureError]);

  const refreshSession = useCallback(async (activeToken: string) => {
    try {
      const response = await api.getSession(sessionId, activeToken);
      setSession(response.session);
    } catch (sessionError) {
      const message = sessionError instanceof Error ? sessionError.message : "Unable to load session.";

      if (message.toLowerCase() !== "forbidden") {
        throw sessionError;
      }

      const joinedSession = await api.joinSession(sessionId, activeToken);
      setSession(joinedSession.session);
      setMessage("Joined session automatically.");
    }
  }, [sessionId]);

  useEffect(() => {
    const stored = readAuth();
    if (!stored) {
      router.replace("/auth");
      return;
    }

    setToken(stored.token);
    setUser(stored.user);

    void withAction(async () => {
      const me = await api.me(stored.token);
      setUser(me.user);
      writeAuth({ token: stored.token, user: me.user });
      await refreshSession(stored.token);
    });
  }, [refreshSession, router, withAction]);

  useEffect(() => {
    if (!user) {
      return;
    }

    setConnectionState("connecting");

    const socket: Socket = io(backendWsBaseUrl, {
      transports: ["websocket"],
      reconnection: true,
      timeout: 7000,
      auth: { token }
    });
    socketRef.current = socket;

    let packetCount = 0;
    const ppsInterval = window.setInterval(() => {
      setHandPacketsPerSecond(packetCount);
      setPpsHistory((current) => [...current.slice(-MAX_PPS_HISTORY + 1), packetCount]);
      packetCount = 0;
    }, 1000);

    const registerJoin = () => {
      socket.emit("session:join", {
        sessionId
      });
    };

    socket.on("connect", () => {
      setConnectionState("connected");
      setSocketId(socket.id ?? null);
      setConnectCount((value) => value + 1);
      pushEventLog("socket:connected");
      registerJoin();
    });

    socket.on("disconnect", () => {
      setConnectionState("disconnected");
      setSocketId(null);
      pushEventLog("socket:disconnected");
    });

    socket.on("connect_error", (connectError: Error) => {
      setConnectionState("error");
      setSocketId(null);
      pushEventLog("socket:error");
      captureError("socket", connectError.message || "Socket connection failed.");
    });

    socket.on("hand:data", (payload: Record<string, unknown>) => {
      packetCount += 1;
      setLatestGlove(payload);
      pushEventLog("hand:data");

      // Update hand overlay for the AR view (worker receives expert's hand data)
      const landmarks = payload.landmarks as LandmarkPoint[] | undefined;
      const hand = (payload.hand as string) || "right";
      if (landmarks && landmarks.length === 21) {
        handLandmarksRef.current.set(hand, landmarks);
        handTimestampsRef.current.set(hand, Date.now());
      }
    });

    socket.on("gesture:detected", () => {
      pushEventLog("gesture:detected");
    });

    socket.on("annotation:update", () => {
      pushEventLog("annotation:update");
    });

    socket.on("ai:detection", (payload: AiDetectionPayload) => {
      pushEventLog("ai:detection");
      const objs = Array.isArray(payload.objects) ? payload.objects : [];
      setDetections(objs);
      detectionsRef.current = objs;
      setDetectionCount((c) => c + 1);
      if (Array.isArray(payload.alerts) && payload.alerts.length > 0) {
        setDetectionAlerts(payload.alerts);
      }
    });

    socket.on("ai:step-validation", (payload: StepValidationPayload) => {
      pushEventLog("ai:step-validation");
      setStepState(payload);
    });

    socket.on("session:participant-joined", () => {
      pushEventLog("session:participant-joined");
      void refreshSession(token).catch(() => {
        // Ignore refresh errors for passive realtime updates.
      });
    });

    socket.on("session:participant-joined", (payload: SessionParticipantPayload) => {
      if (payload.userId && payload.userId !== user.id) {
        setRemotePeerUserId(payload.userId);
      }
    });

    socket.on("session:participant-left", () => {
      pushEventLog("session:participant-left");
      stopPeerConnection();
      setRemotePeerUserId(null);
      setWebrtcStatus(localStreamRef.current ? "ready" : "idle");
      void refreshSession(token).catch(() => {
        // Ignore refresh errors for passive realtime updates.
      });
    });

    socket.on("webrtc:offer", async (payload: WebRtcSignalPayload) => {
      if (!user || payload.fromUserId === user.id || !payload.sdp) {
        return;
      }

      if (payload.toUserId && payload.toUserId !== user.id) {
        return;
      }

      try {
        setRemotePeerUserId(payload.fromUserId ?? null);
        const peer = await ensurePeerConnection();

        if (peer.signalingState !== "stable") {
          await peer.setLocalDescription({ type: "rollback" });
        }

        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));

        if (pendingIceCandidatesRef.current.length > 0) {
          const pendingCandidates = [...pendingIceCandidatesRef.current];
          pendingIceCandidatesRef.current = [];
          await Promise.all(pendingCandidates.map((candidate) => peer.addIceCandidate(candidate)));
        }

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("webrtc:answer", {
          sessionId,
          fromUserId: user.id,
          toUserId: payload.fromUserId,
          sdp: answer
        } satisfies WebRtcSignalPayload);

        setWebrtcStatus("connecting");
        pushEventLog("webrtc:answer");
      } catch (offerError) {
        const message = offerError instanceof Error ? offerError.message : "Failed to handle WebRTC offer.";
        setWebrtcStatus("error");
        setWebrtcError(message);
        captureError("socket", message);
      }
    });

    socket.on("webrtc:answer", async (payload: WebRtcSignalPayload) => {
      if (!user || payload.fromUserId === user.id || !payload.sdp) {
        return;
      }

      if (payload.toUserId && payload.toUserId !== user.id) {
        return;
      }

      try {
        const peer = peerConnectionRef.current;
        if (!peer) {
          return;
        }

        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        setWebrtcStatus("connecting");
        pushEventLog("webrtc:answer:received");
      } catch (answerError) {
        const message = answerError instanceof Error ? answerError.message : "Failed to handle WebRTC answer.";
        setWebrtcStatus("error");
        setWebrtcError(message);
        captureError("socket", message);
      }
    });

    socket.on("webrtc:ice", async (payload: WebRtcSignalPayload) => {
      if (!user || payload.fromUserId === user.id || !payload.candidate) {
        return;
      }

      if (payload.toUserId && payload.toUserId !== user.id) {
        return;
      }

      try {
        const peer = peerConnectionRef.current;
        if (!peer || !peer.remoteDescription) {
          pendingIceCandidatesRef.current.push(payload.candidate);
          return;
        }

        await peer.addIceCandidate(payload.candidate);
      } catch (iceError) {
        const message = iceError instanceof Error ? iceError.message : "Failed to add ICE candidate.";
        setWebrtcStatus("error");
        setWebrtcError(message);
        captureError("socket", message);
      }
    });

    socket.on("session:end", () => {
      pushEventLog("session:end");
      void refreshSession(token).catch(() => {
        // Ignore refresh errors for passive realtime updates.
      });
    });

    socket.on("error:event", (payload: { event?: string; message?: string }) => {
      const eventName = payload.event ? `error:${payload.event}` : "error:event";
      pushEventLog(eventName);
      if (payload.message) {
        captureError("server", payload.message);
      }
    });

    return () => {
      window.clearInterval(ppsInterval);
      socket.disconnect();
      socketRef.current = null;
      stopPeerConnection();
      setConnectionState("disconnected");
      setSocketId(null);
      setHandPacketsPerSecond(0);
    };
  }, [
    captureError,
    ensurePeerConnection,
    pushEventLog,
    refreshSession,
    sessionId,
    stopPeerConnection,
    token,
    user
  ]);

  useEffect(() => {
    setRemotePeerUserId(getOtherParticipantId(session, user));
  }, [getOtherParticipantId, session, user]);

  useEffect(() => {
    if (!remotePeerUserId || !localStreamRef.current) {
      return;
    }

    void maybeStartOffer();
  }, [maybeStartOffer, remotePeerUserId]);

  useEffect(() => {
    return () => {
      stopPeerConnection();
      stopLocalMedia();
    };
  }, [stopLocalMedia, stopPeerConnection]);

  const toggleVRFullscreen = async () => {
    if (!document.fullscreenElement) {
      if (arContainerRef.current?.requestFullscreen) {
        try {
          await arContainerRef.current.requestFullscreen();
        } catch (e) {
          console.warn("Fullscreen error", e);
        }
      }
      setIsVrMode(true);
      if ((window.screen?.orientation as any)?.lock) {
        try {
          await (window.screen.orientation as any).lock("landscape");
        } catch (e) {
          console.warn("Orientation lock error", e);
        }
      }
    } else {
      if (document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch (e) {
          console.warn("Exit fullscreen error", e);
        }
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIsVrMode(false);
        if ((window.screen?.orientation as any)?.unlock) {
          try {
            (window.screen.orientation as any).unlock();
          } catch(e) {}
        }
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Sync right video feed in VR mode
  useEffect(() => {
    if (isVrMode && arVideoRefRight.current && arVideoRef.current) {
      if (arVideoRefRight.current.srcObject !== arVideoRef.current.srcObject) {
        arVideoRefRight.current.srcObject = arVideoRef.current.srcObject;
      }
    } else if (!isVrMode && arVideoRefRight.current) {
      arVideoRefRight.current.srcObject = null;
    }
  }, [isVrMode, hasARVideo]);

  // Expert: callback from HandTracker — update overlay landmarks immediately
  const handleLandmarks = useCallback((landmarks: LandmarkPoint[], hand: string) => {
    handLandmarksRef.current.set(hand, landmarks);
    handTimestampsRef.current.set(hand, Date.now());
  }, []);

  // RAF render loop for AR canvas overlay (hands + YOLO bounding boxes)
  useEffect(() => {
    let animId: number;
    const HAND_TIMEOUT = 2000;
    const render = () => {
      const canvas = arCanvasRef.current;
      const video = arVideoRef.current;
      if (canvas && video && video.videoWidth > 0) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        // Expire stale hands
        const now = Date.now();
        for (const [hand, ts] of handTimestampsRef.current.entries()) {
          if (now - ts > HAND_TIMEOUT) {
            handLandmarksRef.current.delete(hand);
            handTimestampsRef.current.delete(hand);
          }
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          renderAROverlay(ctx, handLandmarksRef.current, detectionsRef.current, canvas.width, canvas.height);
        }

        const canvasRight = arCanvasRefRight.current;
        const videoRight = arVideoRefRight.current;
        if (canvasRight && videoRight && videoRight.videoWidth > 0) {
          if (canvasRight.width !== videoRight.videoWidth || canvasRight.height !== videoRight.videoHeight) {
            canvasRight.width = videoRight.videoWidth;
            canvasRight.height = videoRight.videoHeight;
          }
          const ctxRight = canvasRight.getContext("2d");
          if (ctxRight) {
             renderAROverlay(ctxRight, handLandmarksRef.current, detectionsRef.current, canvasRight.width, canvasRight.height);
          }
        }
      }
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    let isDisposed = false;
    const latencyHistory: number[] = [];

    const runProbe = async () => {
      const probeStartedAt = performance.now();

      try {
        await api.health();
        const latency = Math.round(performance.now() - probeStartedAt);

        if (isDisposed) {
          return;
        }

        latencyHistory.push(latency);
        if (latencyHistory.length > 6) {
          latencyHistory.shift();
        }

        setHealthLatencyMs(latency);
        setAvgHealthLatencyMs(Math.round(average(latencyHistory)));
        setLastHealthProbeAt(new Date().toISOString());
      } catch {
        if (isDisposed) {
          return;
        }

        captureError("health", "Health probe failed.");
      }
    };

    void runProbe();
    const probeInterval = window.setInterval(() => {
      void runProbe();
    }, 10000);

    return () => {
      isDisposed = true;
      window.clearInterval(probeInterval);
    };
  }, [captureError, token]);

  const runJoin = async () => {
    if (!token) {
      return;
    }

    await withAction(async () => {
      const response = await api.joinSession(sessionId, token);
      setSession(response.session);
      setMessage("Joined session.");
    });
  };

  const runLeave = async () => {
    if (!token) {
      return;
    }

    await withAction(async () => {
      const response = await api.leaveSession(sessionId, token);
      setSession(response.session);
      setMessage("Left session.");
    });
  };

  const runEnd = async () => {
    if (!token) {
      return;
    }

    await withAction(async () => {
      const response = await api.endSession(sessionId, token);
      setSession(response.session);
      setMessage("Session ended.");
    });
  };

  const runLatestGlove = async () => {
    if (!token) {
      return;
    }

    await withAction(async () => {
      const response = await api.getLatestGlove(sessionId, token);
      setLatestGlove(response.latest);
      setMessage(response.latest ? "Fetched latest glove state." : "No glove state found yet.");
    });
  };

  const runRefresh = async () => {
    if (!token) {
      return;
    }

    await withAction(async () => {
      await refreshSession(token);
      setMessage("Session refreshed.");
    });
  };

  const signOut = () => {
    clearAuth();
    router.replace("/auth");
  };

  const runStartWorkerCamera = async () => {
    await withAction(async () => {
      const stream = await ensureLocalMedia();
      // Set AR view for worker (local = own camera)
      if (arVideoRef.current) {
        arVideoRef.current.srcObject = stream;
        setHasARVideo(true);
      }
      setMessage("Camera streaming.");
      if (remotePeerUserId) {
        await maybeStartOffer();
      }
    });
  };

  const runStopVideo = async () => {
    await withAction(async () => {
      stopPeerConnection();
      stopLocalMedia();
      setHasARVideo(false);
      setWebrtcError(null);
      setMessage("Video stopped.");
    });
  };

  return (
    <ConsoleShell
      title="Session Control"
      subtitle="Session-level controls for expert guidance. This route is intended for active troubleshooting and fallback operation while Unity clients run the immersive experience."
    >
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Session {sessionId}</h2>
            <Link className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5" href="/dashboard">
              Back
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50" onClick={runRefresh} disabled={isBusy}>
              Refresh
            </button>
            <button className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50" onClick={runJoin} disabled={isBusy}>
              Join
            </button>
            <button className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50" onClick={runLeave} disabled={isBusy}>
              Leave
            </button>
            <button className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50" onClick={runEnd} disabled={isBusy}>
              End
            </button>
            <button className="col-span-2 rounded-xl bg-black px-3 py-2 text-sm text-white transition hover:bg-black/80 disabled:opacity-50" onClick={runLatestGlove} disabled={isBusy}>
              Fetch latest glove
            </button>
          </div>

          <button
            className="mt-3 rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5"
            onClick={signOut}
          >
            Sign out
          </button>

          {(error || message) && (
            <p className={`mt-3 text-sm ${error ? "text-red-700" : "text-emerald-700"}`}>{error ?? message}</p>
          )}
        </article>

        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Session Snapshot</h2>
          {session ? (
            <pre className="mt-3 overflow-auto rounded-xl bg-zinc-950 p-3 text-xs text-zinc-100">
              {JSON.stringify(
                {
                  id: session.id,
                  status: session.status,
                  createdBy: session.createdBy,
                  createdAt: formatTimestamp(session.createdAt),
                  endedAt: formatTimestamp(session.endedAt),
                  participants: session.participants
                },
                null,
                2
              )}
            </pre>
          ) : (
            <p className="mt-3 text-sm text-black/70">Loading session...</p>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5">
        <h2 className="text-lg font-medium">Latest Glove State</h2>
        {latestGlove ? (
          <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-zinc-950 p-3 text-xs text-zinc-100">
            {JSON.stringify(latestGlove, null, 2)}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-black/70">No glove payload fetched yet.</p>
        )}
      </section>

      {/* ═══ LIVE AR VIEW ═══ */}
      <section ref={arContainerRef} className={`rounded-2xl overflow-hidden border border-black/10 bg-black ${isVrMode ? "border-none rounded-none" : ""}`}>
        <div className={`relative w-full ${isVrMode ? "flex h-screen items-center justify-center gap-[6px] md:gap-2 bg-black px-2 md:px-6" : ""}`} style={{ aspectRatio: isVrMode ? "auto" : "16/9", minHeight: isVrMode ? "100vh" : "" }}>
          
          {/* VR Middle alignment line */}
          {isVrMode && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[2px] h-[30vh] bg-white/70 z-50 pointer-events-none rounded-t-full" />
          )}

          <div className={`relative ${isVrMode ? "flex-1 aspect-[4/3] max-h-[95vh] max-w-[48vw] overflow-hidden rounded-[15%]" : "w-full h-full"}`}>
            {/* Primary video: worker camera (local for worker, remote for expert) */}
            <video
              ref={arVideoRef}
              autoPlay
              playsInline
              muted={isWorker}
              className={`absolute inset-0 w-full h-full object-cover origin-center ${isVrMode ? "scale-[1.15] translate-x-[5%]" : ""}`}
            />
            {/* Hand overlay canvas */}
            <canvas
              ref={arCanvasRef}
              className={`absolute inset-0 w-full h-full pointer-events-none origin-center ${isVrMode ? "scale-[1.15] translate-x-[5%]" : ""}`}
            />
            {/* Left Eye Vignette/Fishbowl Overlay */}
            {isVrMode && (
              <div 
                className="absolute inset-0 z-10 pointer-events-none shadow-[inset_0_0_40px_rgba(0,0,0,1)]" 
                style={{ background: 'radial-gradient(ellipse, transparent 40%, rgba(0,0,0,0.85) 75%, black 100%)' }} 
              />
            )}
          </div>

          {/* Right VR eye */}
          {isVrMode && (
            <div className="relative flex-1 aspect-[4/3] max-h-[95vh] max-w-[48vw] overflow-hidden rounded-[15%]">
              <video
                ref={arVideoRefRight}
                autoPlay
                playsInline
                muted={true}
                className="absolute inset-0 w-full h-full object-cover origin-center scale-[1.15] -translate-x-[5%]"
              />
              <canvas
                ref={arCanvasRefRight}
                className="absolute inset-0 w-full h-full pointer-events-none origin-center scale-[1.15] -translate-x-[5%]"
              />
              <div 
                className="absolute inset-0 z-10 pointer-events-none shadow-[inset_0_0_40px_rgba(0,0,0,1)]" 
                style={{ background: 'radial-gradient(ellipse, transparent 40%, rgba(0,0,0,0.85) 75%, black 100%)' }} 
              />
            </div>
          )}

          {/* Hidden video refs for WebRTC wiring */}
          <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
          <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

          {/* VR Overlay Controls */}
          {isVrMode && (
            <>
              {/* Close VR button */}
              <button 
                onClick={toggleVRFullscreen} 
                className="absolute top-4 left-4 z-50 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                title="Exit VR"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>

            </>
          )}

          {/* Expert's hand tracking PiP */}
          {isHandTrackingActive && isExpert && socketRef.current && (
            <div className="absolute bottom-3 right-3 w-40 rounded-lg overflow-hidden border-2 border-cyan-400/40 shadow-xl shadow-cyan-500/20 bg-black/60">
              <HandTracker
                socket={socketRef.current}
                sessionId={sessionId}
                onLandmarks={handleLandmarks}
                onHandData={() => setHandEmitCount((c) => c + 1)}
                onStatusChange={setHandTrackingStatus}
                showPreview={true}
              />
            </div>
          )}

          {/* HUD overlay */}
          <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur-sm px-3 py-2">
            <div className={`w-2 h-2 rounded-full ${connectionState === "connected" ? "bg-green-400 shadow-green-400/50 shadow-sm" : connectionState === "error" ? "bg-red-400" : "bg-amber-400 animate-pulse"}`} />
            <span className="text-xs text-white/80 font-mono">{connectionState}</span>
            {webrtcStatus === "connected" && <span className="text-xs text-cyan-300/80 font-mono">• WebRTC</span>}
            {handPacketsPerSecond > 0 && <span className="text-xs text-green-300/80 font-mono">• {handPacketsPerSecond} pps</span>}
            {detections.length > 0 && <span className="text-xs text-orange-300/80 font-mono">• {detections.length} obj</span>}
            {stepState.currentStep > 0 && <span className={`text-xs font-mono ${stepState.currentStep >= 3 ? "text-emerald-300/80" : "text-amber-300/80"}`}>• Step {stepState.currentStep}/3</span>}
          </div>

          {isHandTrackingActive && isExpert && (
            <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg bg-black/60 backdrop-blur-sm px-3 py-2">
              <div className={`w-2 h-2 rounded-full ${handTrackingStatus === "active" ? "bg-cyan-400 animate-pulse" : "bg-gray-400"}`} />
              <span className="text-xs text-white/80 font-mono">Tracking {handTrackingStatus}</span>
              <span className="text-xs text-white/50 font-mono">| {handEmitCount} sent</span>
            </div>
          )}

          {/* Waiting state */}
          {!hasARVideo && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
              <div className="w-12 h-12 rounded-full border-2 border-white/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-white/50 text-sm">
                {isWorker ? "Click below to start your camera" : "Waiting for worker to start camera..."}
              </p>
            </div>
          )}
        </div>

        {/* Control bar */}
        <div className={`flex flex-wrap items-center gap-2 md:gap-3 px-3 md:px-4 py-3 bg-zinc-950 ${isVrMode ? "hidden" : ""}`}>
          {isWorker && (
            <button
              className="rounded-lg bg-cyan-500 px-3 md:px-4 py-2 text-xs font-semibold text-black transition hover:bg-cyan-400 disabled:opacity-50 flex-1 md:flex-none"
              onClick={runStartWorkerCamera}
              disabled={Boolean(isBusy || hasARVideo)}
            >
              {hasARVideo ? "Camera Active" : "Start Camera"}
            </button>
          )}
          {isExpert && (
            <button
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition disabled:opacity-50 flex-1 md:flex-none ${isHandTrackingActive ? "bg-red-500/80 text-white hover:bg-red-500" : "bg-cyan-500 text-black hover:bg-cyan-400"}`}
              onClick={() => setIsHandTrackingActive(!isHandTrackingActive)}
              disabled={connectionState !== "connected"}
            >
              {isHandTrackingActive ? "Stop Tracking" : "Start Tracking"}
            </button>
          )}
          <button
            className="rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 px-3 md:px-4 py-2 text-xs font-semibold transition flex-1 md:flex-none max-w-[200px]"
            onClick={toggleVRFullscreen}
          >
            Enter VR Fullscreen
          </button>
          <button
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 transition hover:bg-white/5 disabled:opacity-50"
            onClick={runStopVideo}
            disabled={isBusy}
          >
            Stop
          </button>
          <div className="flex-1" />
          <span className="text-xs text-white/30 font-mono">
            WebRTC: {webrtcStatus} {remotePeerUserId ? `| Peer: ${remotePeerUserId.slice(0, 8)}…` : ""}
          </span>
        </div>
        {webrtcError && <p className="px-4 py-2 text-xs text-red-400 bg-zinc-950">{webrtcError}</p>}
      </section>

      {/* ═══ AI DETECTION & STEP VALIDATION ═══ */}
      <section className="grid gap-4 md:grid-cols-2">

        {/* Detection Feed */}
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">YOLO Detection Feed</h2>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-mono text-black/60">
              {detectionCount} frames
            </span>
          </div>

          {detections.length > 0 ? (
            <ul className="mt-3 grid gap-2">
              {detections.map((det, idx) => {
                const barColor = DETECTION_COLORS[det.label] ?? "#888";
                return (
                  <li key={`det-${idx}-${det.label}`} className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2">
                    <div
                      className="h-3 w-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: barColor, boxShadow: `0 0 6px ${barColor}` }}
                    />
                    <span className="flex-1 text-sm font-medium text-black">{det.label}</span>
                    <div className="w-24 h-2 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${(det.confidence * 100).toFixed(0)}%`, backgroundColor: barColor }}
                      />
                    </div>
                    <span className="text-xs font-mono text-black/50 w-10 text-right">
                      {(det.confidence * 100).toFixed(0)}%
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-black/50">No detections received yet. Waiting for worker&apos;s YOLO feed…</p>
          )}

          {detectionAlerts.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">⚠ Alerts</p>
              <ul className="mt-1 grid gap-1">
                {detectionAlerts.map((alert, idx) => (
                  <li key={`alert-${idx}`} className="text-sm text-amber-800">{alert}</li>
                ))}
              </ul>
            </div>
          )}
        </article>

        {/* Step Validation Panel */}
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Repair Step Validation</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
              stepState.currentStep >= 3
                ? "bg-emerald-100 text-emerald-700"
                : stepState.passed
                  ? "bg-blue-100 text-blue-700"
                  : "bg-amber-100 text-amber-700"
            }`}>
              {stepState.currentStep >= 3 ? "COMPLETE" : stepState.passed ? "STEP PASSED" : "IN PROGRESS"}
            </span>
          </div>

          {/* Step progress */}
          <div className="mt-4 flex items-center gap-1">
            {STEP_LABELS.map((s) => {
              const isActive = stepState.currentStep === s.step;
              const isDone = stepState.currentStep > s.step;
              return (
                <div key={s.step} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full h-2 rounded-full transition-all duration-500 ${
                    isDone
                      ? "bg-emerald-400"
                      : isActive
                        ? stepState.passed ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                        : "bg-zinc-200"
                  }`} />
                  <span className="text-xs">{s.icon}</span>
                  <span className={`text-[10px] font-medium ${
                    isActive ? "text-black" : isDone ? "text-emerald-600" : "text-black/40"
                  }`}>{s.name}</span>
                </div>
              );
            })}
          </div>

          {/* Current message */}
          <div className={`mt-4 rounded-xl p-3 text-sm font-medium ${
            stepState.currentStep >= 3
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : stepState.passed
                ? "bg-blue-50 text-blue-800 border border-blue-200"
                : "bg-zinc-50 text-zinc-700 border border-zinc-200"
          }`}>
            {stepState.message}
          </div>

          {/* Component counts from latest step validation */}
          {stepState.detectedCounts && (
            <div className="mt-3 grid grid-cols-5 gap-1">
              {Object.entries(stepState.detectedCounts).map(([component, count]) => (
                <div key={component} className="flex flex-col items-center rounded-lg bg-zinc-50 px-1 py-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full mb-1"
                    style={{ backgroundColor: DETECTION_COLORS[component] ?? "#888" }}
                  />
                  <span className="text-xs font-medium text-black">{count}</span>
                  <span className="text-[9px] text-black/50 text-center leading-tight">{component.replace("_", " ")}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-2">

        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Realtime Stream</h2>
          <div className="mt-3 grid gap-2 text-sm text-black/70">
            <p>
              Status:{" "}
              <span
                className={`font-medium ${
                  connectionState === "connected"
                    ? "text-emerald-700"
                    : connectionState === "error"
                      ? "text-red-700"
                      : "text-amber-700"
                }`}
              >
                {connectionState}
              </span>
            </p>
            <p>Socket ID: {socketId ?? "-"}</p>
            <p>Reconnects: {reconnectCount}</p>
            <p>Hand packets/sec: {handPacketsPerSecond}</p>
            <p>Last realtime event: {formatTimestamp(lastRealtimeAt)}</p>
            <p>Health latency: {healthLatencyMs !== null ? `${healthLatencyMs} ms` : "-"}</p>
            <p>Avg health latency: {avgHealthLatencyMs !== null ? `${avgHealthLatencyMs} ms` : "-"}</p>
            <p>Last health probe: {formatTimestamp(lastHealthProbeAt)}</p>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 p-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-black/60">Packet Throughput History</p>
            <div className="mt-2 flex h-16 items-end gap-1">
              {ppsHistory.length > 0 ? (
                ppsHistory.map((value, index) => {
                  const normalizedHeight = Math.max(8, Math.min(56, value * 3));
                  return (
                    <div
                      key={`pps-${index}`}
                      className="w-2 rounded-t bg-black/70"
                      style={{ height: `${normalizedHeight}px` }}
                      title={`${value} packets/sec`}
                    />
                  );
                })
              ) : (
                <p className="text-xs text-black/50">No samples yet.</p>
              )}
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Realtime Event Log</h2>
          {eventLog.length > 0 ? (
            <ul className="mt-3 max-h-48 overflow-auto rounded-xl border border-black/10">
              {eventLog.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between border-b border-black/10 px-3 py-2 text-xs last:border-none">
                  <span className="font-medium text-black">{entry.eventName}</span>
                  <span className="text-black/60">{formatTimestamp(entry.timestamp)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-black/70">No events captured yet.</p>
          )}

          <div className="mt-4 rounded-xl border border-black/10 p-3 text-sm text-black/70">
            <h3 className="font-medium text-black">Error State</h3>
            <p className="mt-2">Last error: {lastErrorMessage ?? "-"}</p>
            <p>Last error at: {formatTimestamp(lastErrorAt)}</p>
            <p className="mt-2">Action errors: {errorBuckets.action}</p>
            <p>Socket errors: {errorBuckets.socket}</p>
            <p>Server event errors: {errorBuckets.server}</p>
            <p>Health probe errors: {errorBuckets.health}</p>
          </div>
        </article>
      </section>
    </ConsoleShell>
  );
}
