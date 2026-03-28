"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConsoleShell from "@/components/console-shell";
import { api, User, Session } from "@/lib/api";
import { clearAuth, readAuth } from "@/lib/authStorage";

export default function AdminRouteClient() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionFilter, setSessionFilter] = useState<"active" | "ended">("active");
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});

  useEffect(() => {
    const stored = readAuth();
    if (!stored) {
      router.replace("/auth");
      return;
    }

    void (async () => {
      try {
        const response = await api.me(stored.token);
        if (response.user.role !== "admin") {
          router.replace("/dashboard");
          return;
        }

        setToken(stored.token);
        setUser(response.user);

        // Load initial data
        await loadUsers(stored.token);
        await loadSessions(stored.token, "active");
      } catch {
        clearAuth();
        router.replace("/auth");
      }
    })();
  }, [router]);

  const loadUsers = async (activeToken: string) => {
    setIsLoadingUsers(true);
    try {
      const response = await api.listUsers(activeToken);
      setUsers(response.users);
      // Initialize role select values
      const roleMap: Record<string, string> = {};
      response.users.forEach((u) => {
        roleMap[u.id] = u.role;
      });
      setSelectedRole(roleMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const loadSessions = async (activeToken: string, status: "active" | "ended") => {
    setIsLoadingSessions(true);
    try {
      const response = await api.listAdminSessions(activeToken, status);
      setSessions(response.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const updateUserRole = async (userId: string, newRole: string) => {
    if (!token) return;

    try {
      await api.updateUserRole(userId, newRole as "worker" | "expert" | "admin", token);
      setSelectedRole((prev) => ({ ...prev, [userId]: newRole }));
      await loadUsers(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update role");
    }
  };

  const forceEndSession = async (sessionId: string) => {
    if (!token) return;

    try {
      await api.forceEndSession(sessionId, token);
      await loadSessions(token, sessionFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to end session");
    }
  };

  const signOut = () => {
    clearAuth();
    router.replace("/auth");
  };

  const switchFilterStatus = async (newStatus: "active" | "ended") => {
    setSessionFilter(newStatus);
    await loadSessions(token, newStatus);
  };

  return (
    <ConsoleShell title="Admin Panel" subtitle="User and session management">
      <div className="grid gap-6">
        {/* User Card */}
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Authenticated Admin</h2>
          <p className="mt-3 text-sm text-black/70">Email: {user?.email ?? "Loading..."}</p>
          <p className="mt-1 text-sm text-black/70">Role: {user?.role ?? "Loading..."}</p>
          <p className="mt-1 break-all text-sm text-black/70">User ID: {user?.id ?? "Loading..."}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5"
            >
              Back to dashboard
            </button>
            <button
              onClick={signOut}
              className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5"
            >
              Sign out
            </button>
          </div>
        </article>

        {error && (
          <article className="rounded-2xl border border-red-500/30 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-2 text-xs text-red-700 underline"
            >
              Dismiss
            </button>
          </article>
        )}

        {/* Users Management */}
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">User Management</h2>
          <p className="mt-2 text-sm text-black/70">View and update user roles.</p>

          {isLoadingUsers ? (
            <p className="mt-4 text-sm text-black/50">Loading users...</p>
          ) : users.length === 0 ? (
            <p className="mt-4 text-sm text-black/50">No users found.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-black/10">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Email</th>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Current Role</th>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-black/5">
                      <td className="px-3 py-2 text-black/70">{u.email}</td>
                      <td className="px-3 py-2 text-black/70">{u.role}</td>
                      <td className="px-3 py-2">
                        <select
                          value={selectedRole[u.id] ?? u.role}
                          onChange={(e) => updateUserRole(u.id, e.target.value)}
                          className="rounded-lg border border-black/20 bg-white px-2 py-1 text-sm outline-none transition focus:border-black"
                        >
                          <option value="worker">Worker</option>
                          <option value="expert">Expert</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        {/* Sessions Management */}
        <article className="rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-medium">Session Management</h2>
          <p className="mt-2 text-sm text-black/70">View and manage active/ended sessions.</p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => switchFilterStatus("active")}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                sessionFilter === "active"
                  ? "bg-black text-white"
                  : "border border-black/20 hover:bg-black/5"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => switchFilterStatus("ended")}
              className={`rounded-lg px-3 py-2 text-sm transition ${
                sessionFilter === "ended"
                  ? "bg-black text-white"
                  : "border border-black/20 hover:bg-black/5"
              }`}
            >
              Ended
            </button>
          </div>

          {isLoadingSessions ? (
            <p className="mt-4 text-sm text-black/50">Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <p className="mt-4 text-sm text-black/50">No {sessionFilter} sessions found.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-black/10">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Session ID</th>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Created By</th>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Participants</th>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-black/70">Created</th>
                    {sessionFilter === "active" && (
                      <th className="px-3 py-2 text-left font-medium text-black/70">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b border-black/5">
                      <td className="truncate px-3 py-2 text-black/70 font-mono text-xs">
                        {session.id}
                      </td>
                      <td className="px-3 py-2 text-black/70 font-mono text-xs">
                        {session.createdBy}
                      </td>
                      <td className="px-3 py-2 text-black/70 text-xs">
                        {session.participants.length}
                      </td>
                      <td className="px-3 py-2 text-black/70">{session.status}</td>
                      <td className="px-3 py-2 text-black/50 text-xs">
                        {new Date(session.createdAt).toLocaleString()}
                      </td>
                      {sessionFilter === "active" && (
                        <td className="px-3 py-2">
                          <button
                            onClick={() => forceEndSession(session.id)}
                            className="rounded-lg bg-red-100 px-2 py-1 text-xs text-red-700 transition hover:bg-red-200"
                          >
                            Force End
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </ConsoleShell>
  );
}
