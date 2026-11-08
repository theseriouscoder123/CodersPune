"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useWorkspace } from "@/components/workspace/WorkspaceShell";
import { api, type RunInfo } from "@/lib/api";

/** Live run progress. This page also DRIVES the run: each /advance call does one bounded slice (DECISIONS D8). */
export default function RunPage() {
  const { ws } = useWorkspace();
  const { run } = useParams<{ run: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    (async () => {
      while (active.current) {
        try {
          const r = await api<RunInfo>(`/runs/${run}/advance`, { workspaceId: ws.id, method: "POST" });
          if (!active.current) break;
          setInfo(r);
          if (r.status === "done") {
            setTimeout(() => router.push(`/w/${ws.id}/ledger`), 1500);
            break;
          }
          if (r.status === "failed") break;
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          await new Promise((res) => setTimeout(res, 3000));
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
    })();
    return () => {
      active.current = false;
    };
  }, [run, ws.id, router]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-navy">Reconstructing the project</h1>
      <p className="mt-1 text-sm text-muted">Keep this page open. The run moves forward while you watch, and it resumes if you come back later.</p>
      {err && <p className="mt-3 text-sm text-rose-700">Connection issue: {err}. Retrying…</p>}
      {info?.status === "failed" && (
        <div className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200">
          <p className="font-semibold">The run stopped</p>
          <p className="mt-1">{info.error}</p>
          <Link href={`/w/${ws.id}/ledger`} className="mt-2 inline-block font-semibold underline">Back to the ledger</Link>
        </div>
      )}
      <ol className="mt-6 space-y-2">
        {(info?.steps ?? []).map((s) => (
          <li key={s.step} className={`rounded-xl border p-3 ${s.status === "running" ? "border-navy bg-white" : "border-line bg-panel"}`}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-navy">
                {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : s.status === "running" ? "⟳" : "○"} {s.label}
              </span>
              {s.total > 0 && <span className="text-xs text-muted">{s.progress}/{s.total}</span>}
            </div>
            {s.message && <p className="mt-1 text-xs text-muted">{s.message}</p>}
            {s.total > 0 && s.status === "running" && (
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-line"><div className="h-full bg-amber" style={{ width: `${Math.round((100 * s.progress) / s.total)}%` }} /></div>
            )}
            {s.errors.length > 0 && <p className="mt-1 text-xs text-orange-700">{s.errors.length} batch issue(s): {s.errors[s.errors.length - 1]}</p>}
          </li>
        ))}
        {!info && <li className="text-muted">Starting…</li>}
      </ol>
    </div>
  );
}
