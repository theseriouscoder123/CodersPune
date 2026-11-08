"use client";

import { useEffect, useState } from "react";

type Health = { status: string; db: { ok: boolean }; llm: { configured: boolean } };

/** Footer system indicator. Also proves the /api rewrite reaches the FastAPI app. */
export function ApiStatus() {
  const [state, setState] = useState<{ health?: Health; failed?: boolean }>({});

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((health) => setState({ health }))
      .catch(() => setState({ failed: true }));
  }, []);

  const { health, failed } = state;
  const ok = health?.db.ok;
  const label = failed ? "Service unreachable" : !health ? "Checking service…" : ok ? "All systems operational" : "Database unreachable";
  return (
    <span className="inline-flex items-center gap-2" data-testid="api-status" title={health ? `AI pipeline ${health.llm.configured ? "configured" : "not configured"}` : undefined}>
      <span className={`h-2 w-2 rounded-full ${failed || (health && !ok) ? "bg-missing" : health ? "bg-verified" : "bg-line-2"}`} aria-hidden />
      {label}
    </span>
  );
}
