"use client";

import { useEffect, useState } from "react";

type Health = { status: string; db: { ok: boolean }; llm: { configured: boolean } };

/** Small footer indicator. Also proves the /api rewrite reaches the FastAPI app. */
export function ApiStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  const label = failed
    ? "API unreachable"
    : !health
      ? "Checking API…"
      : health.db.ok
        ? `API ok · database ok · LLM ${health.llm.configured ? "configured" : "not configured"}`
        : "API up · database unreachable";
  const dot = failed || (health && !health.db.ok) ? "bg-red-500" : health ? "bg-emerald-500" : "bg-zinc-300";

  return (
    <span className="inline-flex items-center gap-2" data-testid="api-status">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
