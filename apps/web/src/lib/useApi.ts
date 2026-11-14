"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api } from "@/lib/api";

/** Last good response per (workspace, path, persona), kept for this tab only. Going back to a page shows it at once
 *  and refreshes in the background (fix F12), instead of a skeleton on every step change. Never shared across personas. */
const cache = new Map<string, unknown>();
const CACHE_MAX = 80;

function remember(base: string, data: unknown) {
  cache.delete(base);
  cache.set(base, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Fetch under the current persona. Results are keyed by (path, persona) so another persona's data never shows;
 *  a reload keeps showing the previous data for the same key until the fresh copy arrives (no skeleton flash). */
export function useApi<T>(path: string | null) {
  const { ws, personaVersion } = useWorkspace();
  const [tick, setTick] = useState(0);
  const base = path ? `${ws.id}|${path}|${ws.persona.id}|${personaVersion}` : null;
  const key = base ? `${base}|${tick}` : null;
  const [result, setResult] = useState<{ key: string; base: string; data?: T; error?: string; status?: number } | null>(null);

  useEffect(() => {
    if (!path || !key || !base) return;
    let cancelled = false;
    api<T>(path, { workspaceId: ws.id, persona: ws.persona.id })
      .then((data) => {
        remember(base, data);
        if (!cancelled) setResult({ key, base, data });
      })
      .catch((e: { message?: string; status?: number }) => {
        cache.delete(base);
        if (!cancelled) setResult({ key, base, error: e.message ?? String(e), status: e.status });
      });
    return () => {
      cancelled = true;
    };
  }, [path, key, base, ws.id, ws.persona.id]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = result && result.key === key ? result : null;
  const prior = !current && result && result.base === base && result.data !== undefined ? result.data : undefined;
  const cached = !current && prior === undefined && base && cache.has(base) ? (cache.get(base) as T) : undefined;
  const stale = prior ?? cached;
  const data = current ? current.data : stale;
  return { data, error: current?.error, status: current?.status, loading: !!path && !current && stale === undefined,
           refreshing: !current && stale !== undefined, reload };
}
