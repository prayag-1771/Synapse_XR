import Link from "next/link";
import type { ReactNode } from "react";

interface ConsoleShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export default function ConsoleShell({ title, subtitle, children }: ConsoleShellProps) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#f7f2e9_0%,#efe8db_35%,#dad5cc_100%)] p-6 md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(0,0,0,0.04)_0%,transparent_35%,rgba(0,0,0,0.08)_100%)]" />

      <section className="relative mx-auto flex w-full max-w-6xl flex-col gap-5 rounded-3xl border border-black/20 bg-white/80 p-6 shadow-[0_24px_70px_-38px_rgba(0,0,0,0.65)] backdrop-blur md:p-10">
        <header className="flex flex-col gap-4 border-b border-black/10 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {title !== "Synapse XR" && (
                <p className="text-xs uppercase tracking-[0.24em] text-black/55">Synapse XR</p>
              )}
              <h1 className="text-2xl font-semibold tracking-tight text-black md:text-4xl">{title}</h1>
            </div>
            <nav className="flex items-center gap-2 text-sm">
              <Link className="rounded-xl border border-black/15 px-3 py-2 transition hover:bg-black/5" href="/auth">
                Auth
              </Link>
              <Link className="rounded-xl border border-black/15 px-3 py-2 transition hover:bg-black/5" href="/dashboard">
                Dashboard
              </Link>
            </nav>
          </div>
          <p className="max-w-3xl text-sm text-black/70 md:text-base">{subtitle}</p>
        </header>

        {children}
      </section>
    </main>
  );
}
