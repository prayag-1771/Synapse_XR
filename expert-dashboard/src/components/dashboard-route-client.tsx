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
  const [sessionIdInput, setSessionIdInput] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await api.getSession(sessionId, token);
      router.push(`/session/${sessionId}`);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open session.");
      setIsBusy(false);
    }
  };

  return (
    <ConsoleShell
      title="Expert Dashboard"
      subtitle="Session orchestration for hybrid AR/VR workflows. Worker remains AR-first while expert control runs VR-first with this web fallback."
    >
      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Authenticated Operator</h2>
          <p className="mt-3 text-sm text-black/70">Email: {user?.email ?? "Loading..."}</p>
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
          <p className="mt-2 text-sm text-black/70">Create a new session or open an existing one by id.</p>

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
              Create session
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
      </section>
    </ConsoleShell>
  );
}
