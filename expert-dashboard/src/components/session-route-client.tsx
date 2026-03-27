"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConsoleShell from "@/components/console-shell";
import { api, Session } from "@/lib/api";
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

export default function SessionRouteClient({ sessionId }: SessionRouteClientProps) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [latestGlove, setLatestGlove] = useState<Record<string, unknown> | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const withAction = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    setMessage(null);

    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const refreshSession = useCallback(async (activeToken: string) => {
    const response = await api.getSession(sessionId, activeToken);
    setSession(response.session);
  }, [sessionId]);

  useEffect(() => {
    const stored = readAuth();
    if (!stored) {
      router.replace("/auth");
      return;
    }

    setToken(stored.token);

    void withAction(async () => {
      const me = await api.me(stored.token);
      writeAuth({ token: stored.token, user: me.user });
      await refreshSession(stored.token);
    });
  }, [refreshSession, router]);

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
    </ConsoleShell>
  );
}
