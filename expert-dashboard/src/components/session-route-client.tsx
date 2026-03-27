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

function renderHandOverlay(
  ctx: CanvasRenderingContext2D,
  hands: Map<string, LandmarkPoint[]>,
  w: number,
  h: number
) {
  ctx.clearRect(0, 0, w, h);
  for (const [hand, landmarks] of hands.entries()) {
    if (!landmarks || landmarks.length < 21) continue;
    const color = hand === "left" ? "rgba(0,229,255,0.85)" : "rgba(0,255,136,0.85)";
    const glow = hand === "left" ? "#00e5ff" : "#00ff88";
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.shadowColor = glow;
    ctx.shadowBlur = 14;
    for (const [i, j] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(landmarks[i].x * w, landmarks[i].y * h);
      ctx.lineTo(landmarks[j].x * w, landmarks[j].y * h);
      ctx.stroke();
    }
    ctx.shadowBlur = 8;
    for (let i = 0; i < landmarks.length; i++) {
      const isTip = FINGERTIPS.includes(i);
      ctx.beginPath();
      ctx.arc(landmarks[i].x * w, landmarks[i].y * h, isTip ? 7 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? "rgba(255,255,255,0.95)" : color;
      ctx.fill();
    }
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

  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // AR View refs
  const arVideoRef = useRef<HTMLVideoElement | null>(null);
  const arCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handLandmarksRef = useRef<Map<string, LandmarkPoint[]>>(new Map());
  const handTimestampsRef = useRef<Map<string, number>>(new Map());
  const [hasARVideo, setHasARVideo] = useState(false);

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
          frameRate: { ideal: 30, max: 30 }
        },
        audio: true
      },
      {
        video: true,
        audio: true
      },
      {
        video: true,
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

  // Expert: callback from HandTracker — update overlay landmarks immediately
  const handleLandmarks = useCallback((landmarks: LandmarkPoint[], hand: string) => {
    handLandmarksRef.current.set(hand, landmarks);
    handTimestampsRef.current.set(hand, Date.now());
  }, []);

  // RAF render loop for AR canvas overlay
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
          renderHandOverlay(ctx, handLandmarksRef.current, canvas.width, canvas.height);
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
      <section className="rounded-2xl overflow-hidden border border-black/10 bg-black">
        <div className="relative w-full" style={{ aspectRatio: "16/9" }}>
          {/* Primary video: worker camera (local for worker, remote for expert) */}
          <video
            ref={arVideoRef}
            autoPlay
            playsInline
            muted={isWorker}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Hand overlay canvas */}
          <canvas
            ref={arCanvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

          {/* Hidden video refs for WebRTC wiring */}
          <video ref={localVideoRef} autoPlay muted playsInline className="hidden" />
          <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />

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
        <div className="flex items-center gap-3 px-4 py-3 bg-zinc-950">
          {isWorker && (
            <button
              className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-black transition hover:bg-cyan-400 disabled:opacity-50"
              onClick={runStartWorkerCamera}
              disabled={Boolean(isBusy || hasARVideo)}
            >
              {hasARVideo ? "Camera Active" : "Start Camera"}
            </button>
          )}
          {isExpert && (
            <button
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition disabled:opacity-50 ${isHandTrackingActive ? "bg-red-500/80 text-white hover:bg-red-500" : "bg-cyan-500 text-black hover:bg-cyan-400"}`}
              onClick={() => setIsHandTrackingActive(!isHandTrackingActive)}
              disabled={connectionState !== "connected"}
            >
              {isHandTrackingActive ? "Stop Tracking" : "Start Hand Tracking"}
            </button>
          )}
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
