"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConsoleShell from "@/components/console-shell";
import { api, User } from "@/lib/api";
import { clearAuth, readAuth, writeAuth } from "@/lib/authStorage";

export default function DashboardRouteClient() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [openSessions, setOpenSessions] = useState<{ id: string; createdAt: string; createdBy: string }[]>([]);
  const [isLoadingOpenSessions, setIsLoadingOpenSessions] = useState(false);
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOpenSessions = async (activeToken: string): Promise<void> => {
    if (user?.role !== "expert" && user?.role !== "admin") {
      return;
    }

    setIsLoadingOpenSessions(true);
    try {
      const response = await api.listOpenSessions(activeToken);
      setOpenSessions(
        response.sessions.map((session) => ({
          id: session.id,
          createdAt: session.createdAt,
          createdBy: session.createdBy
        }))
      );
    } catch {
      // Keep UI resilient; errors will surface during explicit user actions.
    } finally {
      setIsLoadingOpenSessions(false);
    }
  };

  useEffect(() => {
    const stored = readAuth();
    if (!stored) {
      router.replace("/auth");
      return;
    }

    void (async () => {
      try {
        const response = await api.me(stored.token);
        setToken(stored.token);
        setUser(response.user);
        writeAuth({ token: stored.token, user: response.user });

        // Load open sessions for expert/admin users
        if (response.user.role === "expert" || response.user.role === "admin") {
          const openResponse = await api.listOpenSessions(stored.token);
          setOpenSessions(
            openResponse.sessions.map((session) => ({
              id: session.id,
              createdAt: session.createdAt,
              createdBy: session.createdBy
            }))
          );
        }
      } catch {
        clearAuth();
        router.replace("/auth");
      }
    })();
  }, [router]);

  const signOut = () => {
    clearAuth();
    router.replace("/auth");
  };

  const createSession = async () => {
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const response = await api.createSession(token);

      if (user?.role === "worker") {
        setError(null);
      }

      router.push(`/session/${response.session.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create session.");
      setIsBusy(false);
    }
  };

  const openSession = async () => {
    const sessionId = sessionIdInput.trim();
    if (!token || !sessionId) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      try {
        await api.getSession(sessionId, token);
      } catch (sessionError) {
        const message = sessionError instanceof Error ? sessionError.message : "Unable to open session.";

        if (message.toLowerCase() === "forbidden") {
          await api.joinSession(sessionId, token);
        } else {
          throw sessionError;
        }
      }

      router.push(`/session/${sessionId}`);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open session.");
      setIsBusy(false);
    }
  };

  const joinOpenSession = async (sessionId: string) => {
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await api.joinSession(sessionId, token);
      router.push(`/session/${sessionId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to join open request.");
      setIsBusy(false);
    }
  };

  return (
    <ConsoleShell
      title={user ? `${user.role.charAt(0).toUpperCase() + user.role.slice(1)}` : "Synapse XR"}
      subtitle="Session orchestration for hybrid AR/VR workflows. Worker remains AR-first while expert control runs VR-first with this web fallback. [Testing: All roles enabled; final version will restrict to expert/admin only]"
    >
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Authenticated Operator</h2>
          <p className="mt-3 text-sm text-black/70">Email: {user?.email ?? "Loading..."}</p>
          <p className="mt-1 text-sm text-black/70">Role: {user?.role ?? "Loading..."}</p>
          <p className="mt-1 break-all text-sm text-black/70">User ID: {user?.id ?? "Loading..."}</p>
          <button
            type="button"
            className="mt-4 rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5"
            onClick={signOut}
          >
            Sign out
          </button>
        </article>

        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Session Routing</h2>
          <p className="mt-2 text-sm text-black/70">
            {user?.role === "worker"
              ? "Create a support request session or open one by id."
              : "Create/open sessions and pick open worker requests from queue."}
          </p>

          <label className="mt-4 grid gap-1 text-sm">
            <span className="text-black/70">Session ID</span>
            <input
              className="rounded-xl border border-black/20 bg-white px-3 py-2 outline-none transition focus:border-black"
              value={sessionIdInput}
              onChange={(event) => setSessionIdInput(event.target.value)}
              placeholder="Paste a session id"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-xl bg-black px-4 py-2 text-sm text-white transition hover:bg-black/80 disabled:opacity-50"
              onClick={createSession}
              disabled={isBusy}
            >
              {user?.role === "worker" ? "Request guidance" : "Create session"}
            </button>
            <button
              className="rounded-xl border border-black/20 px-4 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50"
              onClick={openSession}
              disabled={isBusy}
            >
              Open session
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        </article>

        {(user?.role === "expert" || user?.role === "admin") && (
          <article className="rounded-2xl border border-black/10 bg-white p-5 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">Open Worker Requests</h2>
              <button
                className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5 disabled:opacity-50"
                onClick={() => {
                  void loadOpenSessions(token);
                }}
                disabled={isLoadingOpenSessions || !token}
              >
                {isLoadingOpenSessions ? "Refreshing..." : "Refresh list"}
              </button>
            </div>

            {openSessions.length === 0 ? (
              <p className="mt-3 text-sm text-black/70">No open worker requests at the moment.</p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {openSessions.map((openSession) => (
                  <li
                    key={openSession.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 px-3 py-3"
                  >
                    <div className="text-sm text-black/70">
                      <p className="font-medium text-black">{openSession.id}</p>
                      <p>Requester: {openSession.createdBy}</p>
                      <p>Created: {new Date(openSession.createdAt).toLocaleString()}</p>
                    </div>
                    <button
                      className="rounded-xl bg-black px-3 py-2 text-sm text-white transition hover:bg-black/80 disabled:opacity-50"
                      onClick={() => {
                        void joinOpenSession(openSession.id);
                      }}
                      disabled={isBusy}
                    >
                      Join request
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        )}
      </section>
    </ConsoleShell>
  );
}
