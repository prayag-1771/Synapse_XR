"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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

const MAX_EVENT_LOG_ITEMS = 24;
const MAX_PPS_HISTORY = 20;

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
      timeout: 7000
    });

    let packetCount = 0;
    const ppsInterval = window.setInterval(() => {
      setHandPacketsPerSecond(packetCount);
      setPpsHistory((current) => [...current.slice(-MAX_PPS_HISTORY + 1), packetCount]);
      packetCount = 0;
    }, 1000);

    const registerJoin = () => {
      socket.emit("session:join", {
        sessionId,
        userId: user.id
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

    socket.on("session:participant-left", () => {
      pushEventLog("session:participant-left");
      void refreshSession(token).catch(() => {
        // Ignore refresh errors for passive realtime updates.
      });
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
      setConnectionState("disconnected");
      setSocketId(null);
      setHandPacketsPerSecond(0);
    };
  }, [captureError, pushEventLog, refreshSession, sessionId, token, user]);

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
