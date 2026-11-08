"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api } from "@/lib/api";

/** Fetch under the current persona. Results are keyed by (path, persona, reload counter) so stale data never shows. */
export function useApi<T>(path: string | null) {
  const { ws, personaVersion } = useWorkspace();
  const [tick, setTick] = useState(0);
  const key = path ? `${path}|${ws.persona.id}|${personaVersion}|${tick}` : null;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string; status?: number } | null>(null);

  useEffect(() => {
    if (!path || !key) return;
    let cancelled = false;
    api<T>(path, { workspaceId: ws.id })
      .then((data) => !cancelled && setResult({ key, data }))
      .catch((e: { message?: string; status?: number }) => !cancelled && setResult({ key, error: e.message ?? String(e), status: e.status }));
    return () => {
      cancelled = true;
    };
  }, [path, key, ws.id]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = result && result.key === key ? result : null;
  return { data: current?.data, error: current?.error, status: current?.status, loading: !!path && !current, reload };
}
