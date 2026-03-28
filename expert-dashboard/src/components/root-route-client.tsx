"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readAuth } from "@/lib/authStorage";

export default function RootRouteClient() {
  const router = useRouter();

  useEffect(() => {
    const stored = readAuth();
    router.replace(stored ? "/dashboard" : "/auth");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,#f7f2e9_0%,#efe8db_45%,#dad5cc_100%)] p-6">
      <p className="rounded-2xl border border-black/20 bg-white/80 px-5 py-4 text-sm text-black/75">Routing to workspace...</p>
    </main>
  );
}
