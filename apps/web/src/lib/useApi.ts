"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api } from "@/lib/api";

/** Fetch under the current persona. Results are keyed by (path, persona) so another persona's data never shows;
 *  a plain reload keeps showing the previous data for the same key until the fresh copy arrives (no skeleton flash). */
export function useApi<T>(path: string | null) {
  const { ws, personaVersion } = useWorkspace();
  const [tick, setTick] = useState(0);
  const base = path ? `${path}|${ws.persona.id}|${personaVersion}` : null;
  const key = base ? `${base}|${tick}` : null;
  const [result, setResult] = useState<{ key: string; base: string; data?: T; error?: string; status?: number } | null>(null);

  useEffect(() => {
    if (!path || !key || !base) return;
    let cancelled = false;
    api<T>(path, { workspaceId: ws.id, persona: ws.persona.id })
      .then((data) => !cancelled && setResult({ key, base, data }))
      .catch((e: { message?: string; status?: number }) => !cancelled && setResult({ key, base, error: e.message ?? String(e), status: e.status }));
    return () => {
      cancelled = true;
    };
  }, [path, key, base, ws.id, ws.persona.id]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = result && result.key === key ? result : null;
  const stale = !current && result && result.base === base && result.data !== undefined ? result : null;
  const shown = current ?? stale;
  return { data: shown?.data, error: current?.error, status: current?.status, loading: !!path && !current && !stale, refreshing: !!stale, reload };
}
