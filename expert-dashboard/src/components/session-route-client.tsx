"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import ConsoleShell from "@/components/console-shell";
import { api, backendWsBaseUrl, Session, User } from "@/lib/api";
import { clearAuth, readAuth, writeAuth } from "@/lib/authStorage";

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

  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

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

    let stream = localStreamRef.current;
    if (!stream) {
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
      setWebrtcError((current) => current ?? "Local camera failed to start. Continuing in receive-only mode.");
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceCandidate(event.candidate.toJSON());
      }
    };

    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
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
  }, [ensureLocalMedia, sendIceCandidate]);

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

    socket.on("hand:data", (payload: unknown) => {
      packetCount += 1;
      setLatestGlove(payload as Record<string, unknown>);
      pushEventLog("hand:data");
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

  const runStartVideo = async () => {
    await withAction(async () => {
      await ensureLocalMedia();
      setMessage("Camera and microphone are ready.");

      if (remotePeerUserId) {
        await maybeStartOffer();
      }
    });
  };

  const runStopVideo = async () => {
    await withAction(async () => {
      stopPeerConnection();
      stopLocalMedia();
      setWebrtcError(null);
      setMessage("Video call stopped.");
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

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-black/10 bg-white p-5 md:col-span-2">
          <h2 className="text-lg font-medium">P2P Video (WebRTC)</h2>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-black/60">Local</p>
              <video ref={localVideoRef} autoPlay muted playsInline className="mt-2 h-56 w-full rounded-xl border border-black/10 bg-black object-cover" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-black/60">Remote</p>
              <video ref={remoteVideoRef} autoPlay playsInline className="mt-2 h-56 w-full rounded-xl border border-black/10 bg-black object-cover" />
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <button className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50" onClick={runStartVideo} disabled={isBusy || !user}>
              Start Video
            </button>
            <button className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50" onClick={runStopVideo} disabled={isBusy}>
              Stop Video
            </button>
            <p className="self-center text-sm text-black/70">WebRTC status: <span className="font-medium text-black">{webrtcStatus}</span></p>
            <p className="self-center text-sm text-black/70">Peer user: <span className="font-medium text-black">{remotePeerUserId ?? "-"}</span></p>
          </div>

          {webrtcError && <p className="mt-3 text-sm text-red-700">{webrtcError}</p>}
        </article>

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
