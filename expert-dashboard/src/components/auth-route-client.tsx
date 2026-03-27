"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ConsoleShell from "@/components/console-shell";
import { api } from "@/lib/api";
import { readAuth, writeAuth } from "@/lib/authStorage";

type AuthMode = "login" | "register";

export default function AuthRouteClient() {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"worker" | "expert">("worker");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (readAuth()) {
      router.replace("/dashboard");
    }
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    setError(null);

    try {
      const response = authMode === "login" ? await api.login(email, password) : await api.register(email, password, role);
      writeAuth({ token: response.token, user: response.user });
      setFeedback(authMode === "login" ? "Login successful." : "Registration successful.");
      router.push("/dashboard");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ConsoleShell
      title="Expert Authentication"
      subtitle="Access the VR-linked control plane. This dashboard is the required web fallback for operator control and debugging."
    >
      <section className="grid gap-4 md:grid-cols-[2fr_3fr]">
        <article className="rounded-2xl border border-black/10 bg-black/5 p-5">
          <h2 className="text-lg font-medium">Connection Profile</h2>
          <p className="mt-2 text-sm text-black/70">Backend target: NEXT_PUBLIC_BACKEND_URL</p>
          <p className="mt-4 text-sm text-black/70">
            Mode: <span className="font-medium text-black">{authMode}</span>
          </p>
        </article>

        <form className="rounded-2xl border border-black/10 bg-white p-5" onSubmit={handleSubmit}>
          <h2 className="text-lg font-medium">Sign In / Register</h2>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-black/70">Email</span>
              <input
                className="rounded-xl border border-black/20 bg-white px-3 py-2 outline-none transition focus:border-black"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="text-black/70">Password</span>
              <input
                className="rounded-xl border border-black/20 bg-white px-3 py-2 outline-none transition focus:border-black"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                required
              />
            </label>

            {authMode === "register" && (
              <label className="grid gap-1 text-sm">
                <span className="text-black/70">Role</span>
                <select
                  className="rounded-xl border border-black/20 bg-white px-3 py-2 outline-none transition focus:border-black"
                  value={role}
                  onChange={(event) => setRole(event.target.value as "worker" | "expert")}
                >
                  <option value="worker">Worker</option>
                  <option value="expert">Expert</option>
                </select>
              </label>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5"
              onClick={() => setAuthMode("login")}
            >
              Login mode
            </button>
            <button
              type="button"
              className="rounded-xl border border-black/20 px-3 py-2 text-sm transition hover:bg-black/5"
              onClick={() => setAuthMode("register")}
            >
              Register mode
            </button>
            <button
              type="submit"
              className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/80 disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting..." : authMode === "login" ? "Login" : "Create account"}
            </button>
          </div>

          {(feedback || error) && (
            <p className={`mt-4 text-sm ${error ? "text-red-700" : "text-emerald-700"}`}>{error ?? feedback}</p>
          )}
        </form>
      </section>
    </ConsoleShell>
  );
}
